"""Create an admin account (local project only)."""
import getpass
import sqlite3
from server import init_database, database, make_password

if __name__ == "__main__":
    init_database()
    email = input("Admin email (@astanait.edu.kz): ").strip().lower()
    if not email.endswith("@astanait.edu.kz"):
        raise SystemExit("Use a corporate @astanait.edu.kz email")
    first = input("First name: ").strip()
    last = input("Last name: ").strip()
    password = getpass.getpass("Password (at least 8 characters): ")
    if not first or not last or len(password) < 8:
        raise SystemExit("Provide name, surname and password with at least 8 characters")
    salt, digest = make_password(password)
    with database() as con:
        existing = con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            con.execute("UPDATE users SET role='admin',first_name=?,last_name=?,password_salt=?,password_hash=? WHERE id=?",
                        (first,last,salt,digest,existing["id"]))
            print("Existing account updated as admin.")
        else:
            con.execute("INSERT INTO users(email,first_name,last_name,student_group,password_salt,password_hash,role) VALUES(?,?,?,?,?,?,?)",
                        (email,first,last,'ADMIN',salt,digest,'admin'))
            print("Admin account created.")
    print("Open http://localhost:3001 and sign in using this account.")
