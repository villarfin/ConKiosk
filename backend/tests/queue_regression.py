"""Run directly against a disposable *_regression database; never seeds live data."""
import asyncio
import sys
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
os.environ['DATABASE_URL'] = make_url(os.environ['DATABASE_URL']).set(database='conkiosk_queue_regression').render_as_string(hide_password=False)
os.environ['ADMIN_SCHOOL_ID'] = ''
os.environ['ADMIN_PASSWORD'] = ''
import server as app
from fastapi import HTTPException
from sqlalchemy import select


async def main():
    assert app.engine.url.database.endswith('_regression'), 'Disposable regression database required'
    async with app.engine.begin() as connection:
        await connection.run_sync(app.Base.metadata.drop_all)
    await app.startup()
    async with app.SessionLocal() as db:
        faculty = app.Faculty(school_id='QUEUE_TEST', full_name='Queue Test', password_hash='unused', department='Test', office_location='Test', availability_status='available', accepting_consultations=True)
        db.add(faculty)
        await db.commit()

    async def action(request_id, action_name='accept'):
        async with app.SessionLocal() as db:
            faculty = await db.scalar(select(app.Faculty).where(app.Faculty.school_id == 'QUEUE_TEST'))
            try:
                return await app.request_action(request_id, app.ConsultationAction(action=action_name), db, faculty)
            except HTTPException as error:
                return error.status_code

    async def submit(number):
        async with app.SessionLocal() as db:
            result = await app.kiosk_request(app.KioskConsultationRequest(faculty_school_id='QUEUE_TEST', topic='Test', students=[app.Student(student_id=f'TEST{number}', full_name=f'Student {number}', year_level='1', section='A')]), db)
            return result['queue_number']

    numbers = await asyncio.gather(*(submit(number) for number in range(4)))
    assert sorted(numbers) == ['A001', 'A002', 'A003', 'A004'], numbers
    async with app.SessionLocal() as db:
        requests = list((await db.scalars(select(app.ConsultationRequestRecord).order_by(app.ConsultationRequestRecord.queue_number))).all())
    first, duplicate = await asyncio.gather(action(requests[0].id), action(requests[0].id))
    assert sorted([first if isinstance(first, int) else 200, duplicate if isinstance(duplicate, int) else 200]) == [200, 409]
    await asyncio.gather(action(requests[1].id), action(requests[2].id))
    async with app.SessionLocal() as db:
        status = (await app.tv_status(db))[0]
        assert status['now_serving']['queue_number'] == 'A001', status
        assert status['next_queue_numbers'] == ['A002', 'A003', 'A004'], status
        faculty = await db.scalar(select(app.Faculty).where(app.Faculty.school_id == 'QUEUE_TEST'))
        first = await db.scalar(select(app.ConsultationRecord).where(app.ConsultationRecord.queue_number == 1))
        started = first.started_at
        await app.consultation_update(first.id, app.ConsultationUpdate(notes='Draft'), db, faculty)
        assert first.started_at == started
        result = await app.consultation_complete(first.id, app.ConsultationComplete(notes='Final notes'), db, faculty)
        assert result['next_started'] and first.notes == 'Final notes'
        status = (await app.tv_status(db))[0]
        assert status['now_serving']['queue_number'] == 'A002' and status['next_queue_numbers'] == ['A003', 'A004'], status
        assert faculty.availability_status == 'busy'
        later = await db.scalar(select(app.ConsultationRecord).where(app.ConsultationRecord.queue_number == 3))
        try:
            await app.consultation_start(later.id, db, faculty)
            raise AssertionError('A second session started')
        except HTTPException as error:
            assert error.status_code == 409
        try:
            await app.consultation_update(first.id, app.ConsultationUpdate(notes='Forbidden'), db, faculty)
            raise AssertionError('Completed consultation was editable')
        except HTTPException as error:
            assert error.status_code == 409
        await db.rollback()
    # Finish both accepted sessions; the unaccepted fourth request must not start.
    for number in (2, 3):
        async with app.SessionLocal() as db:
            faculty = await db.scalar(select(app.Faculty).where(app.Faculty.school_id == 'QUEUE_TEST'))
            row = await db.scalar(select(app.ConsultationRecord).where(app.ConsultationRecord.queue_number == number))
            await app.consultation_complete(row.id, None, db, faculty)
    async with app.SessionLocal() as db:
        status = (await app.tv_status(db))[0]
        assert status['now_serving'] is None and status['next_queue_numbers'] == ['A004'], status
    await action(requests[3].id)
    async with app.SessionLocal() as db:
        status = (await app.tv_status(db))[0]
        assert status['now_serving']['queue_number'] == 'A004'
        faculty = await db.scalar(select(app.Faculty).where(app.Faculty.school_id == 'QUEUE_TEST'))
        faculty.accepting_consultations = False
        await db.commit()
    try:
        await submit(99)
        raise AssertionError('Submission allowed while busy and not accepting')
    except HTTPException as error:
        assert error.status_code == 409
    async with app.SessionLocal() as db:
        active = await db.scalar(select(app.ConsultationRecord).where(app.ConsultationRecord.status == 'ongoing'))
        duplicate = app.ConsultationRecord(faculty_school_id=active.faculty_school_id, student_id=active.student_id, student_name=active.student_name, topic=active.topic, date=active.date, time=active.time, queue_id=active.queue_id, queue_number=active.queue_number, status='scheduled', notes='Retain duplicate notes')
        db.add(duplicate)
        await db.commit()
        duplicate_id = duplicate.id
    await app.startup()
    async with app.SessionLocal() as db:
        duplicate = await db.get(app.ConsultationRecord, duplicate_id)
        assert duplicate.status == 'cancelled' and duplicate.notes == 'Retain duplicate notes'
    await app.engine.dispose()
    print('PASS: concurrent submissions/acceptance, duplicate protection, FIFO, automatic advancement, pending gate, notes, timing and terminal lock')


if __name__ == '__main__':
    asyncio.run(main())
