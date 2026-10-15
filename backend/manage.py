"""Local operator recovery/roster tools. Run on the Pi as its app owner."""
import argparse
import asyncio
import csv
import getpass
from sqlalchemy import select, delete
import server

async def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('reset-admin-password')
    roster = commands.add_parser('import-roster')
    roster.add_argument('csv_file', help='UTF-8 CSV: student_id,full_name,program,year_level,section')
    args = parser.parse_args()
    await server.startup()
    async with server.SessionLocal() as db:
        admin = await db.scalar(select(server.Faculty).where(server.Faculty.role == 'admin'))
        if not admin: raise SystemExit('No administrator account is configured')
        if args.command == 'reset-admin-password':
            password = getpass.getpass('New administrator password: ')
            if password != getpass.getpass('Confirm new password: '): raise SystemExit('Passwords do not match')
            server.ChangePasswordRequest(current_password='operator', new_password=password)
            admin.password_hash = server.pwd_context.hash(password)
            await db.execute(delete(server.AuthSession).where(server.AuthSession.faculty_id == admin.id))
            server.audit(db, admin, 'operator_password_recovery', admin.school_id)
        else:
            with open(args.csv_file, newline='', encoding='utf-8-sig') as source:
                records = [server.Student(**row) for row in csv.DictReader(source)]
            for student in records:
                row = await db.scalar(select(server.StudentRecord).where(server.StudentRecord.student_id == student.student_id))
                if row is None:
                    row = server.StudentRecord(**student.model_dump())
                    db.add(row)
                else:
                    for key, value in student.model_dump().items(): setattr(row, key, value)
                row.roster_verified = True
            server.audit(db, admin, 'student_roster_imported', str(len(records)))
        await db.commit()
    await server.engine.dispose()
    print('Completed. Changes recorded in the administrative audit log.')

if __name__ == '__main__': asyncio.run(main())
