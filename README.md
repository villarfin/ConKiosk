# ConKiosk – Smart Faculty Consultation Management System

A complete 4-component consultation management system for universities, built as a capstone project.

![Status](https://img.shields.io/badge/status-active-success)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688)
![Frontend](https://img.shields.io/badge/frontend-Expo%20%2F%20React%20Native-000020)
![Database](https://img.shields.io/badge/database-PostgreSQL-4169E1)

---

## Table of Contents

1. [What is ConKiosk?](#what-is-conkiosk)
2. [System Components](#system-components)
3. [Tech Stack](#tech-stack)
4. [Quick Start (Development)](#quick-start-development)
5. [Roles, Registration, and Privacy](#roles-registration-and-privacy)
6. [Offline LAN Access](#offline-lan-access)
7. [Test Credentials](#test-credentials)
8. [What Each File Does](#what-each-file-does)
9. [Customization Guide](#customization-guide) ← **edit faculty, students, colors, cards, images**
10. [Raspberry Pi 5 Deployment](#raspberry-pi-5-deployment)
11. [Troubleshooting](#troubleshooting)

---

## What is ConKiosk?

ConKiosk digitizes faculty consultations. Instead of manual queues and uncertainty:

- Students walk up to a **kiosk** and request a consultation (QR scan or manual entry).
- Faculty see requests instantly on their **mobile app** and accept/decline/reschedule.
- A **TV display** outside the office shows live queue numbers and faculty availability.
- Everything syncs in real time via a **Raspberry Pi 5** server.

---

## System Components

| # | Component | Role | Where It Runs |
|---|-----------|------|---------------|
| 1 | **Faculty Mobile App** | Login, view/accept/decline requests, manage availability, history | Faculty phone (Expo Go or built APK/IPA) |
| 2 | **Student Kiosk** | Public touchscreen for students to request consultations | Chromium on RPi's touchscreen |
| 3 | **TV Queue Display** | Real-time board showing all faculty statuses and queue numbers | Chromium on monitor connected to RPi |
| 4 | **Raspberry Pi 5 Server** | FastAPI backend + PostgreSQL + WebSockets | The RPi itself |

All four components live in **one codebase** in this repo.

## Roles, Registration, and Privacy

| Role | Access |
|---|---|
| **Faculty** | Manages availability, consultation requests, consultation notes/feedback, profile, and history. |
| **IT Chair** | Read-only faculty, student, and consultation records. Consultation detail includes student information and the faculty-authored Notes/feedback. |
| **Administrator** | Manages registrations, faculty profiles and availability, administrator credentials, IT Chair assignment, and faculty accounts. |

New faculty accounts are created in a pending state and cannot sign in until an
Administrator approves them. Registration requires password confirmation and a Privacy
Notice acknowledgment. Before production use, the school must have its Data Protection
Officer review the notice and replace its official institution, retention, and DPO-contact details.

Administrative safeguards: approving/rejecting registrations and IT Chair transfers
require confirmation; faculty deletion additionally requires the current administrator
password, verified by the API. Deleting an account immediately revokes that faculty
member's active app session.

## Offline LAN Access

Normal operation does not require internet access. Connect the Raspberry Pi, faculty
phones, kiosk, and TV to the same dedicated router. For a Pi at `192.168.0.2`:

| Interface | LAN address |
|---|---|
| Faculty web app | `http://192.168.0.2/login` |
| Student kiosk | `http://192.168.0.2/kiosk` |
| TV queue display | `http://192.168.0.2/tv` |
| Health check | `http://192.168.0.2/api/health` |

For Expo Go development, use `EXPO_PUBLIC_API_URL=http://192.168.0.2/api` (replace
the IP with the Pi's actual LAN address). `yarn start:lan` prefers Ethernet when both
Ethernet and Wi-Fi are connected and uses the Nginx API endpoint by default. See
[LAN_OFFLINE_DEPLOYMENT.md](LAN_OFFLINE_DEPLOYMENT.md) for full deployment and testing.

---

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, PostgreSQL, native WebSockets, JWT auth (bcrypt)
- **Frontend:** Expo (React Native) + TypeScript + Expo Router
- **Real-time:** Native WebSockets with automatic client reconnection
- **QR Scanning:** USB HID keyboard scanners (no special driver)

---

## Quick Start (Development)

### Prerequisites
- Node.js 18+ and `yarn`
- Python 3.11+
- PostgreSQL (local install or Docker)
- Expo Go app on your phone (for mobile testing)

### Start the whole system

Run these services in separate terminals from the project folder:

```bash
# Terminal 1: start PostgreSQL (Linux systems using systemd)
sudo systemctl start postgresql

# Terminal 2: start the FastAPI API and WebSocket server
cd backend
source venv/bin/activate
uvicorn server:socket_app --host 0.0.0.0 --port 8001 --reload

# Terminal 3: detects the Pi's current LAN IP, then starts the frontend
cd frontend
yarn start:lan
```

When Expo is ready, open `http://localhost:8081/kiosk` for the student kiosk and
`http://localhost:8081/tv` for the TV queue display. Scan the Expo QR code with
Expo Go for the faculty mobile app. `yarn start:lan` detects the Raspberry Pi's
current Wi-Fi/Ethernet address every time it starts, so changing Wi-Fi does not
require editing `frontend/.env`. Keep the phone and Raspberry Pi on the same network.

### 1. Clone the repo
```bash
git clone https://github.com/<your-username>/ConKiosk.git
cd ConKiosk
```

### 2. Backend setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env from the safe template, then set PostgreSQL credentials and a random JWT secret.
cp .env.example .env

# Start the server
uvicorn server:socket_app --host 0.0.0.0 --port 8001 --reload
```

### 3. Seed demo data only (development only)
```bash
echo ALLOW_SEED_DATA=true >> .env
curl -X POST http://localhost:8001/api/seed
```
This destructive endpoint creates demo data. Never enable it or run it against real data.

### 4. Frontend setup
```bash
cd ../frontend
yarn install

# Create .env
cat > .env <<EOF
EXPO_PUBLIC_API_URL=http://localhost:8001/api
EOF

# Start Expo
yarn start
```

### 5. Access the three interfaces
- **Faculty Mobile App**: Scan the QR code shown in the terminal with Expo Go
- **Student Kiosk**: Open `http://localhost:8081/kiosk` in browser
- **TV Display**: Open `http://localhost:8081/tv` in browser

### 6. Safe pre-deployment pilot

Do not test using the production database. Create a separate PostgreSQL database and
use `backend/.env.test.example` as its configuration template. The integration suite
intentionally requires `RUN_INTEGRATION_TESTS=true` before it can reset test data.

For phone testing, set `EXPO_PUBLIC_API_URL` to the server's LAN API URL (not
`localhost`), run `yarn start:lan`, and open the app in Expo Go on phones connected to
the same Wi-Fi. When the pilot passes, build an installable Android APK with
`npx eas-cli build --profile preview --platform android`; `preview` is for internal
faculty distribution, while `production` produces a Play Store AAB.

---

## Test Credentials

Faculty accounts (all use password `password123`):
| School ID | Name | Department |
|-----------|------|------------|
| FAC2024001 | Dr. Maria Santos | Computer Science |
| FAC2024002 | Prof. Juan Reyes | Information Technology |
| FAC2024003 | Dr. Elena Cruz | Mathematics |
| FAC2024004 | Prof. Antonio Villar | Engineering |
| FAC2024005 | Dr. Sofia Mendoza | Business Administration |
| FAC2024006 | Prof. Roberto Lim | Computer Science |

Sample student IDs for QR testing: `STU2024101` to `STU2024108`.

---

## What Each File Does

```
ConKiosk/
├── backend/
│   ├── server.py              ← ALL backend logic, endpoints, seed data
│   ├── requirements.txt       ← Python dependencies
│   └── .env                   ← PostgreSQL URL + JWT secret (do NOT commit)
│
├── frontend/
│   ├── app/
│   │   ├── _layout.tsx        ← Root layout, wraps app in AuthProvider
│   │   ├── index.tsx          ← Landing page, redirects to /login or /dashboard
│   │   ├── login.tsx          ← Faculty login screen
│   │   ├── signup.tsx         ← Faculty registration + privacy acknowledgment
│   │   ├── admin.tsx          ← Administrator controls and protected actions
│   │   ├── admin-account.tsx  ← Administrator profile/password management
│   │   ├── tv.tsx             ← TV queue display  (compact cards)
│   │   │
│   │   ├── (tabs)/            ← FACULTY MOBILE APP (5 bottom tabs)
│   │   │   ├── _layout.tsx    ← Bottom nav config
│   │   │   ├── dashboard.tsx  ← Home tab (stats, availability toggle)
│   │   │   ├── requests.tsx   ← Consultation requests inbox
│   │   │   ├── history.tsx    ← Consultation history with search/filter
│   │   │   ├── notifications.tsx
│   │   │   └── profile.tsx    ← Profile edit, change password, logout
│   │   │   └── it-chair.tsx   ← Read-only institutional consultation records
│   │   │
│   │   └── kiosk/             ← STUDENT KIOSK (touchscreen)
│   │       ├── _layout.tsx    ← Stack navigator for kiosk flow
│   │       ├── index.tsx      ← Faculty grid landing page
│   │       ├── identify.tsx   ← Student ID entry (QR + manual)
│   │       ├── request.tsx    ← Topic entry & submission
│   │       └── confirmation.tsx  ← Queue number display
│   │
│   ├── src/
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx  ← Login/logout, JWT, WebSocket client
│   │   └── utils/
│   │       ├── api.ts         ← HTTP client with auth headers
│   │       └── storage/       ← Wrapper around SecureStore + AsyncStorage
│   │
│   ├── .env                   ← EXPO_PUBLIC_API_URL (do NOT commit)
│   └── package.json
│
├── RPI5_DEPLOYMENT.md         ← Complete RPi 5 deployment guide
└── README.md                  ← This file
```

---

## Customization Guide

### 🎨 1. Change the Color Theme

**Primary blue** appears everywhere. To rebrand, find and replace this hex:
- **Current color:** `#2196F3` (Material Blue)
- Search all files under `/frontend/app/` and `/frontend/src/` and replace with your color.

**Status colors** (in every screen file's `getStatusColor` function):
```ts
case 'available': return '#4CAF50';    // Green
case 'busy':      return '#FF9800';    // Orange
case 'unavailable': return '#F44336';  // Red
```

**TV Display background** (dark theme):
- File: `frontend/app/tv.tsx`
- Change `backgroundColor: '#0F172A'` (main bg) or `'#1E293B'` (cards)

### 👨‍🏫 2. Add / Edit / Remove Faculty

Edit the seed function in `backend/server.py`:

```python
# Find the section starting with:
faculty_list = [
    {
        "school_id": "FAC2024001",
        "password_hash": get_password_hash("password123"),
        "full_name": "Dr. Maria Santos",
        "department": "Computer Science",
        "office_location": "Room 301, Science Building",
        "email": "maria.santos@university.edu",
        "availability_status": "available",   # available | busy | unavailable
        "office_hours": "Mon-Fri 9:00 AM - 5:00 PM"
    },
    # ADD MORE FACULTY HERE ↓
    {
        "school_id": "FAC2024007",
        "password_hash": get_password_hash("your-chosen-password"),
        "full_name": "Dr. New Professor",
        "department": "Physics",
        "office_location": "Room 205, Science Building",
        "email": "newprof@university.edu",
        "availability_status": "available",
        "office_hours": "Mon-Wed-Fri 10:00 AM - 4:00 PM"
    },
]
```

After editing, re-seed:
```bash
curl -X POST http://localhost:8001/api/seed
```

**Warning:** `/api/seed` wipes all data and re-inserts.

### 👨‍🎓 3. Add / Edit Students

In the same `backend/server.py`, edit the `students` list:

```python
students = [
    {"student_id": "STU2024101", "full_name": "John Dela Cruz",
     "year_level": "4th Year", "section": "BSCS-4A"},

    # ADD MORE STUDENTS HERE ↓
    {"student_id": "STU2024109", "full_name": "New Student",
     "year_level": "1st Year", "section": "BSIT-1A"},
]
```

**In production**, students should be added via a proper registration flow or CSV import — not via seed. For now, students can also self-register by typing their info at the kiosk (auto-saved on submission).

### 🖼️ 4. Change Profile Images

**Faculty profile images** are stored as base64 in PostgreSQL.
- Users upload from their phones via Profile → tap avatar → pick from gallery.
- For seed data, you can add a base64 string:
```python
{
    "school_id": "FAC2024001",
    "profile_image": "data:image/jpeg;base64,/9j/4AAQSkZJ...",
    ...
}
```
Use any online image-to-base64 converter.

**App logo / branding image:**
- File: `frontend/assets/images/`
- Replace `icon.png`, `adaptive-icon.png`, `splash-image.png` with your university logo.
- Update `frontend/app.json` if needed.

### 🃏 5. Edit the TV Display Cards

File: **`frontend/app/tv.tsx`**

**Card layout & size:**
```ts
// Line ~130-145 controls responsive columns
if (width >= 1600) columnCount = 4;      // 4K TVs
else if (width >= 1200) columnCount = 3; // 1080p TVs
else if (width >= 800) columnCount = 2;
else columnCount = 1;
```

**Card contents** — search for `<View key={f.school_id}` and edit what's shown:
- Change avatar size: `styles.avatar` — currently `width: 54, height: 54`
- Change name font: `styles.facultyName` — currently `fontSize: 15, fontWeight: '700'`
- Change queue number size: `styles.queueNumber` — currently `fontSize: 20`
- Add/remove fields (like "Next patient", "ETA", etc.) inside the card JSX

**Header summary chips:**
Look for `<View style={styles.summaryRow}>` — you can hide the counts or add more.

**Fallback refresh interval** (WebSockets reconnect automatically):
```ts
const poll = setInterval(loadData, 10000);  // Every 10 seconds
```

### 🎫 6. Edit the Kiosk Cards (Faculty Grid)

File: **`frontend/app/kiosk/index.tsx`**

- **Card width** (2-column grid): `styles.card.width` — currently `'48%'`
- **Card content**: search `<TouchableOpacity ... testID={faculty-card-...`
- **Avatar shape**: change `borderRadius: 32` to `0` for square cards

### 📝 7. Edit Consultation Request Form

File: **`frontend/app/kiosk/request.tsx`**
- Add fields (e.g., "priority level", "estimated duration") to the `TextInput`s
- Update the backend model `KioskConsultationRequest` in `backend/server.py` to accept the new fields
- Update the queue entry insert in `submit_kiosk_request` to store them

### 🔔 8. Edit Notification Types

File: **`backend/server.py`** — search for `"type":` in notification inserts.

Current types: `new_request`, `accepted`, `declined`, `cancelled`, `rescheduled`, `reminder`, `system`.

To add a new type, also update the icon mapping in **`frontend/app/(tabs)/notifications.tsx`** — function `getNotificationIcon`.

### ⏱️ 9. Change Queue Auto-return Time (Kiosk)

File: **`frontend/app/kiosk/confirmation.tsx`** line ~19:
```ts
const t = setTimeout(() => {
  router.replace('/kiosk');
}, 15000);   // 15 seconds — change to your preference
```

### 🔐 10. Change JWT Expiration & Secret

File: **`backend/server.py`**
```python
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "conkiosk-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30   # Change to your preference
```

**Always set `JWT_SECRET_KEY` in `.env`** — never commit the real value.

### 📱 11. Change App Name / Bundle ID

File: **`frontend/app.json`**
```json
{
  "expo": {
    "name": "ConKiosk",              ← App display name
    "slug": "conkiosk",
    "ios": { "bundleIdentifier": "com.youruni.conkiosk" },
    "android": { "package": "com.youruni.conkiosk" }
  }
}
```

### 🏫 12. Filter TV Display by Office (if you have multiple TVs)

Not implemented yet — but easy to add:
1. Add `office_room` field to faculty seed data
2. Backend: change `GET /api/tv-display/status` to accept `?office=Room301` query
3. Frontend: read `office` from URL: `/tv?office=Room301`

Ask the maintainer or implement it yourself; the route is in `backend/server.py` around line 700.

---

## Raspberry Pi 5 Deployment

See **`RPI5_DEPLOYMENT.md`** for the full step-by-step guide, including:
- Installing PostgreSQL, Python, Chromium on RPi 5
- Running the backend as a systemd service
- Setting up the kiosk to auto-launch on boot
- Configuring nginx to serve the web build and proxy WebSockets
- USB QR scanner setup (HID keyboard, no drivers needed)
- Security hardening for production use

**Short version:**
1. Install PostgreSQL and Python 3.11 on the RPi.
2. Copy this repo to the RPi.
3. Run backend as a service (see `.service` file example in the guide).
4. On your dev machine: `cd frontend && npx expo export -p web` — creates a `dist/` folder.
5. Copy `dist/` to the RPi, serve via nginx.
6. Point Chromium (kiosk mode) at `http://localhost/kiosk` and `http://localhost/tv`.
7. Update the mobile app's `.env` to use the Nginx LAN API: `EXPO_PUBLIC_API_URL=http://192.168.x.x/api`
8. Build the APK (see Expo docs or use EAS Build).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Faculty app can't reach backend | Check that phone + RPi are on the same WiFi. Verify RPi's IP with `hostname -I`. Check `frontend/.env`. |
| Faculty cannot sign in after registering | An Administrator must approve the pending registration first. |
| Kiosk / TV shows blank page | Ensure Expo dev server is running, or that `nginx` is serving the `dist/` folder. |
| Real-time updates do not arrive | Check nginx `proxy_pass` for `/ws` and the backend service logs. |
| PostgreSQL won't start | `sudo journalctl -u postgresql` — often out of disk space or a configuration issue. |
| QR scanner types garbage | Most scanners have a config mode (scan a "settings" barcode from their manual). Set to "USB HID keyboard, English, US layout, add Enter suffix." |
| 500 error on any endpoint | Check backend logs: `sudo journalctl -u conkiosk -f`. |
| I broke seed data | Just re-run `curl -X POST http://<backend-url>/api/seed`. |

---

## Production deployment checklist

- [ ] Copy `backend/.env.example` to `backend/.env`; set `ENVIRONMENT=production`, a long unique `JWT_SECRET_KEY`, restricted `CORS_ORIGINS`, and `ALLOW_SEED_DATA=false`.
- [ ] Use a dedicated PostgreSQL account with a strong password and least-privilege access.
- [ ] Import faculty and student records through an approved administrative process. Do not call `/api/seed` after real data exists.
- [ ] Have the school's Data Protection Officer review the registration Privacy Notice and add the official institution name, DPO contact details, and retention schedule.
- [ ] Keep the kiosk and TV on the school network; use a firewall to expose only the required local ports. Enable HTTPS if any access leaves that network.
- [ ] Back up PostgreSQL regularly and test restoring a backup: `pg_dump -U conkiosk conkiosk > conkiosk.sql`.
- [ ] Test the full workflow with non-production accounts: scan → submit → queue ticket → faculty start → TV “Now Serving” → complete.

---

## API Reference

Base URL: `http://<backend-url>/api`

### Public (Kiosk / TV)
- `GET /kiosk/faculty` — List all faculty with availability
- `GET /kiosk/students/{student_id}` — Lookup student by ID
- `POST /kiosk/students` — Create/update student
- `POST /kiosk/consultation-request` — Submit consultation request from kiosk
- `GET /kiosk/queue/{faculty_school_id}` — Get faculty queue
- `GET /tv-display/status` — Full TV dashboard data

### Authenticated (Faculty App)
- `POST /auth/login`
- `POST /auth/signup` — creates a pending faculty registration
- `POST /auth/change-password`
- `GET/PATCH /faculty/profile`
- `PATCH /faculty/availability`
- `GET /dashboard/stats`
- `GET /consultation-requests` — list pending
- `POST /consultation-requests/{id}/action` — accept/decline/reschedule
- `GET/PATCH /consultations` — history, notes, remarks
- `POST /consultations/{id}/start` — auto-sets faculty to busy
- `POST /consultations/{id}/complete` — auto-sets back to available, advances queue
- `GET/PATCH /notifications`, `POST /notifications/mark-all-read`

### Administrator / IT Chair records
- `GET /admin/summary`, `GET /admin/faculty`, `GET /admin/students`
- `GET /admin/faculty/{school_id}/consultations` — read-only consultation records,
  including faculty Notes/feedback for authorized Administrator and IT Chair users
- `POST /admin/faculty/{school_id}/approve` and `POST /admin/faculty/{school_id}/reject`
- `POST /admin/it-chair/{school_id}`, `DELETE /admin/it-chair`
- `DELETE /admin/faculty/{school_id}` — requires an authenticated Administrator and
  JSON body `{ "admin_password": "current-password" }`

---

## Contributing / Extending

Some ideas for future work:
- **Analytics dashboard** for department heads (per-department trends, response times)
- **Email notifications** via SendGrid or Resend
- **Push notifications** for the mobile app (via Expo push service)
- **QR code generator** endpoint that prints student ID cards as PDFs
- **Multi-office support** — filter TV display by office/building
- **Group chat** for group consultations

---

## License

This is a student capstone project. Adapt freely for your own school.

---

## Credits

Built as a capstone project.
System architecture based on the ConKiosk specification.

---

**For deployment questions, refer to `RPI5_DEPLOYMENT.md`.**
