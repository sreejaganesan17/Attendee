# Attendee

A workplace attendance tracker with separate **Worker** and **HR** roles. Employees check themselves in and out, the system works out how late they were, and HR gets a read-only dashboard, CSV export and an analytics page.

> **Note:** all employees, passwords and attendance history in this repository are **mock data** created for demonstration. Do not use the demo credentials in a real deployment.

## Screenshots

| Worker dashboard | HR dashboard | Analytics |
|---|---|---|
| ![Worker dashboard](docs/screenshots/worker.png) | ![HR dashboard](docs/screenshots/hr.png) | ![Analytics](docs/screenshots/analytics.png) |

## Features

**Workers**
- See their name, live date and day, branch and today's status (Present, Late, Absent, On Leave, or not marked yet).
- **Check in** and **check out** once per day. Checking in after the start time marks them **Late** and records **how many hours and minutes late** they were.
- See their in time, out time and hours worked for the day.

**HR**
- Read-only attendance view: search by name or username, filter by department, status and date.
- Daily totals for Present, Late, Absent, On Leave and Not marked.
- In time, out time and late duration for every employee.
- **CSV export** of all attendance records for Excel, Power BI or Python.

**Analytics page**
- Attendance, late and absence rates, plus average time late.
- Weekly trend, and breakdowns by weekday, department and branch.
- Plain-language findings and a list of the 10 employees with the most late and absent days.

**Security**
- Passwords hashed with bcrypt, session cookies that are httpOnly and sameSite, and a new session ID on login.
- Role checks on every page and API route, plus rate limiting on login.
- Parameterised SQL queries throughout.

## Tech stack

Node.js, Express, SQLite (better-sqlite3), express-session, bcryptjs, vanilla JavaScript, Tailwind CSS (CDN), Chart.js.

## Getting started

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/<your-username>/attendee.git
cd attendee
npm install
npm run seed             # 72 workers + 3 HR users (bcrypt-hashed passwords)
npm run seed:history     # optional: ~90 days of SYNTHETIC attendance for the analytics page
npm start                # http://localhost:3000
```

On Windows PowerShell, set a session secret like this: `$env:SESSION_SECRET="long-random-text"; npm start`. On Mac or Linux: `SESSION_SECRET=long-random-text npm start`.

### Demo logins (mock data only)

| Role | Username | Password |
|---|---|---|
| Worker | `emp001` to `emp072` | `Welcome@123` |
| HR | `hr001` to `hr003` | `HrAdmin@123` |

## How lateness is calculated

The start time is `09:30` by default. A worker who checks in after it is marked **Late**, and `late_minutes` stores the number of minutes after the start time. Change the start time with the `LATE_AFTER` environment variable (24-hour `HH:MM`), for example `LATE_AFTER=10:00 npm start`.

## Analytics definitions

Leave days are excluded from these rates.

- **Attendance rate** = (Present + Late) / (Present + Late + Absent)
- **Late rate** = Late / (Present + Late)
- **Absence rate** = Absent / (Present + Late + Absent)

## Project structure

```
attendee/
├── server.js            Express app: sessions, auth, worker and HR APIs, page guards
├── db.js                SQLite connection, schema and automatic migration
├── analytics.js         Analytics queries and rate definitions
├── scripts/
│   ├── seed.js          Seeds 75 users with hashed passwords
│   └── seed_history.js  Synthetic attendance history for practice
└── views/
    ├── login.html
    ├── worker.html      Check in / check out dashboard
    ├── hr.html          Read-only HR attendance view
    └── analytics.html   Charts and insights
```

## Database schema

- `users` (id, username unique, password_hash, name, role `worker|hr`, department, job_title, location)
- `attendance` (id, user_id, date, status `Present|Late|Absent|On Leave`, marked_by, marked_at, check_in, check_out, late_minutes), with `UNIQUE(user_id, date)` so each person has one record per day

## API

| Method | Route | Access |
|---|---|---|
| POST | `/api/login`, `/api/logout` | anyone |
| GET | `/api/worker/today` | worker |
| POST | `/api/worker/checkin`, `/api/worker/checkout` | worker (once each per day) |
| GET | `/api/hr/employees?q=&department=&status=&date=` | HR |
| GET | `/api/hr/summary?date=` | HR |
| GET | `/api/hr/totals?month=YYYY-MM` | HR |
| GET | `/api/hr/analytics?days=30\|60\|90\|180` | HR |
| GET | `/api/hr/export.csv` | HR |

## Limitations and ideas for next steps

- Workers can only be recorded as Present or Late. There is no leave-request flow, and people who never check in stay "Not marked".
- No change-password screen yet. Seeded passwords must be changed before real use.
- Sessions are stored in memory, so use a persistent store (such as Redis) in production.
- Times use the server's clock. A production version should handle time zones.
- Ideas: leave requests, automatic absence marking at day end, a change-password page, tests, and Docker support.

## Before deploying for real use

Set a strong `SESSION_SECRET`, serve over HTTPS with `NODE_ENV=production` (and `app.set('trust proxy', 1)` behind a proxy), use a persistent session store, replace all seeded passwords, and back up `attendee.db`.
