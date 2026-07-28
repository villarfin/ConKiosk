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
