# Security and record-management update

The deployed system remains LAN-based. Students use `/kiosk` without signing in.
Faculty and administrators must sign in again after this update: legacy tokens
are intentionally invalidated. Sessions expire after 12 hours. Logout revokes the
current session; changing or resetting a password revokes all sessions for that
account. Login and sensitive administrative writes are throttled.

## Account deletion

The admin confirmation offers two explicit options and requires the admin password:

- Account only: archive the faculty, cancel unfinished consultations, retain history.
- Account and history: delete their consultation records/notes, requests, tickets,
  notifications and submission receipts, and clear the archived profile details.

The School ID remains reserved to prevent accidentally attaching records to a
different person. Shared student roster entries and audit records are retained.
Existing backups are not rewritten; they age out according to backup retention.
Archived faculty history remains accessible through Admin/IT Chair faculty records.
No production faculty history was deleted as part of installing this update.

The admin's Archived Faculty section allows later cleanup: delete consultation
records/notes but retain the faculty archive, or remove the archived faculty entry
and all remaining consultation records. Both actions require admin reauthentication
and confirmation. Removed entries retain only a reserved School ID, not their
profile, so signup cannot reuse a previously deleted identity. Audit records and
existing backups remain subject to their separate retention rules.

## Student access and identity

Consultation submission requires no student account. The Pi kiosk can look up
existing student details. Remote browsers can submit manually but cannot enumerate
student details through the lookup endpoint. Configure additional trusted kiosk
IPs in `KIOSK_ALLOWED_IPS`; the backend also accepts the configured `LAN_ORIGIN`
host and loopback. Keep trusted proxy configuration restricted to local Nginx.

School-ID entry/QR scanning alone cannot prove who is holding an ID. ConKiosk now
supports matching against an administrator-imported roster; this still requires
the faculty/kiosk operator to check the physical ID when identity matters.

Import a school-approved UTF-8 CSV with headers
`student_id,full_name,program,year_level,section`:

```sh
cd /home/conkiosk/ConKiosk
backend/venv/bin/python backend/manage.py import-roster /path/to/approved-students.csv
```

After importing, set `REQUIRE_STUDENT_ROSTER=true` in `backend/.env` and restart
`conkiosk.service` to reject IDs not in that roster. Strict matching is deliberately
not enabled until a real roster is supplied. No student login is introduced.

Group members are saved in each consultation, independently of queue cleanup.
Previously purged group-member names cannot be reconstructed without a backup.

## Privacy Notice

Fill these real institutional values in `backend/.env`, then restart the backend:

```dotenv
PRIVACY_INSTITUTION=Your institution's official name
PRIVACY_CONTACT=Your institution's official privacy contact
PRIVACY_RETENTION=Your approved consultation-record retention schedule
```

The registration API requires acknowledgment and stores the notice version and
timestamp. Values must be supplied by the institution; no contact or retention
policy is invented by the application. The application does not automatically
purge consultation history based on this free-text policy.

## HTTPS on this Pi

An additional HTTPS server is prepared at `https://192.168.0.2`. The existing HTTP
address remains available while devices are migrated. Browser clients use their
current site's origin for API calls, preventing HTTPS-to-HTTP mixed requests.

The private CA/server keys live only in `/etc/conkiosk/tls`, outside Git. Install
the public `conkiosk-lan-ca.crt` on each faculty device as a trusted CA using the
device's certificate settings before using HTTPS. Compare the certificate's SHA-256
fingerprint against the Pi through a trusted channel:

```sh
sudo openssl x509 -in /etc/conkiosk/tls/ca.crt -noout -fingerprint -sha256
```

The public CA is available at `http://192.168.0.2/conkiosk-lan-ca.crt`. Never copy
the private `.key` files to a phone. The server certificate expires after one year;
renew it using the local CA before expiry. Native Expo Go CA acceptance depends
on the phone's trust settings; it must be checked on the physical device. Web
HTTPS can be used independently of Expo Go.

Once every client trusts HTTPS, the operator can redirect HTTP and change
`EXPO_PUBLIC_API_URL` to `https://192.168.0.2/api` for native clients. Until that
migration is completed, HTTP clients still transmit without TLS encryption.

## Backups and recovery

The daily `conkiosk-backup.timer` writes verified PostgreSQL archives to
`/var/lib/conkiosk/backups`, keeps 14 days, and uses atomic replacement with unique
filenames so a failed attempt does not overwrite a good archive. It runs as the
local postgres user using peer authentication, without embedding database secrets.

```sh
sudo systemctl list-timers conkiosk-backup.timer
sudo systemctl start conkiosk-backup.service
sudo journalctl -u conkiosk-backup.service -n 20 --no-pager
```

The Pi's own card is not a separate recovery device. To mirror new backups to an
external mounted drive, create a protected `/etc/conkiosk/backup.env` containing
`CONKIOSK_BACKUP_MIRROR=/your/actual/mountpoint`. The script checks that this path
is mounted and fails visibly if it is absent. External mirror retention is the
operator's responsibility. No external drive was provided during this update.

Administrator-password recovery is available locally to an authorized Pi operator:

```sh
cd /home/conkiosk/ConKiosk
backend/venv/bin/python backend/manage.py reset-admin-password
```

The password is entered interactively, never on the command line. Faculty password
resets are available in the administrator's faculty card and require reauthentication.

## Verification

The isolated database `conkiosk_queue_regression` is used by the tests below. They
reset only that database's tables, never production. Do not rename them to target
the production database.

```sh
backend/venv/bin/python backend/tests/security_regression.py
backend/venv/bin/python backend/tests/queue_regression.py
cd frontend
npx tsc --noEmit
npx expo export --platform web --output-dir dist
```

The security regression exercises real HTTP and WebSocket authentication, token
revocation, registration races, role restrictions, reset/deletion modes, input
validation, public-data reduction, idempotent submissions, retained group records,
future appointments, cancellation, pagination limits, audit and throttling.

Physical checks still required: install/trust the CA on each phone, scan a real
student ID, confirm native Expo Go fonts offline, and listen for the TV chime.
