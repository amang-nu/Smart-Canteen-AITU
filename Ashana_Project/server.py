"""AITU Smart Canteen: localhost-only demo backend, Python standard library + SQLite.
Start with: py -3 server.py  (Windows) or python3 server.py.
This is a class prototype, not a production deployment.
"""
from analytics import QUERIES
import features
import threading
import hashlib
import hmac
import json
import mimetypes
import re
import secrets
import sys
import webbrowser
import sqlite3
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "canteen.sqlite3"
HOST = "127.0.0.1"
PORT = 3001
HASH_ITERATIONS = 260_000
SESSION_SECONDS = 12 * 60 * 60


@contextmanager
def database():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_database():
    with database() as con:
        con.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
        con.execute("CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), dish_id INTEGER NOT NULL REFERENCES menu(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL, photo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        if 'payment_method' not in [r[1] for r in con.execute('PRAGMA table_info(orders)')]:
            con.execute("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'Card'")
        if con.execute("SELECT COUNT(*) FROM menu").fetchone()[0] == 0:
            rows = json.loads((ROOT / "seed_menu.json").read_text(encoding="utf-8"))
            con.executemany(
                "INSERT INTO menu(id,name,description,price,category,emoji,image,remote) VALUES(?,?,?,?,?,?,?,?)",
                [(r["id"],r["name"],r["description"],r["price"],r["category"],r.get("emoji","🍽️"),r.get("image",""),r.get("remote","")) for r in rows]
            )

        features.migrate(con)

def make_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ITERATIONS)
    return salt.hex(), digest.hex()


def valid_password(password, salt_hex, hash_hex):
    try:
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), HASH_ITERATIONS)
        return hmac.compare_digest(digest, bytes.fromhex(hash_hex))
    except (ValueError, TypeError):
        return False


def public_user(row):
    return {"id": row["id"], "email": row["email"], "firstName": row["first_name"],
            "lastName": row["last_name"], "group": row["student_group"], "role": row["role"]}


def create_session(con, user_id):
    token = secrets.token_urlsafe(32)
    con.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
    con.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS))
    return token


def user_from_request(con, headers):
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    if len(token) > 256:
        return None
    return con.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=? AND s.expires_at>?""", (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()


def serialize_order(con, row):
    items = con.execute("SELECT menu_item_id,food_name,quantity,price FROM order_items WHERE order_id=? ORDER BY id", (row["id"],)).fetchall()
    entry = dict(row)
    entry["items"] = ", ".join(f"{r['food_name']} × {r['quantity']}" for r in items)
    entry["food_name"] = ", ".join(r["food_name"] for r in items)
    entry["quantity"] = sum(r["quantity"] for r in items)
    entry["orderItems"] = [dict(r) for r in items]
    return entry


class App(BaseHTTPRequestHandler):
    server_version = "AITUCanteenDemo/1.0"

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"success": False, "error": message}, status)

    def payload(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > 2_000_000:
            raise ValueError("Invalid request body size")
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict):
            raise ValueError("Expected JSON object")
        return data

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            return self.serve_file(path)
        try:
            with database() as con:
                con.execute("BEGIN IMMEDIATE")
                features.expire(con)
                if path == "/api/health":
                    return self.send_json({"success": True, "database": "sqlite"})
                if path == "/api/reviews":
                    result = {}
                    for r in con.execute("SELECT r.*,u.first_name,u.last_name FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.id"):
                        result.setdefault(str(r['dish_id']), []).append(dict(rating=r['rating'],comment=r['comment'],photo=r['photo'],author=r['first_name']+' '+r['last_name'],date=r['created_at']))
                    return self.send_json(result)
                if path == "/api/menu":
                    return self.send_json(features.menu_rows(con))
                user = user_from_request(con, self.headers)
                if not user:
                    return self.send_error_json("Please sign in", 401)
                if path == "/api/account":
                    return self.send_json({'points':user['points'],
                        'favorites':[r[0] for r in con.execute('SELECT dish_id FROM favorites WHERE user_id=?',(user['id'],))],
                        'notifications':[dict(r) for r in con.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30',(user['id'],))],
                        'queue':features.queue_info(con,user['id'])})
                if path == "/api/me":
                    return self.send_json({"success": True, "user": public_user(user)})
                if path.startswith("/api/my-orders/"):
                    email = unquote(path.removeprefix("/api/my-orders/")).lower()
                    if email != user["email"].lower() and user["role"] != "admin":
                        return self.send_error_json("Access denied", 403)
                    target = con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
                    if not target:
                        return self.send_json([])
                    orders = con.execute("""SELECT o.*,u.first_name FROM orders o JOIN users u ON u.id=o.user_id
                        WHERE o.user_id=? ORDER BY o.id DESC LIMIT 100""", (target["id"],)).fetchall()
                    return self.send_json([serialize_order(con, row) for row in orders])
                if user["role"] != "admin":
                    return self.send_error_json("Admin access required", 403)
                if path == "/api/admin/analytics":
                    results = [[dict(r) for r in con.execute(q)] for q in QUERIES]
                    counts = dict(con.execute("SELECT status, COUNT(*) FROM orders GROUP BY status").fetchall())
                    return self.send_json({"hourly": results[0], "popular": results[1], "daily": results[2], "counts": counts})
                if path == "/api/admin/orders":
                    orders = con.execute("""SELECT o.*,u.first_name,u.last_name,u.email AS user_email FROM orders o
                       JOIN users u ON u.id=o.user_id ORDER BY o.id DESC""").fetchall()
                    return self.send_json([serialize_order(con, r) for r in orders])
                if path == "/api/admin/users":
                    return self.send_json([dict(r) for r in con.execute(
                        "SELECT id,email,first_name,last_name,student_group,role,created_at FROM users ORDER BY id DESC")])
            return self.send_error_json("Not found", 404)
        except (sqlite3.Error, OSError) as exc:
            print("Server error:", exc)
            return self.send_error_json("Database error", 500)

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            data = {} if path == '/api/logout' else self.payload()
            with database() as con:
                con.execute("BEGIN IMMEDIATE")
                features.expire(con)
                if path == "/api/register":
                    email = str(data.get("email", "")).strip().lower()
                    password = str(data.get("password", ""))
                    first = str(data.get("firstName", "")).strip()
                    last = str(data.get("lastName", "")).strip()
                    group = str(data.get("group", "")).strip().upper()
                    if not re.fullmatch(r"[a-zA-Z0-9._%+\-]+@astanait\.edu\.kz", email):
                        return self.send_error_json("Use your @astanait.edu.kz email")
                    if min(len(first),len(last),len(group)) < 1 or max(len(first),len(last),len(group)) > 100:
                        return self.send_error_json("Fill in name, surname and group")
                    if len(password) < 8 or len(password) > 128:
                        return self.send_error_json("Password must contain 8–128 characters")
                    if con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
                        return self.send_error_json("Account already registered", 409)
                    salt, digest = make_password(password)
                    cur = con.execute("""INSERT INTO users(email,first_name,last_name,student_group,password_salt,password_hash)
                         VALUES (?,?,?,?,?,?)""", (email,first,last,group,salt,digest))
                    row = con.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
                    return self.send_json({"success": True, "user": public_user(row), "token": create_session(con, row["id"])}, 201)
                if path == "/api/login":
                    email = str(data.get("email", "")).strip().lower()
                    password = str(data.get("password", ""))
                    row = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                    if not row or not valid_password(password, row["password_salt"], row["password_hash"]):
                        return self.send_error_json("Wrong email or password", 401)
                    return self.send_json({"success": True, "user": public_user(row), "token": create_session(con, row["id"])})
                user = user_from_request(con, self.headers)
                if not user:
                    return self.send_error_json("Please sign in", 401)
                if path == "/api/logout":
                    token = self.headers.get("Authorization", "")[7:]
                    con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
                    return self.send_json({"success": True})
                if path == "/api/favorites":
                    dish=data.get('dishId')
                    if type(dish) is not int or not con.execute('SELECT id FROM menu WHERE id=?',(dish,)).fetchone():
                        return self.send_error_json('Dish not found')
                    if data.get('favorite') is True:
                        con.execute('INSERT OR IGNORE INTO favorites(user_id,dish_id) VALUES(?,?)',(user['id'],dish))
                    else:
                        con.execute('DELETE FROM favorites WHERE user_id=? AND dish_id=?',(user['id'],dish))
                    return self.send_json({'success':True})
                if path == '/api/notifications/read':
                    con.execute('UPDATE notifications SET seen=1 WHERE user_id=?',(user['id'],))
                    return self.send_json({'success':True})
                if path == '/api/admin/discount':
                    if user['role']!='admin': return self.send_error_json('Admin access required',403)
                    discount=data.get('percent'); dish=data.get('dishId')
                    if type(discount) is not int or not 0<=discount<=90 or type(dish) is not int:
                        return self.send_error_json('Discount must be an integer from 0 to 90')
                    if not con.execute('SELECT id FROM menu WHERE id=?',(dish,)).fetchone(): return self.send_error_json('Dish not found',404)
                    con.execute('UPDATE menu SET discount_percent=? WHERE id=?',(discount,dish))
                    return self.send_json({'success':True})
                if path == "/api/reviews":
                    dish = data.get('dishId'); rating = data.get('rating'); comment = str(data.get('comment','')).strip(); photo = str(data.get('photo',''))
                    if type(dish) is not int or type(rating) is not int or not 1 <= rating <= 5 or not 1 <= len(comment) <= 2000:
                        return self.send_error_json('Invalid review (text limit: 2000 characters)')
                    if photo and (not photo.startswith('data:image/jpeg;base64,') or len(photo)>1500000):
                        return self.send_error_json('Photo must be a JPEG smaller than 1 MB')
                    if not con.execute('SELECT id FROM menu WHERE id=?',(dish,)).fetchone():
                        return self.send_error_json('Dish not found')
                    con.execute('INSERT INTO reviews(user_id,dish_id,rating,comment,photo) VALUES(?,?,?,?,?)',(user['id'],dish,rating,comment,photo))
                    return self.send_json({'success':True},201)
                if path == "/api/orders":
                    existing = con.execute("SELECT id FROM orders WHERE user_id=? AND status IN ('Pending','Preparing','Ready')", (user['id'],)).fetchone()
                    if existing:
                        return self.send_error_json("You already have an active order", 409)
                    raw = data.get("items")
                    pickup = str(data.get("pickupTime", ""))
                    if not isinstance(raw, list) or not 1 <= len(raw) <= 100:
                        return self.send_error_json("Cart is empty or too large")
                    if not re.fullmatch(r"(?:0[9]|1[0-8]):[0-5][0-9] [–-] (?:0[9]|1[0-8]):[0-5][0-9]", pickup):
                        return self.send_error_json("Choose a valid pickup time")
                    pickup_at = features.pickup_timestamp(str(data.get("pickupDate", "")), pickup)
                    items = []
                    total = 0
                    for item in raw:
                        if not isinstance(item,dict) or type(item.get("id")) is not int or type(item.get("quantity")) is not int:
                            return self.send_error_json("Invalid item")
                        amount = item["quantity"]
                        if not 1 <= amount <= 99:
                            return self.send_error_json("Invalid quantity")
                        r = con.execute("SELECT * FROM menu WHERE id=?", (item["id"],)).fetchone()
                        if not r:
                            return self.send_error_json("Item not in menu")
                        price = r["price"]*(100-r["discount_percent"])//100
                        items.append((r["id"],r["name"],amount,price))
                        total += price*amount
                    payment = data.get('paymentMethod')
                    if payment != 'QR': return self.send_error_json('Only demo QR payment is available')
                    spent = data.get('points',0)
                    if type(spent) is not int or spent<0 or spent>min(user['points'],total*30//100):
                        return self.send_error_json('Not enough points or 30% limit exceeded')
                    total -= spent
                    if data.get('expectedTotal') != total:
                        return self.send_error_json('Prices changed. Reopen the cart and confirm the updated total.',409)
                    con.execute('UPDATE users SET points=points-? WHERE id=?',(spent,user['id']))
                    code = "A" + secrets.token_hex(3).upper()
                    cur = con.execute("INSERT INTO orders(code,user_id,pickup_time,total_price,payment_method,pickup_at,points_spent) VALUES(?,?,?,?,?,?,?)",
                                      (code,user["id"],pickup,total,payment,pickup_at,spent))
                    con.executemany("""INSERT INTO order_items(order_id,menu_item_id,food_name,quantity,price)
                        VALUES(?,?,?,?,?)""", [(cur.lastrowid,*x) for x in items])
                    return self.send_json({"success": True, "id": cur.lastrowid, "code": code, "total": total, "status": "Pending"}, 201)
            return self.send_error_json("Not found", 404)
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_error_json(str(exc), 400)
        except sqlite3.Error as exc:
            print("Database error:", exc)
            return self.send_error_json("Database error", 500)

    def do_PUT(self):
        path = urlsplit(self.path).path
        match = re.fullmatch(r"/api/(admin/)?orders/(\d+)/(status|cancel|complete)", path)
        if not match:
            return self.send_error_json("Not found", 404)
        admin_path, order_id, action = match.groups()
        try:
            data = self.payload() if self.headers.get("Content-Length", "0") != "0" else {}
            with database() as con:
                con.execute("BEGIN IMMEDIATE")
                features.expire(con)
                user = user_from_request(con, self.headers)
                if not user:
                    return self.send_error_json("Please sign in", 401)
                if admin_path and user["role"] != "admin":
                    return self.send_error_json("Admin access required", 403)
                order = con.execute("SELECT * FROM orders WHERE id=?", (int(order_id),)).fetchone()
                if not order:
                    return self.send_error_json("Order not found", 404)
                if not admin_path and order["user_id"] != user["id"]:
                    return self.send_error_json("Access denied", 403)
                if action == "status" and admin_path:
                    status = data.get("status")
                    if (order["status"],status) not in (("Pending","Preparing"),("Preparing","Ready"),("Ready","Completed")):
                        return self.send_error_json("Invalid status transition", 409)
                    con.execute("UPDATE orders SET status=? WHERE id=?", (status,order_id))
                elif action == "cancel":
                    if order["status"] in ("Cancelled","Completed"):
                        return self.send_error_json("Order already closed", 409)
                    reason = str(data.get("reason", "Cancelled by student" if not admin_path else "Cancelled by administrator"))[:500]
                    con.execute("UPDATE orders SET status='Cancelled',cancel_reason=? WHERE id=?", (reason,order_id))
                elif action == "complete" and not admin_path:
                    if order["status"] != "Ready":
                        return self.send_error_json("Order is not ready yet", 409)
                    con.execute("UPDATE orders SET status='Completed' WHERE id=?", (order_id,))
                else:
                    return self.send_error_json("Not found",404)
                features.settle(con, int(order_id), customer_cancel=(action=='cancel' and not admin_path))
                settled = con.execute('SELECT refund_amount,fee_amount FROM orders WHERE id=?',(order_id,)).fetchone()
                return self.send_json({"success": True, "refund": settled['refund_amount'], "fee": settled['fee_amount']})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_error_json(str(exc),400)
        except sqlite3.Error as exc:
            print("Database error:", exc)
            return self.send_error_json("Database error", 500)

    def serve_file(self, path):
        allowed = {"/": "index.html", "/index.html": "index.html", "/script.js": "script.js", "/style.css": "style.css",
                   "/assets/images/fresh-lemonade.png": "assets/images/fresh-lemonade.png",
                   "/assets/images/cocoa.png": "assets/images/cocoa.png",
                   "/features.js": "features.js", "/features.css": "features.css",
                   "/assets/sounds/order-ready.wav": "assets/sounds/order-ready.wav"}
        name = allowed.get(path)
        if not name:
            return self.send_error_json("Not found", 404)
        file_path = ROOT / name
        if not file_path.is_file():
            return self.send_error_json("File not found", 404)
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(str(file_path))[0] or "application/octet-stream") + ("; charset=utf-8" if file_path.suffix in (".html",".js",".css") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)


def main():
    init_database()
    def expiry_worker():
        while True:
            try:
                with database() as con:
                    con.execute('BEGIN IMMEDIATE')
                    features.expire(con)
            except sqlite3.Error as exc:
                print('Expiry worker:',exc)
            time.sleep(10)
    threading.Thread(target=expiry_worker,daemon=True).start()
    print(f"\nAITU Smart Canteen is running at http://localhost:{PORT}\nPress Ctrl+C to stop.\n")
    try:
        with ThreadingHTTPServer((HOST,PORT), App) as server:
            if "--no-browser" not in sys.argv:
                threading.Thread(target=lambda: webbrowser.open(f"http://localhost:{PORT}/#analysisPanel"), daemon=True).start()
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped.")
    except OSError as exc:
        print(f"Cannot start server on port {PORT}: {exc}")


if __name__ == "__main__":
    main()
