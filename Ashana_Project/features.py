"""Persistent demo features. All money values are integer KZT; timezone UTC+5."""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
TZ = timezone(timedelta(hours=5))
ACTIVE = ('Pending', 'Preparing', 'Ready')

def migrate(con):
    additions = {
        'users': {'points': 'INTEGER NOT NULL DEFAULT 0'},
        'menu': {'discount_percent': 'INTEGER NOT NULL DEFAULT 0', 'ingredients': "TEXT NOT NULL DEFAULT ''", 'vegetarian': 'INTEGER NOT NULL DEFAULT 0'},
        'orders': {'pickup_at': 'INTEGER', 'points_spent': 'INTEGER NOT NULL DEFAULT 0',
                   'points_earned': 'INTEGER NOT NULL DEFAULT 0', 'refund_amount': 'INTEGER NOT NULL DEFAULT 0',
                   'fee_amount': 'INTEGER NOT NULL DEFAULT 0', 'settled': 'INTEGER NOT NULL DEFAULT 0'}}
    for table, fields in additions.items():
        existing = {r[1] for r in con.execute('PRAGMA table_info('+table+')')}
        for field, definition in fields.items():
            if field not in existing:
                con.execute(f'ALTER TABLE {table} ADD COLUMN {field} {definition}')
    con.executescript('''CREATE TABLE IF NOT EXISTS favorites (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        dish_id INTEGER REFERENCES menu(id) ON DELETE CASCADE, PRIMARY KEY(user_id,dish_id));
        CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);''')
    # Fill recipe metadata once without replacing later edits or custom dishes.
    catalog = json.loads((Path(__file__).parent / 'seed_menu.json').read_text(encoding='utf-8'))
    for dish in catalog:
        con.execute("UPDATE menu SET ingredients=?,vegetarian=? WHERE id=? AND name=? AND ingredients=''",
                    (dish['ingredients'],int(dish['vegetarian']),dish['id'],dish['name']))
    # Versioned migration replaces only the two broken original photos.
    con.execute('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY)')
    if not con.execute("SELECT 1 FROM app_migrations WHERE name='drink_photos_v2'").fetchone():
        for dish in catalog:
            if dish['id'] in (8,29):
                con.execute('UPDATE menu SET image=? WHERE id=? AND name=?',(dish['image'],dish['id'],dish['name']))
        con.execute("INSERT INTO app_migrations(name) VALUES('drink_photos_v2')")
    # Existing closed orders are not retroactively rewarded or refunded.
    con.execute("UPDATE orders SET settled=1 WHERE pickup_at IS NULL AND status IN ('Completed','Cancelled')")
    for row in con.execute('SELECT * FROM orders WHERE pickup_at IS NULL').fetchall():
        created = datetime.fromisoformat(row['created_at']).replace(tzinfo=timezone.utc).astimezone(TZ)
        end = row['pickup_time'][-5:]
        try:
            target = datetime.fromisoformat(created.date().isoformat()+'T'+end).replace(tzinfo=TZ)
            con.execute('UPDATE orders SET pickup_at=? WHERE id=?', (int(target.timestamp()),row['id']))
        except ValueError:
            pass

def notify(con, uid, message):
    con.execute('INSERT INTO notifications(user_id,message) VALUES(?,?)',(uid,message))

def settle(con, oid, late=False, customer_cancel=False):
    o = con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone()
    if o['settled'] or o['status'] not in ('Completed','Cancelled'): return
    if o['status']=='Completed':
        earned = o['total_price'] * 5 // 100
        con.execute('UPDATE users SET points=points+? WHERE id=?',(earned,o['user_id']))
        con.execute('UPDATE orders SET points_earned=?,settled=1 WHERE id=?',(earned,oid))
        notify(con,o['user_id'],f"Order {o['code']} collected. +{earned} points!")
    else:
        fee = (o['total_price']*5+50)//100 if (late or customer_cancel) else 0
        refund = o['total_price']-fee
        con.execute('UPDATE users SET points=points+? WHERE id=?',(o['points_spent'],o['user_id']))
        con.execute('UPDATE orders SET refund_amount=?,fee_amount=?,settled=1 WHERE id=?',(refund,fee,oid))
        notify(con,o['user_id'],f"Order {o['code']} cancelled. Demo refund: {refund} ₸; retention: {fee} ₸" + (' (5%, pickup overdue by 20 minutes).' if late else ' (5%, customer cancellation).' if customer_cancel else '.') + f" {o['points_spent']} used points restored. No real money was transferred.")

def expire(con, now=None):
    now = time.time() if now is None else now
    rows = con.execute("SELECT id FROM orders WHERE status IN ('Pending','Preparing','Ready') AND pickup_at+1200<=?",(now,)).fetchall()
    for r in rows:
        con.execute("UPDATE orders SET status='Cancelled',cancel_reason='Not collected within 20 minutes after the pickup window' WHERE id=?",(r['id'],))
        settle(con,r['id'],late=True)

def menu_rows(con):
    hits = {r[0] for r in con.execute("""SELECT oi.menu_item_id FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE o.status='Completed' AND o.created_at>=datetime('now','-7 days')
        GROUP BY oi.menu_item_id ORDER BY SUM(oi.quantity) DESC,oi.menu_item_id LIMIT 3""")}
    result=[]
    for row in con.execute('SELECT * FROM menu ORDER BY id'):
        d=dict(row); d['original_price']=d['price']; d['price']=d['price']*(100-d['discount_percent'])//100
        d['hit']=d['id'] in hits; result.append(d)
    return result

def pickup_timestamp(date, window):
    try:
        start, end = window.replace('–','-').split(' - ')
        a=datetime.fromisoformat(date+'T'+start).replace(tzinfo=TZ)
        b=datetime.fromisoformat(date+'T'+end).replace(tzinfo=TZ)
    except (ValueError,TypeError):
        raise ValueError('Choose a valid pickup date and time')
    now=datetime.now(TZ)
    if a < now+timedelta(minutes=10) or a.date() > (now+timedelta(days=1)).date() or (b-a).total_seconds()!=600 or a.minute%10:
        raise ValueError('Choose a pickup slot at least 10 minutes from now, today or tomorrow (Astana time)')
    return int(b.timestamp())

def queue_info(con, uid):
    o=con.execute("SELECT * FROM orders WHERE user_id=? AND status IN ('Pending','Preparing','Ready') ORDER BY id LIMIT 1",(uid,)).fetchone()
    if not o: return None
    ahead=con.execute("SELECT COUNT(*) FROM orders WHERE status IN ('Pending','Preparing') AND (pickup_at<? OR (pickup_at=? AND id<?))",(o['pickup_at'],o['pickup_at'],o['id'])).fetchone()[0]
    minutes=0 if o['status']=='Ready' else max((ahead+1)*10, int((o['pickup_at']-600-time.time()+59)//60))
    return {'code':o['code'],'ahead':0 if o['status']=='Ready' else ahead,'minutes':minutes,'deadline':o['pickup_at']+1200,'status':o['status']}
