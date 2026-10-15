"""HTTP/WS regression using only the disposable queue regression database."""
import asyncio
import json
from datetime import timedelta
import requests
import uvicorn
import websockets
import queue_regression
from sqlalchemy import select
from fastapi import HTTPException

app = queue_regression.app

async def main():
    assert app.engine.url.database == 'conkiosk_queue_regression'
    async with app.engine.begin() as connection:
        await connection.run_sync(app.Base.metadata.drop_all)
    await app.startup()
    async with app.SessionLocal() as db:
        db.add_all([app.Faculty(school_id='ADMIN_TEST', password_hash=app.pwd_context.hash('AdminTest123!'), full_name='Admin Test', department='Test', role='admin'), app.Faculty(school_id='FAC_TEST', password_hash=app.pwd_context.hash('Faculty123!'), full_name='Faculty Test', department='Test', availability_status='available', accepting_consultations=True)])
        await db.commit()
    server = uvicorn.Server(uvicorn.Config(app.app, host='127.0.0.1', port=18009, lifespan='off', log_level='error'))
    task = asyncio.create_task(server.serve())
    while not server.started:
        if task.done(): await task
        await asyncio.sleep(0.02)
    async def request(method, path, status=200, token=None, **kwargs):
        headers = {'Authorization': f'Bearer {token}'} if token else {}
        result = await asyncio.to_thread(requests.request, method, 'http://127.0.0.1:18009/api' + path, headers=headers, timeout=10, **kwargs)
        assert result.status_code == status, (path, result.status_code, result.text[:500])
        return result.json()
    async def login(id='FAC_TEST', password='Faculty123!'):
        app._attempts.clear()
        return (await request('POST', '/auth/login', json={'school_id': id, 'password': password}))['access_token']
    try:
        admin = await login('ADMIN_TEST', 'AdminTest123!')
        first, second = await login(), await login()
        await request('POST', '/auth/logout', token=first)
        await request('GET', '/faculty/profile', status=401, token=first)
        await request('GET', '/faculty/profile', token=second)
        await request('POST', '/auth/change-password', token=second, status=422, json={'current_password': 'Faculty123!', 'new_password': 'short'})
        await request('POST', '/auth/change-password', token=second, json={'current_password': 'Faculty123!', 'new_password': 'NewFaculty123!'})
        await request('GET', '/faculty/profile', token=second, status=401)
        faculty = await login(password='NewFaculty123!')
        async with websockets.connect('ws://127.0.0.1:18009/ws?faculty_id=FAC_TEST') as ws:
            await ws.send(json.dumps({'token': faculty}))
            await request('GET', '/faculty/profile', token=faculty)
        registration = {'school_id': 'NEW_TEST', 'password': 'NewAccount123!', 'full_name': 'New Account', 'department': 'Test', 'office_location': 'Test', 'email': 'new@example.edu', 'office_hours': '9–5'}
        await request('POST', '/auth/signup', status=422, json=registration)
        registration.update(privacy_acknowledged=True, privacy_version='1')
        results = await asyncio.gather(*[asyncio.to_thread(requests.post, 'http://127.0.0.1:18009/api/auth/signup', json=registration, timeout=10) for _ in range(2)])
        assert sorted(response.status_code for response in results) == [201, 409]
        await request('POST', '/admin/it-chair/NEW_TEST', status=409, token=admin)
        await request('POST', '/admin/faculty/NEW_TEST/approve', token=admin)
        await request('POST', '/admin/it-chair/NEW_TEST', token=admin)
        await asyncio.gather(request('POST', '/admin/it-chair/NEW_TEST', token=admin), request('POST', '/admin/it-chair/FAC_TEST', token=admin))
        async with app.SessionLocal() as db:
            assert len((await db.scalars(select(app.Faculty).where(app.Faculty.role == 'it_chair'))).all()) == 1
        new_token = await login('NEW_TEST', 'NewAccount123!')
        await request('POST', '/admin/faculty/NEW_TEST/reset-password', token=admin, json={'admin_password': 'AdminTest123!', 'new_password': 'ResetFaculty123!'})
        await request('GET', '/faculty/profile', status=401, token=new_token)
        # HTTP validation, photo restrictions and pagination limits.
        await request('PATCH', '/faculty/profile', token=faculty, status=422, json={'full_name': ' '})
        await request('PATCH', '/faculty/profile', token=faculty, status=422, json={'profile_image': 'https://example.com/photo.png'})
        await request('GET', '/admin/students?limit=201', token=admin, status=422)
        # A fake remote kiosk is denied by the same dependency used on HTTP routes.
        remote = app.Request({'type': 'http', 'client': ('192.0.2.99', 1234), 'headers': []})
        try: await app.trusted_kiosk(remote); raise AssertionError('Untrusted kiosk allowed')
        except HTTPException as error: assert error.status_code == 403
        async with app.SessionLocal() as db:
            account = await db.scalar(select(app.Faculty).where(app.Faculty.school_id == 'FAC_TEST'))
            account.availability_status = 'available'
            account.accepting_consultations = True
            await db.commit()
        submission = {'faculty_school_id': 'FAC_TEST', 'topic': 'Group test', 'consultation_type': 'group', 'submission_id': 'e17401ea-80f7-4fb8-bbb1-18f05406f482', 'students': [{'student_id': 'STUDENT1', 'full_name': 'Student One', 'program': 'BSIT', 'year_level': '1', 'section': 'A'}, {'student_id': 'STUDENT2', 'full_name': 'Student Two', 'program': 'BSIT', 'year_level': '1', 'section': 'A'}]}
        a, b = await asyncio.gather(request('POST', '/kiosk/consultation-request', json=submission), request('POST', '/kiosk/consultation-request', json=submission))
        assert a['queue_id'] == b['queue_id']
        queue = await request('GET', '/kiosk/queue/FAC_TEST')
        assert len(queue) == 1 and set(queue[0]) == {'status', 'queue_number'}
        pending = await request('GET', '/consultation-requests?status=pending', token=faculty)
        await request('POST', f"/consultation-requests/{pending[0]['_id']}/action", token=faculty, json={'action': 'accept'})
        tv = await request('GET', '/tv-display/status')
        serving = next(person for person in tv if person['school_id'] == 'FAC_TEST')['now_serving']
        assert set(serving) == {'queue_number', 'queue_id'}
        rows = await request('GET', '/consultations', token=faculty)
        row = rows[0]
        await request('POST', f"/consultations/{row['_id']}/complete", token=faculty, json={'notes': 'Final group feedback', 'advance': False})
        history = await request('GET', f"/consultations/{row['_id']}", token=faculty)
        assert len(history['students']) == 2 and history['notes'] == 'Final group feedback'
        assert history['students'][0]['program'] == 'BSIT'
        assert history['student_name'] == 'Student One, Student Two'
        await request('PATCH', f"/consultations/{row['_id']}", status=409, token=faculty, json={'notes': 'Overwritten'})
        await request('PATCH', '/faculty/availability', token=faculty, json={'status': 'available'})
        rescheduled = dict(submission, submission_id='e17401ea-80f7-4fb8-bbb1-18f05406f483')
        await request('POST', '/kiosk/consultation-request', json=rescheduled)
        requests_to_move = await request('GET', '/consultation-requests?status=pending', token=faculty)
        date = (app.now() + timedelta(days=2)).date().isoformat()
        await request('POST', f"/consultation-requests/{requests_to_move[0]['_id']}/action", token=faculty, json={'action': 'reschedule', 'reschedule_date': date, 'reschedule_time': '01:00 PM'})
        appointments = await request('GET', '/consultations', token=faculty)
        assert any(item['date'] == date and item['status'] == 'scheduled' and len(item['students']) == 2 for item in appointments)
        async with app.SessionLocal() as db:
            future = app.ConsultationRecord(faculty_school_id='FAC_TEST', student_id='STUDENT1', student_name='Student One', topic='Future', date=(app.now() + timedelta(days=3)).date().isoformat(), time='10:00', status='scheduled')
            db.add(future); await db.commit(); future_id = future.id
        await request('POST', f'/consultations/{future_id}/start', token=faculty, status=409)
        await request('POST', f'/consultations/{future_id}/cancel', token=faculty, json={'reason': 'Student unavailable'})
        await request('POST', f'/consultations/{future_id}/start', token=faculty, status=409)
        app._attempts.clear()
        await request('DELETE', '/admin/archives/FAC_TEST/records', token=faculty, status=403, json={'admin_password': 'AdminTest123!'})
        await request('DELETE', '/admin/archives/FAC_TEST/records', token=admin, status=409, json={'admin_password': 'AdminTest123!'})
        app._attempts.clear()
        async with app.SessionLocal() as db:
            db.add(app.ConsultationRecord(faculty_school_id='NEW_TEST', student_id='OTHER_STUDENT', student_name='Other Student', topic='Unrelated history', date=app.local_today(), time='Walk-in', status='completed', notes='Preserve until explicitly removed'))
            await db.commit()
        await request('DELETE', '/admin/faculty/FAC_TEST', token=admin, json={'admin_password': 'AdminTest123!'})
        await request('GET', '/faculty/profile', token=faculty, status=401)
        archive = await request('GET', '/admin/faculty', token=admin)
        assert next(person for person in archive if person['school_id'] == 'FAC_TEST')['is_deleted']
        assert len(await request('GET', '/admin/faculty/FAC_TEST/consultations', token=admin)) == 3
        await request('POST', '/admin/faculty/FAC_TEST/reject', token=admin, status=409)
        await request('DELETE', '/admin/archives/FAC_TEST/records', token=admin, status=403, json={'admin_password': 'Incorrect123!'})
        assert len(await request('GET', '/admin/faculty/FAC_TEST/consultations', token=admin)) == 3
        await request('DELETE', '/admin/archives/FAC_TEST/records', token=admin, json={'admin_password': 'AdminTest123!'})
        assert await request('GET', '/admin/faculty/FAC_TEST/consultations', token=admin) == []
        archived_list = await request('GET', '/admin/faculty', token=admin)
        assert next(person for person in archived_list if person['school_id'] == 'FAC_TEST')['full_name'] == 'Faculty Test'
        await request('DELETE', '/admin/faculty/FAC_TEST', token=admin, json={'admin_password': 'AdminTest123!', 'delete_history': True})
        assert await request('GET', '/admin/faculty/FAC_TEST/consultations', token=admin) == []
        app._attempts.clear()
        await request('DELETE', '/admin/archives/FAC_TEST', token=admin, json={'admin_password': 'AdminTest123!'})
        assert not any(person['school_id'] == 'FAC_TEST' for person in await request('GET', '/admin/faculty', token=admin))
        assert len(await request('GET', '/admin/faculty/NEW_TEST/consultations', token=admin)) == 1
        await request('DELETE', '/admin/faculty/NEW_TEST', token=admin, json={'admin_password': 'AdminTest123!'})
        removed = await request('DELETE', '/admin/archives/NEW_TEST', token=admin, json={'admin_password': 'AdminTest123!'})
        assert removed['deleted_records'] == 1
        assert await request('GET', '/admin/faculty/NEW_TEST/consultations', token=admin) == []
        async with app.SessionLocal() as db:
            assert await db.get(app.RetiredFacultyID, 'FAC_TEST') is not None
            assert await db.get(app.RetiredFacultyID, 'NEW_TEST') is not None
        registration['school_id'] = 'FAC_TEST'
        app._attempts.clear()
        await request('POST', '/auth/signup', status=409, json=registration)
        async with app.SessionLocal() as db:
            assert len((await db.scalars(select(app.AuditLog))).all()) >= 6
        assert len(await request('GET', '/admin/audit', token=admin)) >= 6
        app._attempts.clear()
        for _ in range(10): await request('POST', '/auth/login', status=404, json={'school_id': 'UNKNOWN', 'password': 'Wrong123!'})
        await request('POST', '/auth/login', status=429, json={'school_id': 'UNKNOWN', 'password': 'Wrong123!'})
        print('PASS: HTTP sessions, password policy/reset, privacy, registration race, roles, archival, kiosk protection, idempotency, private queue data, group history, future dates, cancellation, pagination, audit and throttling')
    finally:
        server.should_exit = True
        await task
        await app.engine.dispose()

if __name__ == '__main__': asyncio.run(main())
