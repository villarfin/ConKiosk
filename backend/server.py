"""ConKiosk FastAPI backend: PostgreSQL/SQLAlchemy and native WebSockets."""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Text, UniqueConstraint, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
ALLOW_SEED_DATA = os.getenv("ALLOW_SEED_DATA", "false").lower() == "true"
cors_origins = [value.strip() for value in os.getenv("CORS_ORIGINS", "http://localhost").split(",") if value.strip()]
if not DATABASE_URL or not SECRET_KEY:
    raise RuntimeError("DATABASE_URL and JWT_SECRET_KEY must be set in backend/.env")
if ENVIRONMENT == "production" and "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS cannot use '*' in production")

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass
def id_value() -> str: return str(uuid.uuid4())
def now() -> datetime: return datetime.utcnow()

class Faculty(Base):
    __tablename__ = "faculty"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    school_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    department: Mapped[str] = mapped_column(String(255))
    office_location: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    profile_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    availability_status: Mapped[str] = mapped_column(String(32), default="unavailable")
    office_hours: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

class StudentRecord(Base):
    __tablename__ = "students"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    student_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    program: Mapped[str] = mapped_column(String(128), default="")
    year_level: Mapped[str] = mapped_column(String(64), default="")
    section: Mapped[str] = mapped_column(String(64), default="")

class QueueCounter(Base):
    __tablename__ = "queue_counters"
    faculty_school_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0)

class QueueRecord(Base):
    __tablename__ = "queue"
    __table_args__ = (UniqueConstraint("faculty_school_id", "queue_number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    queue_number: Mapped[int] = mapped_column(Integer)
    student_ids: Mapped[list] = mapped_column(JSON, default=list)
    student_names: Mapped[list] = mapped_column(JSON, default=list)
    topic: Mapped[str] = mapped_column(String(500))
    consultation_type: Mapped[str] = mapped_column(String(32), default="individual")
    status: Mapped[str] = mapped_column(String(32), default="waiting")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ConsultationRequestRecord(Base):
    __tablename__ = "consultation_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(255))
    student_name: Mapped[str] = mapped_column(String(255))
    student_program: Mapped[str] = mapped_column(String(255), default="")
    topic: Mapped[str] = mapped_column(String(500))
    preferred_date: Mapped[str] = mapped_column(String(32))
    preferred_time: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    decline_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    queue_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    queue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    consultation_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ConsultationRecord(Base):
    __tablename__ = "consultations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(255))
    student_name: Mapped[str] = mapped_column(String(255))
    student_program: Mapped[str] = mapped_column(String(255), default="")
    topic: Mapped[str] = mapped_column(String(500))
    date: Mapped[str] = mapped_column(String(32), index=True)
    time: Mapped[str] = mapped_column(String(64))
    duration: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    queue_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    queue_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    consultation_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class NotificationRecord(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class LoginRequest(BaseModel): school_id: str; password: str
class FacultyProfileUpdate(BaseModel):
    full_name: Optional[str] = None; department: Optional[str] = None; office_location: Optional[str] = None
    email: Optional[str] = None; profile_image: Optional[str] = None; office_hours: Optional[str] = None
class AvailabilityUpdate(BaseModel): status: str
class ConsultationAction(BaseModel):
    action: str; reschedule_date: Optional[str] = None; reschedule_time: Optional[str] = None; reason: Optional[str] = None
class ConsultationUpdate(BaseModel):
    notes: Optional[str] = None; remarks: Optional[str] = None; status: Optional[str] = None; duration: Optional[int] = None
class ChangePasswordRequest(BaseModel): current_password: str; new_password: str
class Student(BaseModel): student_id: str; full_name: str; program: str = ""; year_level: str; section: str
class KioskConsultationRequest(BaseModel): faculty_school_id: str; topic: str; consultation_type: str = "individual"; students: list[Student]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
def serialize(record: Any, secret: bool = False) -> dict:
    values = {column.name: getattr(record, column.name) for column in record.__table__.columns}
    values["_id"] = values.pop("id")
    if secret: values.pop("password_hash", None)
    return values
async def session() -> AsyncSession:
    async with SessionLocal() as value: yield value
async def current_faculty(credentials: HTTPAuthorizationCredentials = Depends(security), db: AsyncSession = Depends(session)) -> Faculty:
    try: school_id = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"]).get("sub")
    except JWTError: school_id = None
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == school_id)) if school_id else None
    if not faculty: raise HTTPException(401, "Invalid authentication credentials")
    return faculty

class Connections:
    def __init__(self): self.all: set[WebSocket] = set(); self.faculty: dict[str, set[WebSocket]] = {}
    async def connect(self, ws: WebSocket, faculty_id: Optional[str]):
        await ws.accept(); self.all.add(ws)
        if faculty_id: self.faculty.setdefault(faculty_id, set()).add(ws)
    def remove(self, ws: WebSocket, faculty_id: Optional[str]):
        self.all.discard(ws)
        if faculty_id: self.faculty.get(faculty_id, set()).discard(ws)
    async def send(self, event: str, data: dict, faculty_id: Optional[str] = None):
        sockets = self.faculty.get(faculty_id, set()) if faculty_id else self.all
        for ws in list(sockets):
            try: await ws.send_json({"type": event, "data": data})
            except Exception: self.remove(ws, faculty_id)
connections = Connections()

app = FastAPI(); api = APIRouter(prefix="/api")
app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, faculty_id: Optional[str] = None, token: Optional[str] = None):
    # Public displays may subscribe without a faculty id.  Faculty-specific
    # updates must be tied to the same identity as a valid login token.
    if faculty_id:
        try:
            token_subject = jwt.decode(token or "", SECRET_KEY, algorithms=["HS256"]).get("sub")
        except JWTError:
            token_subject = None
        if token_subject != faculty_id:
            await websocket.close(code=1008)
            return
    await connections.connect(websocket, faculty_id)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: connections.remove(websocket, faculty_id)

@api.post("/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(session)):
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == payload.school_id))
    if not faculty or not pwd_context.verify(payload.password, faculty.password_hash): raise HTTPException(401, "Incorrect school ID or password")
    token = jwt.encode({"sub": faculty.school_id, "exp": datetime.utcnow() + timedelta(days=30)}, SECRET_KEY, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "faculty": serialize(faculty, True)}
@api.get("/faculty/profile")
async def profile(faculty: Faculty = Depends(current_faculty)): return serialize(faculty, True)
@api.patch("/faculty/profile")
async def update_profile(payload: FacultyProfileUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(faculty, key, value)
    await db.commit(); await db.refresh(faculty); return serialize(faculty, True)
@api.patch("/faculty/availability")
async def availability(payload: AvailabilityUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    faculty.availability_status = payload.status; await db.commit()
    await connections.send("availability_changed", {"faculty_id": faculty.school_id, "status": payload.status})
    return {"message": "Availability updated", "status": payload.status}
@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    if not pwd_context.verify(payload.current_password, faculty.password_hash): raise HTTPException(400, "Current password is incorrect")
    faculty.password_hash = pwd_context.hash(payload.new_password); await db.commit(); return {"message": "Password changed successfully"}

@api.get("/kiosk/faculty")
async def kiosk_faculty(db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(Faculty).order_by(Faculty.full_name))).all()
    return [{key: serialize(row, True)[key] for key in ("school_id", "full_name", "department", "office_location", "profile_image", "availability_status", "office_hours")} for row in rows]
@api.get("/kiosk/students/{student_id}")
async def student_lookup(student_id: str, db: AsyncSession = Depends(session)):
    row = await db.scalar(select(StudentRecord).where(StudentRecord.student_id == student_id))
    if not row: raise HTTPException(404, "Student not found")
    return {key: getattr(row, key) for key in ("student_id", "full_name", "program", "year_level", "section")}
@api.post("/kiosk/students")
async def student_create(payload: Student, db: AsyncSession = Depends(session)):
    row = await db.scalar(select(StudentRecord).where(StudentRecord.student_id == payload.student_id))
    if not row: db.add(StudentRecord(**payload.model_dump())); await db.commit()
    return {"message": "Student already registered" if row else "Student registered", "student": payload.model_dump()}
@api.post("/kiosk/consultation-request")
async def kiosk_request(payload: KioskConsultationRequest, db: AsyncSession = Depends(session)):
    if not payload.topic.strip() or not payload.students: raise HTTPException(422, "Topic and at least one student are required")
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == payload.faculty_school_id))
    if not faculty: raise HTTPException(404, "Faculty not found")
    for student in payload.students:
        if not await db.scalar(select(StudentRecord).where(StudentRecord.student_id == student.student_id)): db.add(StudentRecord(**student.model_dump()))
    counter = await db.scalar(select(QueueCounter).where(QueueCounter.faculty_school_id == faculty.school_id).with_for_update())
    if not counter: counter = QueueCounter(faculty_school_id=faculty.school_id, last_number=0); db.add(counter); await db.flush()
    counter.last_number += 1; names = [student.full_name for student in payload.students]; ids = [student.student_id for student in payload.students]
    queue = QueueRecord(faculty_school_id=faculty.school_id, queue_number=counter.last_number, student_ids=ids, student_names=names, topic=payload.topic, consultation_type=payload.consultation_type)
    db.add(queue); await db.flush(); display = names[0] if len(names) == 1 else f"{names[0]} +{len(names)-1} more"
    db.add(ConsultationRequestRecord(faculty_school_id=faculty.school_id, student_id=",".join(ids), student_name=display, student_program=f"{payload.students[0].program} • {payload.students[0].year_level} - {payload.students[0].section}", topic=payload.topic, preferred_date=now().date().isoformat(), preferred_time="Walk-in", queue_id=queue.id, queue_number=queue.queue_number, consultation_type=payload.consultation_type))
    db.add(NotificationRecord(faculty_school_id=faculty.school_id, type="new_request", title="New Kiosk Consultation Request", message=f"{display} requested consultation (Queue #{queue.queue_number})")); await db.commit()
    await connections.send("new_consultation_request", {"faculty_id": faculty.school_id, "queue_number": queue.queue_number}, faculty.school_id); await connections.send("queue_updated", {"faculty_id": faculty.school_id})
    return {"message": "Consultation request submitted", "queue_number": queue.queue_number, "queue_id": queue.id, "faculty_name": faculty.full_name, "faculty_office": faculty.office_location}
@api.get("/kiosk/queue/{faculty_school_id}")
async def kiosk_queue(faculty_school_id: str, db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty_school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all(); return [serialize(row) for row in rows]

@api.get("/consultation-requests")
async def requests(status: Optional[str] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(ConsultationRequestRecord).where(ConsultationRequestRecord.faculty_school_id == faculty.school_id)
    if status: query = query.where(ConsultationRequestRecord.status == status)
    return [serialize(row) for row in (await db.scalars(query.order_by(ConsultationRequestRecord.created_at.desc()))).all()]
@api.get("/consultation-requests/{request_id}")
async def request_detail(request_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.id == request_id, ConsultationRequestRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Request not found")
    return serialize(row)
@api.post("/consultation-requests/{request_id}/action")
async def request_action(request_id: str, payload: ConsultationAction, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.id == request_id, ConsultationRequestRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Request not found")
    if payload.action == "accept":
        row.status = "accepted"; db.add(ConsultationRecord(faculty_school_id=faculty.school_id, student_id=row.student_id, student_name=row.student_name, student_program=row.student_program, topic=row.topic, date=row.preferred_date, time=row.preferred_time, status="scheduled", queue_id=row.queue_id, queue_number=row.queue_number, consultation_type=row.consultation_type)); event = "consultation_accepted"
    elif payload.action == "decline":
        row.status = "declined"; row.decline_reason = payload.reason; event = "queue_updated"
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue: queue.status = "cancelled"
    elif payload.action == "reschedule" and payload.reschedule_date and payload.reschedule_time:
        row.status = "rescheduled"; row.preferred_date = payload.reschedule_date; row.preferred_time = payload.reschedule_time; event = "consultation_rescheduled"
    else: raise HTTPException(400, "Invalid action or missing reschedule details")
    db.add(NotificationRecord(faculty_school_id=faculty.school_id, type=payload.action, title=f"Request {payload.action.title()}ed", message=f"Request from {row.student_name} was {payload.action}ed")); await db.commit(); await connections.send(event, {"faculty_id": faculty.school_id}, faculty.school_id); return {"message": f"Request {payload.action}ed", "status": row.status}

@api.get("/consultations")
async def consultations(status: Optional[str] = None, search: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(ConsultationRecord).where(ConsultationRecord.faculty_school_id == faculty.school_id)
    if status: query = query.where(ConsultationRecord.status == status)
    if search: query = query.where(or_(ConsultationRecord.student_name.ilike(f"%{search}%"), ConsultationRecord.student_id.ilike(f"%{search}%"), ConsultationRecord.topic.ilike(f"%{search}%")))
    if date_from: query = query.where(ConsultationRecord.date >= date_from)
    if date_to: query = query.where(ConsultationRecord.date <= date_to)
    return [serialize(row) for row in (await db.scalars(query.order_by(ConsultationRecord.date.desc()))).all()]
@api.get("/consultations/{consultation_id}")
async def consultation_detail(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    return serialize(row)
@api.patch("/consultations/{consultation_id}")
async def consultation_update(consultation_id: str, payload: ConsultationUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(row, key, value)
    row.updated_at = now(); await db.commit(); return serialize(row)
@api.post("/consultations/{consultation_id}/start")
async def consultation_start(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    row.status = "ongoing"; row.updated_at = now(); faculty.availability_status = "busy"
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue: queue.status = "serving"
    await db.commit()
    for event in ("consultation_started", "queue_updated", "availability_changed"): await connections.send(event, {"faculty_id": faculty.school_id})
    return {"message": "Consultation started", "status": "ongoing"}
@api.post("/consultations/{consultation_id}/complete")
async def consultation_complete(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    row.duration = max(1, int((now() - row.updated_at).total_seconds() / 60)); row.status = "completed"; row.updated_at = now(); faculty.availability_status = "available"
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue: queue.status = "completed"
    await db.commit()
    for event in ("consultation_completed", "queue_updated", "availability_changed"): await connections.send(event, {"faculty_id": faculty.school_id})
    return {"message": "Consultation completed", "duration_minutes": row.duration}

@api.get("/dashboard/stats")
async def dashboard_stats(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    today = now().date().isoformat()
    month_prefix = today[:7]
    scope = ConsultationRecord.faculty_school_id == faculty.school_id
    today_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(scope, ConsultationRecord.date == today)))
    pending_requests = await db.scalar(select(func.count()).select_from(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.faculty_school_id == faculty.school_id, ConsultationRequestRecord.status == "pending")))
    monthly_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(scope, ConsultationRecord.date.like(f"{month_prefix}%"))))
    upcoming = (await db.scalars(select(ConsultationRecord).where(and_(scope, ConsultationRecord.status.in_(["scheduled", "ongoing"]), ConsultationRecord.date >= today)).order_by(ConsultationRecord.date, ConsultationRecord.time).limit(5))).all()
    return {"today_count": today_count or 0, "pending_requests": pending_requests or 0, "monthly_count": monthly_count or 0, "availability_status": faculty.availability_status, "upcoming_consultations": [serialize(row) for row in upcoming]}

@api.get("/notifications")
async def notifications(unread_only: bool = False, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(NotificationRecord).where(NotificationRecord.faculty_school_id == faculty.school_id)
    if unread_only: query = query.where(NotificationRecord.read == False)
    return [serialize(row) for row in (await db.scalars(query.order_by(NotificationRecord.created_at.desc()))).all()]
@api.patch("/notifications/{notification_id}/read")
async def notification_read(notification_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(NotificationRecord).where(and_(NotificationRecord.id == notification_id, NotificationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Notification not found")
    row.read = True; await db.commit(); return {"message": "Notification marked as read"}
@api.post("/notifications/mark-all-read")
async def notifications_read(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    for row in (await db.scalars(select(NotificationRecord).where(and_(NotificationRecord.faculty_school_id == faculty.school_id, NotificationRecord.read == False)))).all(): row.read = True
    await db.commit(); return {"message": "All notifications marked as read"}
@api.get("/tv-display/status")
async def tv_status(db: AsyncSession = Depends(session)):
    output = []
    for faculty in (await db.scalars(select(Faculty).order_by(Faculty.full_name))).all():
        queue = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all(); serving = next((item for item in queue if item.status == "serving"), None); waiting = [item for item in queue if item.status == "waiting"]
        output.append({"school_id": faculty.school_id, "full_name": faculty.full_name, "department": faculty.department, "office_location": faculty.office_location, "availability_status": faculty.availability_status, "now_serving": {"queue_number": serving.queue_number, "student_names": serving.student_names, "topic": serving.topic} if serving else None, "waiting_count": len(waiting), "next_queue_numbers": [item.queue_number for item in waiting[:5]]})
    return output
@api.post("/seed")
async def seed_disabled():
    if not ALLOW_SEED_DATA: raise HTTPException(403, "Demo seeding is disabled")
    raise HTTPException(501, "Seeding is intentionally not implemented for the PostgreSQL production backend")

app.include_router(api)
socket_app = app
logging.basicConfig(level=logging.INFO)
