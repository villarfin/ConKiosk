# Backend integration tests

These tests reset the database through `/api/seed`. Use a dedicated `conkiosk_test`
database only—never staging or production.

1. Create `backend/.env.test` from `backend/.env.test.example` and set its database URL.
2. Start the API against that file: `CONKIOSK_ENV_FILE=.env.test uvicorn server:socket_app --host 127.0.0.1 --port 8001`.
3. Set `EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8001` and
   `RUN_INTEGRATION_TESTS=true`.
4. Install test dependencies and run `python -m pytest tests` from `backend/`.

The `RUN_INTEGRATION_TESTS` guard is intentional: the suite changes data as part of
its end-to-end checks.

Queue concurrency regression: create a disposable `conkiosk_queue_regression`
database owned by the application's database role, then run
`backend/venv/bin/python backend/tests/queue_regression.py` from the repository root.
This script uses the local database credentials but forces the database name to
`conkiosk_queue_regression`. It resets only that disposable database's tables.
It exercises concurrent submissions and acceptance, repeated acceptance,
FIFO advancement, pending approval, note persistence, timing, terminal locks,
and faculty acceptance restrictions.

# Security, account lifecycle and kiosk regression

Run `backend/venv/bin/python backend/tests/security_regression.py` from the
repository root. It uses the same disposable `conkiosk_queue_regression` database,
starts an HTTP/WebSocket test server on loopback port 18009, and resets only that
database. Run it sequentially with `queue_regression.py`, never in parallel.
