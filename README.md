# ConKiosk — Faculty Consultation Management System

ConKiosk is a capstone project for managing student–faculty consultations through a
student kiosk, a faculty web/mobile application, an administrator interface, and a
TV queue display. A Raspberry Pi 5 hosts the API and database on a local network.
Normal consultation operations do not require an internet connection.

This README documents the implemented software and its installation, operation,
testing, and handover. The capstone manuscript remains the source for the approved
research title, researchers, institution, adviser, methodology, and evaluation
results. No user-study results or performance guarantees are implied here.

## Contents

- [Purpose and scope](#purpose-and-scope)
- [Architecture and technology](#architecture-and-technology)
- [Users and access](#users-and-access)
- [Consultation workflow](#consultation-workflow)
- [Requirements](#requirements)
- [Development setup](#development-setup)
- [Raspberry Pi deployment](#raspberry-pi-deployment)
- [Account management and security](#account-management-and-security)
- [Student records and privacy](#student-records-and-privacy)
- [Backups and recovery](#backups-and-recovery)
- [Testing and capstone demonstration](#testing-and-capstone-demonstration)
- [API overview](#api-overview)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Limitations and handover](#limitations-and-handover)

## Purpose and scope

The project supports these operational objectives:

- Let students identify themselves through a USB QR scanner or manual entry and
  submit individual/group consultation requests without creating an account.
- Give faculty a way to accept, decline, or reschedule requests, maintain
  availability, and record consultation notes/feedback.
- Display faculty availability, the current queue number, and upcoming numbers
  on a TV without requiring scrolling.
- Give administrators account controls and the IT Chair authorized read-only
  access to institutional records.
- Retain consultation history locally and support offline LAN deployment.

The implemented scope covers consultations, queues, accounts, notifications, and
records. It does not include student chat, file/audio exchange, payment processing,
or cloud push/email notifications. Profile pictures are supported.

## Architecture and technology

```text
Faculty phones / laptop              Dedicated router
  Web app or Expo Go  <----------->  e.g. 192.168.0.1
                                           |
                                  Raspberry Pi 5
                                  e.g. 192.168.0.2
                                           |
                              Nginx: HTTP 80 / HTTPS 443
                                           |
                              FastAPI + WebSocket API
                                  127.0.0.1:8001
                                           |
                                    PostgreSQL
                                  127.0.0.1:5432

Pi touchscreen: Chromium /kiosk
Pi HDMI2 TV:    separate Chromium profile /tv
```

| Layer | Implementation |
|---|---|
| Web/mobile UI | Expo SDK 54, React Native, TypeScript, Expo Router |
| API | Python, FastAPI, SQLAlchemy async, Uvicorn |
| Database | PostgreSQL |
| Authentication | bcrypt password hashes, JWTs backed by revocable sessions |
| Live updates | Native WebSockets with reconnect and polling fallbacks |
| Pi deployment | Raspberry Pi OS 64-bit, Nginx, systemd, Chromium/Labwc |
| Student ID input | USB HID keyboard QR scanner or manual entry |

This repository uses **FastAPI and PostgreSQL**, not Laravel, PHP, or MariaDB.
Phones communicate with the API; they never connect directly to PostgreSQL.

The router address is not the server address. The example router is
`192.168.0.1`; the Pi is `192.168.0.2`. Give the Pi a DHCP reservation or a suitable
static address outside the router's dynamic pool. Disable AP/client isolation.

## Users and access

| User | Access |
|---|---|
| Student | Uses the public kiosk without logging in; submits a topic and student details, then receives a queue number. |
| Faculty | Manages own availability, requests, consultations, notes, profile, and notifications. |
| IT Chair | Has normal faculty functions plus read-only faculty, student, and consultation records. Cannot approve accounts, transfer roles, or delete accounts. |
| Administrator | Approves/rejects registrations, manages faculty, transfers IT Chair access, resets passwords, selects deletion options, and views audit records. |

New faculty registrations remain pending until approved. Approval/rejection and
role transfers require confirmation. Destructive account operations additionally
require the current administrator password, checked by the backend.

## Consultation workflow

1. A student selects a faculty member accepting consultations at `/kiosk`.
2. The student scans/enters an ID, completes the required information, selects an
   individual or group consultation, and submits a topic.
3. The kiosk displays a queue ticket. Faculty receive the request.
4. Accepting the first eligible request starts its consultation and sets faculty
   availability to Busy. Further accepted students remain Waiting in queue order.
5. Only one session can be Ongoing per faculty. A pending request at the front
   must be processed before a later student can start.
6. Faculty enter notes and choose Complete & Advance Queue, Complete & Pause
   Queue, or cancellation with a reason. Completion saves notes in the same action.
7. Advancement calls the next accepted student. Pausing sets availability to
   Unavailable; faculty can later start the first waiting consultation explicitly.
8. Completed and Cancelled records are read-only in the UI and API.

Accepted queue entries use the stored `scheduled` status but display as Waiting
in faculty History. Future appointments display as Scheduled and cannot start
before their date. Rescheduling creates a future appointment and removes the
original ticket from the active queue. There is no automatic appointment reminder.

New queue numbers use one persistent counter shared by every faculty. Two students
submitting simultaneously to different faculty receive different numbers. Numbering
continues when queues empty and after server restarts; it does not reset per faculty
or per day. Consultation history retains its ticket/group snapshot. Tickets issued
before this change keep their original numbers and should still be identified by
faculty/office; legacy duplicates disappear from the live board as those tickets close.

The TV uses navy blue, gold, and white, fits all faculty cards into its available
area, and shows large queue numbers in a separate full-height right panel. Queue
pages rotate when needed. New calls trigger a chime; an existing browser may need
one click on Sound to authorize playback. A disconnected display marks stale data.

## Requirements

### Development

- Node.js **20.19.4 or newer**, matching the installed React Native dependency.
- Python 3.11+ with virtual-environment support.
- PostgreSQL, Git, and npm; use the committed npm lockfile with `npm ci`.
- Expo Go compatible with the project's SDK for native development testing.
- Phone and development server on the same LAN for Expo Go.

### Deployment hardware

- Raspberry Pi 5 running Raspberry Pi OS 64-bit with sufficient storage.
- Dedicated router and Ethernet cable/Wi-Fi connectivity.
- Touchscreen and optional USB HID QR scanner for the kiosk.
- TV connected to the same Pi's second HDMI output for the current dual-display setup.
- Reliable power; a UPS and an external backup device are recommended for handover.

Installing dependencies, downloading Expo Go, OS updates, and cloud builds may
require internet. After installation, the Nginx-served web app, API, and database
operate locally. Native Expo Go must load its bundle from a running LAN Metro
server; it is not the production web server. Icon fonts are bundled locally.

## Development setup

### 1. Obtain the project and database

```bash
git clone https://github.com/villarfin/ConKiosk.git
cd ConKiosk
sudo systemctl start postgresql
sudo -u postgres createuser --pwprompt conkiosk
sudo -u postgres createdb --owner=conkiosk conkiosk
```

The PostgreSQL commands are for a new Linux installation. If the role/database
already exist, keep them and their credentials. Do not recreate or reset real data.

### 2. Configure the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the template only on first setup; do not overwrite an existing `.env`.
Restrict its permissions with `chmod 600 backend/.env` from the repository root.
Edit `backend/.env`; use the generated value as the JWT secret. URL-encode special
characters in database credentials. The following values illustrate a development
API directly accessible on the LAN:

```dotenv
DATABASE_URL=postgresql+asyncpg://conkiosk:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/conkiosk
JWT_SECRET_KEY=YOUR_GENERATED_SECRET
ENVIRONMENT=development
ALLOW_SEED_DATA=false
LAN_ORIGIN=http://192.168.0.2
CORS_ORIGINS=http://192.168.0.2:8081,http://localhost:8081
ADMIN_SCHOOL_ID=YOUR_ADMINISTRATOR_ID
ADMIN_PASSWORD=YOUR_PRIVATE_INITIAL_ADMINISTRATOR_PASSWORD
ADMIN_NAME=ConKiosk Administrator
KIOSK_ALLOWED_IPS=127.0.0.1,::1
REQUIRE_STUDENT_ROSTER=false
PRIVACY_INSTITUTION=
PRIVACY_CONTACT=
PRIVACY_RETENTION=
```

Set real private administrator credentials before first startup. Startup creates
the configured administrator if absent; faculty register through the UI. There
is no published production password. The bootstrap password does not reset an
existing account. It may be removed from the environment after initial creation;
use the password-management UI or local recovery command thereafter.

Start the development backend:

```bash
uvicorn server:socket_app --host 0.0.0.0 --port 8001 --reload
```

Binding to all interfaces is for trusted-LAN development. Production binds Uvicorn
to loopback behind Nginx. First startup creates tables; existing installations also
receive the compatibility schema updates implemented in `backend/server.py`.

### 3. Configure and start Expo

In another terminal from the repository root:

```bash
cd frontend
npm ci
cp .env.example .env
```

For the direct development API above, set:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.0.2:8001/api
```

Replace the IP with the development API machine's actual LAN address. Add that
machine's Metro browser origin to backend CORS configuration when using Expo web.

```bash
npx expo start --lan
```

Scan the terminal QR with Expo Go. Browser development routes are
`http://localhost:8081/kiosk` and `http://localhost:8081/tv` on the development
machine. A phone must use that machine's LAN address instead of localhost.

When developing against the deployed Pi through Nginx, use
`EXPO_PUBLIC_API_URL=http://192.168.0.2/api`. The optional `npm run start:lan`
launcher selects a local private IP and overrides the API URL for that process;
it is intended for a machine hosting the API/Nginx. For a laptop using a separate
Pi server, use `npx expo start --lan` to preserve the configured Pi API URL.

### Demo data

`POST /api/seed` is destructive and permitted only when the backend is in
development/test mode with `ALLOW_SEED_DATA=true`. Never enable it on a real
installation. Use only a disposable database; see [backend tests](backend/tests/README.md).

Seeded demo faculty IDs `FAC2024001`–`FAC2024006` use `password123` only in that
disposable dataset. These are not deployment credentials. Manage real faculty
through registration/administration and students through the kiosk or roster import.

## Raspberry Pi deployment

The supplied service paths assume `/home/conkiosk/ConKiosk` and Linux user
`conkiosk`. Adjust templates before installing on another account/path.

1. Install PostgreSQL, Python/venv, Nginx, Chromium, and the desktop display tools
   required by the Pi's Labwc configuration. Install project dependencies as above.
2. Configure `backend/.env` with `ENVIRONMENT=production`, `ALLOW_SEED_DATA=false`,
   private credentials, the Pi LAN origin, and explicitly allowed browser origins.
3. Build the web frontend with the Nginx API URL:

   ```bash
   cd /home/conkiosk/ConKiosk/frontend
   npm ci
   npx expo export --platform web --output-dir dist
   ```

4. Install the API service and HTTP site. Review existing Nginx sites first; only
   one site should own the default listener. Do not overwrite unrelated sites.

   ```bash
   cd /home/conkiosk/ConKiosk
   sudo install -m 644 deploy/conkiosk-backend.service /etc/systemd/system/conkiosk.service
   sudo install -d /var/www/conkiosk
   sudo rsync -a frontend/dist/ /var/www/conkiosk/
   sudo install -m 644 deploy/conkiosk.nginx.conf /etc/nginx/sites-enabled/conkiosk
   sudo nginx -t
   sudo systemctl daemon-reload
   sudo systemctl enable --now postgresql conkiosk.service nginx
   sudo systemctl reload nginx
   ```

5. Install and verify the backup service before using real records; see the next
   sections and [deployment/security notes](deploy/HARDENING.md).
6. Keep PostgreSQL/Uvicorn loopback-only. Clients need HTTP/HTTPS, not database
   port 5432 or backend port 8001. Port 8081 is only needed for Metro development.
7. Verify the end-to-end workflow with WAN disconnected before handover.

| Interface | Example address |
|---|---|
| Faculty sign-in | `http://192.168.0.2/login` |
| Student kiosk; no student login | `http://192.168.0.2/kiosk` |
| TV display | `http://192.168.0.2/tv` |
| API/database health | `http://192.168.0.2/api/health` |
| Additional HTTPS listener, when installed | `https://192.168.0.2` |

Browser deployments use the page's origin for API calls. Native Expo clients use
`EXPO_PUBLIC_API_URL`. Never include database passwords or JWT signing secrets in
any `EXPO_PUBLIC_*` value.

### Boot and two displays

The backend service waits for local PostgreSQL, not Wi-Fi or internet. It can start
before the router is connected; clients gain access once the Pi has its LAN address.
Production kiosk/TV browsers do not need Metro.

`deploy/conkiosk-dual-display.sh` opens independent Chromium profiles for the
touchscreen (`HDMI-A-1`) and TV (`HDMI-A-2`). Its desktop entry is installed in the
user's autostart directory; Labwc placement rules select the physical displays.
The current placement template contains installation-specific screen dimensions,
positions, and touch-device name: inspect `wlr-randr` and adapt it to the actual
hardware. Merge rules into an existing Labwc configuration rather than replacing
unrelated desktop preferences.

The graphical desktop must log in automatically for desktop autostart to run. The
launcher waits up to approximately two minutes for API health and both outputs,
then exits if either display is missing. Power on/select the TV's input before
boot; if necessary, rerun the launcher after connecting both displays.

For the `conkiosk` desktop user, install the supplied launcher/entry from the
repository root:

```bash
install -d "$HOME/.local/bin" "$HOME/.config/autostart"
install -m 755 deploy/conkiosk-dual-display.sh "$HOME/.local/bin/conkiosk-dual-display"
install -m 644 deploy/conkiosk-dual-display.desktop "$HOME/.config/autostart/conkiosk-dual-display.desktop"
```

The desktop entry contains an absolute `conkiosk` home path; adapt it for another
user. Merge the reviewed `deploy/conkiosk-labwc-rc.xml` rules into
`~/.config/labwc/rc.xml`, configure the actual monitor arrangement, then test a
desktop restart before relying on unattended boot.

### HTTPS

The supplied HTTPS template and `deploy/setup-lan-tls.sh` support a private LAN CA.
See [HTTPS setup and certificate trust](deploy/HARDENING.md#https-on-this-pi).
Phones must trust that CA before HTTPS can be used without warnings. HTTP remains
available during migration and is unencrypted. Enabling an HTTPS listener alone
does not encrypt clients that continue using HTTP. Native Expo Go trust behavior
must be checked on the actual phone. Keep CA/private keys outside Git and renew
the server certificate before expiry.

## Account management and security

- Passwords are hashed with bcrypt. New passwords require at least eight characters
  and fit bcrypt's 72-byte UTF-8 input limit; they are not stored in plaintext.
- Sessions expire after 12 hours and are backed by server-side session records.
  Logout revokes the current session; a password change/reset revokes all sessions
  for that account. Protected endpoints check current approval, account, and role.
- Login, registration, and sensitive administrative actions are throttled. Clear
  login messages intentionally distinguish missing accounts and wrong passwords.
- WebSocket credentials are sent in the first frame rather than the URL.
- Input validation, ownership checks, confirmation dialogs, and database locking
  protect account and consultation changes. These do not replace network security.
- `.env` and private keys must not be committed. Keep the Pi, router credentials,
  and operator account restricted to authorized personnel.
- Administrative audit records capture the actor ID, action, target, and time.
  The administrator can view them in the audit screen. They are not a full
  tamper-proof external audit system.

### Faculty deletion choices

The administrator re-enters their password and explicitly selects either:

| Choice | Result |
|---|---|
| Delete account only | Archive the account, revoke sessions, cancel unfinished consultations, remove live queue/request data, and retain consultation history. |
| Delete account and history | Also delete that faculty's consultation records/notes and submission receipts, and clear the archived profile details. |

School IDs remain reserved to prevent reuse by a different person. Retained history
is accessible through archived faculty entries. Deletion does not remove shared
student roster entries or audit records and does not rewrite existing backups.
History deletion cannot be undone in the app; authorized backup restoration is a
separate operation that can affect other data and must be planned accordingly.

The administrator's **Archived Faculty** section also provides cleanup after an
account has already been deleted:

- **View archived records** opens the retained consultation history.
- **Delete archived records** permanently deletes that faculty's consultation
  records/notes while keeping the archived faculty entry.
- **Remove archived faculty** permanently removes the archived faculty entry and
  any remaining consultation records. A minimal reserved School ID remains to
  prevent reuse; the profile is no longer listed.

Both cleanup actions require explicit confirmation and the administrator's current
password. They apply only to already archived accounts, are recorded in the audit
log, and do not delete shared student records or existing backups.

### Password recovery

Administrators can reset a faculty password from its management card after entering
their own password. Give replacement credentials to the faculty securely.

An authorized Pi operator can recover the administrator account locally:

```bash
cd /home/conkiosk/ConKiosk
backend/venv/bin/python backend/manage.py reset-admin-password
```

This prompts for the new password without putting it in shell history and revokes
the account's existing sessions. There is no public email/SMS recovery service.

## Student records and privacy

Students do not log in. QR/manual ID entry is not proof of identity by itself.
Lookup of existing student details is restricted to loopback, the configured
`LAN_ORIGIN` host, and any additional `KIOSK_ALLOWED_IPS`. Remote kiosk browsers
can submit manually without faculty credentials. Public queue responses omit
student IDs, names, and consultation topics; rescheduling announcements can display
a student's name, as described in the notice.

For optional roster matching, import an institution-approved UTF-8 CSV:

```text
student_id,full_name,program,year_level,section
```

```bash
backend/venv/bin/python backend/manage.py import-roster /path/to/approved-students.csv
```

After import, enable `REQUIRE_STUDENT_ROSTER=true` in `backend/.env` and restart
the backend to reject IDs not on the roster. It is false until a real roster is
provided. Strict matching uses roster names/programs; faculty should still check
the physical ID when required. It never introduces a student password or login.

Registration records the Privacy Notice version and acknowledgment time. Supply
the official `PRIVACY_INSTITUTION`, `PRIVACY_CONTACT`, and `PRIVACY_RETENTION`
values in `backend/.env`. The school must approve the notice, access rules, and
retention policy. The free-text retention setting displays the policy; it does not
schedule automatic consultation-history deletion or establish legal compliance.

Profile pictures accept JPG, PNG, or WebP, with a 512 KB limit for new uploads.
They are stored locally and delivered through cached photo endpoints. Group-member
snapshots are retained with each consultation independently of queue cleanup.

## Backups and recovery

The supplied daily backup timer writes PostgreSQL custom-format archives to
`/var/lib/conkiosk/backups`, keeps approximately 14 days, and validates archive
structure before publishing a uniquely named backup. A failed attempt does not
overwrite a previous good archive. The service uses the local postgres account.

Fresh installation:

```bash
cd /home/conkiosk/ConKiosk
sudo install -d -m 755 /usr/local/lib/conkiosk
sudo install -m 755 deploy/backup-postgres.sh /usr/local/lib/conkiosk/backup-postgres.sh
sudo install -d -m 700 -o postgres -g postgres /var/lib/conkiosk/backups
sudo install -m 644 deploy/conkiosk-backup.service /etc/systemd/system/conkiosk-backup.service
sudo install -m 644 deploy/conkiosk-backup.timer /etc/systemd/system/conkiosk-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now conkiosk-backup.timer
sudo systemctl start conkiosk-backup.service
sudo systemctl list-timers conkiosk-backup.timer
```

Review failures with `sudo journalctl -u conkiosk-backup.service --no-pager`.
Configure an actual mounted external destination using `CONKIOSK_BACKUP_MIRROR`
in a protected `/etc/conkiosk/backup.env`; see [backup notes](deploy/HARDENING.md#backups-and-recovery).
A backup on the Pi's own storage does not protect against loss of that storage.

Before handover, restore an archive to a separate test database and check its
records. Never test restoration by overwriting the live database. Archive-list
validation alone does not prove that an end-to-end recovery has been tested.
Record backup location, retention, responsible operator, and the most recent
restore-test result in the handover document.

## Testing and capstone demonstration

### Automated verification

Create a disposable database owned by the application database role:

```bash
sudo -u postgres createdb --owner=conkiosk conkiosk_queue_regression
backend/venv/bin/python backend/tests/security_regression.py
backend/venv/bin/python backend/tests/queue_regression.py
cd frontend
npx tsc --noEmit
npx expo export --platform web --output-dir dist
```

Skip database creation if it already exists. Both scripts reset only the named
regression database's tables; run them sequentially. They use local database
credentials but force a disposable database name. The security test temporarily
uses loopback port 18009. The older pytest suite uses a separate configuration
and destructive seed fixtures; follow [its instructions](backend/tests/README.md)
and never run it against production.

Coverage includes simultaneous submissions/acceptance, duplicate protection,
queue ordering/advancement, final-note persistence, terminal locks, authentication
and session revocation, registration races, role restrictions, both deletion
choices, group history, rescheduling, cancellation, audit records, and throttling.
Passing these tests is evidence for those cases, not a guarantee of no defects.

### Manual acceptance procedure

| Test | Expected observation |
|---|---|
| Boot Pi before connecting the router | Local backend/database start; LAN access becomes available after the Pi joins its configured network. |
| Open `/api/health` from another LAN device | API and database report healthy. |
| Register a faculty member | Matching passwords and Privacy Notice acknowledgment are required; account waits for approval. |
| Approve or reject registration | Confirmation precedes the action; pending accounts cannot sign in. |
| Submit individual/group requests | No student login; ticket shown; each group member retained. |
| Accept multiple requests, including from two devices | One active session per faculty; other students remain waiting in order. |
| Complete with notes | Notes persist; next accepted student is called and the TV chimes when sound is enabled. |
| Pause, cancel, and reschedule | Explicit confirmation/reason where applicable; future appointment is visible; closed records cannot be edited. |
| Transfer IT Chair | Role confirmation; only one chair; records are read-only. |
| Reset/change password or delete account | Existing sessions lose access; deletion follows the selected retention choice. |
| Use an untrusted browser to query student lookup | Student details are not returned; manual kiosk submission remains available. |
| Disconnect router WAN but keep LAN powered | Login, submission, queue, notes, and management continue through the Pi. |
| Test multiple phone sizes and both Pi displays | Faculty navigation is usable; TV fits all faculty without scrolling; correct HDMI placement. |
| Disconnect the Pi temporarily | Connection/stale-data indicators appear; recover after reconnecting. |
| Run backup and test a separate-database restore | Backup succeeds and restored test records can be verified. |

For capstone evaluation, record the build/commit, device/browser versions, network
conditions, test data, expected/actual outcomes, and evidence. Use authorized
participants and anonymized records in screenshots/manuscript appendices. Measure
response time, concurrent use, and usability on the intended hardware before
claiming results; this README does not assert a tested 10,000-student capacity.

## API overview

The base path is `/api`. Faculty APIs use `Authorization: Bearer <token>`.
WebSockets use `/ws`; authenticated clients send their token in the first frame.
Development route/schema details are available at `/docs` on the API server.

| Access | Main endpoints |
|---|---|
| Public | `GET /health`, `GET /privacy-notice`, `POST /auth/login`, `POST /auth/signup` |
| Student kiosk/TV | `GET /kiosk/faculty`, `POST /kiosk/consultation-request`, `GET /kiosk/queue/{faculty_school_id}`, `GET /tv-display/status` |
| Registered kiosk device only | `GET /kiosk/students/{student_id}`, `POST /kiosk/students` |
| Faculty | `GET/PATCH /faculty/profile`, `PATCH /faculty/availability`, `POST /auth/logout`, `POST /auth/change-password`, `GET /dashboard/stats` |
| Faculty requests | `GET /consultation-requests`, `GET /consultation-requests/{id}`, `POST /consultation-requests/{id}/action` |
| Faculty consultations | `GET /consultations`, `GET/PATCH /consultations/{id}`, `POST /consultations/{id}/start`, `/complete`, `/cancel` |
| Faculty notifications | `GET /notifications`, `PATCH /notifications/{id}/read`, `POST /notifications/mark-all-read` |
| Administrator/IT Chair reads | `GET /admin/summary`, `/admin/faculty`, `/admin/students`, `/admin/faculty/{school_id}/consultations`, `/admin/consultations/today` |
| Administrator writes | Faculty approval/rejection, profile updates, IT Chair assignment/removal, password reset, and account deletion under `/admin` |
| Administrator audit | `GET /admin/audit` |
| Administrator archive cleanup | `DELETE /admin/archives/{school_id}/records` to delete retained records, or `DELETE /admin/archives/{school_id}` to remove the archive and remaining records; both require `admin_password`. |

Student, consultation, notification, and audit list endpoints supporting pagination
use `limit` and `offset`, with a default page of 100 and maximum limit of 200.
Consultation completion accepts notes and an `advance` flag. Account deletion
accepts `admin_password` and `delete_history` (false by default). Retry-safe kiosk
submission uses a UUID `submission_id`; the UI reuses it when retrying a request.

## Project structure

```text
backend/
  server.py                 Models, validation, API, sessions, queues, WebSockets
  manage.py                 Local admin recovery and approved roster import
  requirements.txt          Python dependencies
  .env.example              Safe configuration template; .env stays private
  tests/                    Isolated regression scripts and integration tests
frontend/
  app/
    login.tsx, signup.tsx    Faculty access and Privacy Notice
    admin*.tsx              Administration, password reset, audit
    (tabs)/                 Faculty dashboard, requests, history, notifications,
                            profile, and IT Chair records
    kiosk/                  Faculty selection, identification, request, ticket
    tv.tsx                  Fixed responsive faculty/queue display
  src/config/api.ts         Central API address and photo URL resolution
  src/contexts/             Authentication and current account state
  src/components/           Shared dialogs, page controls, server status
  src/utils/                API, timeout handling, storage, realtime, kiosk draft
  src/hooks/                Bundled icon-font loading
deploy/                     systemd, Nginx, backups, TLS, dual-display templates
  HARDENING.md              Detailed security, privacy, recovery, and rollout notes
```

[LAN_OFFLINE_DEPLOYMENT.md](LAN_OFFLINE_DEPLOYMENT.md) provides additional LAN
setup context. [RPI5_DEPLOYMENT.md](RPI5_DEPLOYMENT.md) is an older hardware/setup
reference; some examples predate current security changes. For current behavior,
use this README, [HARDENING.md](deploy/HARDENING.md), and the actual deploy templates.

## Troubleshooting

| Symptom | Checks |
|---|---|
| Phone cannot reach login | Confirm Pi address with `hostname -I`; use the Pi IP, not the router IP; check same LAN and client isolation. |
| API health fails | `sudo systemctl status conkiosk.service postgresql nginx`; inspect `sudo journalctl -u conkiosk.service -n 50 --no-pager`. |
| Brief 502 after restart | Wait for backend startup, retry health, and inspect logs if it persists. |
| Faculty registration cannot sign in | Check administrator approval, account status, and exact School ID/password. |
| Existing login stops after an update/reset | Refresh and sign in again; session/security updates intentionally invalidate old tokens. |
| Too many attempts | Wait for the displayed limit; investigate repeated clients instead of disabling throttling. |
| Accepted student stays Waiting | Check the active session and earlier pending request; FIFO intentionally prevents starting out of turn. |
| TV is silent | Click Sound once, check HDMI audio output/TV volume, and verify the launcher autoplay setting. |
| One display does not open at boot | Check both outputs with `wlr-randr`, TV input, desktop autologin, and Labwc placement rules. |
| HTTPS warns about certificate | Install and verify the local CA on that device; check the IP/SAN and expiry. Do not bypass verification as a deployment solution. |
| Student lookup denied on another device | Lookup is restricted; use manual entry or configure that fixed kiosk IP explicitly. No student login is needed. |
| Profile image fails | Use a supported format and an image of at most 512 KB; check the API error. |
| QR scanner gives incomplete input | Configure USB HID mode, correct keyboard layout, and an Enter suffix; manually verify parsed details. |
| Native Expo QR points at the wrong machine | Use `npx expo start --lan` with the Pi API configured; the optional LAN launcher targets its own host. |
| Backup fails | Inspect backup service logs, free space, permissions, and any configured mirror mount. |

Do not use `/api/seed` as a production troubleshooting or recovery step.

## Limitations and handover

- A working LAN, powered Pi, and router are required for client access. Offline
  LAN operation does not mean disconnected phones can submit consultations.
- The single Pi is a central point of failure; no failover or offline write queue
  is implemented. WebSocket connections/throttling are process-local; deployment
  currently assumes one backend worker.
- Very large faculty lists fit by shrinking cards, which can reduce readability.
  Queue pages rotate; very large database workloads need measured capacity testing.
- Appointment times/office hours are not a room-booking/conflict-detection system.
- Existing group details already purged by older versions cannot be reconstructed
  without a suitable backup. Historical dates recorded by old versions are not
  automatically rewritten to Philippine local dates.
- HTTPS trust on phones, a verified student roster, official privacy settings,
  an external backup destination, and physical TV/QR/Expo checks require local
  institutional/operator participation.
- Cloud push/email, multi-server operation, external tamper-proof audit storage,
  and automatic retention-policy enforcement are outside the implemented scope.

Before capstone turnover, record the deployed commit, hardware/network layout,
private credential handover process, responsible administrator/maintainer, backup
and recovery procedure, known issues, test results, and actual authors/adviser/
institution details in the approved project documentation. Never place private
passwords, student records, or completed privacy forms in a public repository.

No standalone software license is currently declared in this repository. Obtain
the researchers' and institution's permission before redistribution; this README
does not grant a license or replace institutional ownership policies.
