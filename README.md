# AITU Smart Canteen

AITU Smart Canteen is a university canteen prototype. Students can browse dishes, place pre-orders, choose a pickup time and track orders. Administrators manage orders, view statistics and set dish discounts.

## Team

Group SE-2620

- Amina Polatkhan
- Nuraiym Amangali
- Togzhan Kabash

## Requirements

- Python 3.10 or newer.
- A modern web browser.
- Internet access for externally hosted dish images and Google Fonts.
- Optional cloudflared for temporary access from other devices.

The backend uses the Python standard library and SQLite. No pip packages are required.

## Download and run

1. Download the repository using **Code → Download ZIP**, then extract it.
2. Open the **Ashana_Project** folder.
3. On Windows, double-click **START.bat**.
4. Open **http://localhost:3001** in your browser.
5. Keep the server window open while using the website.

Alternatively, run these commands from the repository root.

Windows:

```powershell
cd Ashana_Project
py -3 server.py
```

macOS or Linux:

```bash
cd Ashana_Project
python3 server.py
```

Press **Ctrl+C** in the terminal to stop the server. Open the site through the server URL so registration, orders and database features work.

## Accounts for demonstration

### Administrator

The database included in the submitted project contains this demonstration account:

| Field | Value |
| --- | --- |
| Email | admin@astanait.edu.kz |
| Password | 12345678 |
| Role | admin |

To create an administrator in a new database or reset an existing administrator's password, run **CREATE_ADMIN.bat** inside **Ashana_Project**. Alternatively, run:

```bash
python3 create_admin.py
```

Enter an email ending in **@astanait.edu.kz**, first name, last name and a password of at least eight characters. Entering an existing email updates that account's name, password and role to admin.

### Student

Create a student account using the registration screen before the demonstration. The following values are suggested test details; this account must be registered before its first login.

| Field | Value |
| --- | --- |
| First name | Demo |
| Last name | Student |
| Group | TEST |
| Email | demo.student@astanait.edu.kz |
| Password | DemoStudent2026! |
| Role | student, assigned automatically |

Email verification is not implemented. Use these details only for project testing. If the suggested email is already registered in your local database, use the credentials chosen during registration or register another test address.

## Main features

### Student

- University-email registration and login.
- Menu search, category filters and favourites.
- Dish descriptions, ingredients and vegetarian labels.
- Cart, pickup slots and order confirmation with a pickup code.
- Order status, history and repeat ordering.
- Order cancellation with a demonstration refund calculation.
- Discounted dishes and loyalty points.
- Dish ratings and reviews with photos.
- Optional sound notifications when an order is ready.

### Administrator

- View orders and registered users.
- Move orders through Preparing, Ready and Completed, or cancel them.
- Filter order history by period.
- View order statistics and data analysis.
- Set discounts on dishes.

## Access from other devices

For a temporary demonstration, start the Python server first. In a second terminal, run cloudflared from the folder where it is installed.

Windows:

```powershell
.\cloudflared.exe tunnel --url http://127.0.0.1:3001
```

The terminal prints a temporary **https://...trycloudflare.com** URL. Open that URL on another device.

Keep the laptop connected to the internet and keep both the Python server and cloudflared running. Restarting a Quick Tunnel generates a new URL. Share the current URL before the demonstration.

Local access uses HTTP. The public demonstration URL uses HTTPS through Cloudflare. The application and database remain on the laptop.

## Database and analysis

Data is stored in **Ashana_Project/canteen.sqlite3**. The server initializes the schema and seeds the menu when needed. A fresh database requires account creation.

- **schema.sql** defines the core database structure.
- **features.py** adds feature-related tables and columns.
- **analytics.py** supplies the queries used by the statistics API.
- **analysis_queries.sql** contains queries for pickup hours, popular dishes and completed-order value.

Use the same database snapshot for screenshots, SQL results and the final report. Counts and totals change as people register and place orders. Completed-order value represents demonstration orders.

The HIT label ranks dishes by portions in completed orders created within the last seven days.

## Project files

| File or folder | Purpose |
| --- | --- |
| index.html | Main interface |
| style.css, features.css | Page styling |
| script.js, features.js | Browser interactions and API requests |
| server.py | HTTP server, authentication and order API |
| features.py | Discounts, points, reviews and other feature logic |
| analytics.py | Statistics queries imported by the server |
| schema.sql | Core database schema |
| seed_menu.json | Initial menu data |
| canteen.sqlite3 | Saved application data |
| create_admin.py, CREATE_ADMIN.bat | Administrator account setup |
| START.bat | Windows launcher |
| assets/images | Local dish images |
| assets/sounds | Ready-order sound |

## Demonstration checklist

1. Start the server and sign in as a student.
2. Open a dish, check its ingredients and add it to the cart.
3. Choose a pickup time and confirm a demonstration order.
4. Sign in as admin in a separate browser profile.
5. Find the order and update its status.
6. Return to the student page and check the status and ready notification.
7. Complete the order and inspect the administrator statistics.

## Prototype limitations

- QR payment, fees and refunds are demonstrations; no money is transferred.
- The occupancy indicator displays simulated values.
- Pickup-slot capacity limits and full menu editing by staff are not implemented.
- External access through Quick Tunnel depends on the laptop, server and tunnel remaining online.
- The prototype has no email verification, automatic database backups or automatic data-retention policy.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Python is not found | Install Python 3 and reopen the terminal. On Windows, enable the Python launcher or add Python to PATH. |
| Port 3001 is already in use | Stop the previous server with Ctrl+C, then run START.bat again. |
| The wrong orders or users appear | Check which project folder the running server uses. Each copy has its own database. |
| Registration or orders fail after opening index.html | Start the server and open http://localhost:3001. |
| The public demo link stops working | Check that the laptop, Python server and cloudflared are online. After restarting the tunnel, use the newly printed URL. |
| The administrator cannot log in | Run CREATE_ADMIN.bat to set the administrator credentials. |

