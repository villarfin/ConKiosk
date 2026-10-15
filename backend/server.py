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
from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Text, UniqueConstraint, and_, delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
# Select .env.test explicitly for the isolated integration environment.
load_dotenv(ROOT_DIR / os.getenv("CONKIOSK_ENV_FILE", ".env"))
DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
ALLOW_SEED_DATA = os.getenv("ALLOW_SEED_DATA", "false").lower() == "true"
ADMIN_SCHOOL_ID = os.getenv("ADMIN_SCHOOL_ID", "").strip().upper()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_NAME = os.getenv("ADMIN_NAME", "ConKiosk Administrator").strip()
cors_origins = [value.strip() for value in os.getenv("CORS_ORIGINS", "http://localhost").split(",") if value.strip()]
lan_origin = os.getenv("LAN_ORIGIN", "").strip().rstrip("/")
if lan_origin:
    # A deployed web build is served from the LAN origin; Expo/Metro development
    # is served from port 8081. Keep the allowlist explicit rather than using *.
    cors_origins.extend([lan_origin, f"{lan_origin}:8081"])
cors_origins = list(dict.fromkeys(cors_origins))
if not DATABASE_URL or not SECRET_KEY:
    raise RuntimeError("DATABASE_URL and JWT_SECRET_KEY must be set in backend/.env")
if ENVIRONMENT == "production" and "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS cannot use '*' in production")

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass
def id_value() -> str: return str(uuid.uuid4())
def now() -> datetime: return datetime.utcnow()
def queue_label(number: int) -> str: return f"A{number:03d}"

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
    accepting_consultations: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_approved: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    office_hours: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="faculty", server_default="faculty")

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
class FacultySignup(BaseModel):
    school_id: str
    password: str
    full_name: str
    department: str
    office_location: str
    email: str
    office_hours: str
class FacultyProfileUpdate(BaseModel):
    full_name: Optional[str] = None; department: Optional[str] = None; office_location: Optional[str] = None
    email: Optional[str] = None; profile_image: Optional[str] = None; office_hours: Optional[str] = None
class AvailabilityUpdate(BaseModel): status: str; accepting_consultations: Optional[bool] = None
class ConsultationAction(BaseModel):
    action: str; reschedule_date: Optional[str] = None; reschedule_time: Optional[str] = None; reason: Optional[str] = None
class ConsultationUpdate(BaseModel):
    notes: Optional[str] = None; remarks: Optional[str] = None; status: Optional[str] = None; duration: Optional[int] = None
class ConsultationComplete(BaseModel):
    notes: Optional[str] = None
class ChangePasswordRequest(BaseModel): current_password: str; new_password: str
class AdminPasswordConfirmation(BaseModel):
    admin_password: str = Field(min_length=1, max_length=512)
class Student(BaseModel): student_id: str; full_name: str; program: str = ""; year_level: str; section: str
class KioskConsultationRequest(BaseModel): faculty_school_id: str; topic: str; consultation_type: str = "individual"; students: list[Student]
class AdminFacultyUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=255)
    department: Optional[str] = Field(default=None, max_length=255)
    office_location: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    office_hours: Optional[str] = Field(default=None, max_length=255)
    availability_status: Optional[str] = None

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
async def current_admin(faculty: Faculty = Depends(current_faculty)) -> Faculty:
    if faculty.role != "admin": raise HTTPException(403, "Administrator access is required")
    return faculty
async def current_management_viewer(faculty: Faculty = Depends(current_faculty)) -> Faculty:
    if faculty.role not in {"admin", "it_chair"}: raise HTTPException(403, "Administrator or IT Chair access is required")
    return faculty

async def reset_queue_counter_if_empty(db: AsyncSession, faculty_school_id: str) -> None:
    """Start a new queue at #1 after its last active entry has left the queue."""
    active_count = await db.scalar(select(func.count()).select_from(QueueRecord).where(and_(
        QueueRecord.faculty_school_id == faculty_school_id,
        QueueRecord.status.in_(["waiting", "serving"]),
    )))
    if not active_count:
        # Queue numbers are reused from #1 for a new, empty queue. Closed queue
        # entries are no longer needed by the live board (consultation history
        # retains its own queue-number snapshot).
        await db.execute(delete(QueueRecord).where(and_(
            QueueRecord.faculty_school_id == faculty_school_id,
            QueueRecord.status.in_(["completed", "cancelled"]),
        )))
        counter = await db.get(QueueCounter, faculty_school_id)
        if counter:
            counter.last_number = 0

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
@api.get("/health")
async def health(db: AsyncSession = Depends(session)):
    """Public local-service health check; no internet is involved."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "ConKiosk database is unavailable")
    return {"status": "ok", "service": "conkiosk-api", "database": "ok"}
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all does not add columns to existing PostgreSQL tables.
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'faculty'"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS accepting_consultations BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true"))
    if ADMIN_SCHOOL_ID and ADMIN_PASSWORD:
        async with SessionLocal() as db:
            admin = await db.scalar(select(Faculty).where(Faculty.school_id == ADMIN_SCHOOL_ID))
            if not admin:
                admin = Faculty(school_id=ADMIN_SCHOOL_ID, password_hash=pwd_context.hash(ADMIN_PASSWORD),
                                full_name=ADMIN_NAME, department="System Administration", office_location="IT Office",
                                email="", availability_status="unavailable", office_hours="", role="admin")
                db.add(admin)
            else:
                admin.role = "admin"
                admin.full_name = ADMIN_NAME or admin.full_name
            await db.commit()
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
    school_id = payload.school_id.strip().upper()
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == school_id))
    if not faculty: raise HTTPException(404, "No account was found for this School ID")
    if not pwd_context.verify(payload.password, faculty.password_hash): raise HTTPException(401, "Incorrect password")
    if not faculty.is_approved: raise HTTPException(403, "Your faculty registration is awaiting Administrator approval")
    token = jwt.encode({"sub": faculty.school_id, "exp": datetime.utcnow() + timedelta(days=30)}, SECRET_KEY, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "faculty": serialize(faculty, True)}
@api.post("/auth/signup", status_code=201)
async def signup(payload: FacultySignup, db: AsyncSession = Depends(session)):
    school_id = payload.school_id.strip().upper()
    required_fields = [school_id, payload.full_name.strip(), payload.department.strip(),
                       payload.office_location.strip(), payload.email.strip(), payload.office_hours.strip()]
    if not all(required_fields): raise HTTPException(422, "All registration fields are required")
    if len(payload.password) < 8: raise HTTPException(422, "Password must be at least 8 characters")
    if "@" not in payload.email: raise HTTPException(422, "Enter a valid email address")
    if await db.scalar(select(Faculty).where(Faculty.school_id == school_id)):
        raise HTTPException(409, "A faculty account with this School ID already exists")
    faculty = Faculty(
        school_id=school_id,
        password_hash=pwd_context.hash(payload.password),
        full_name=payload.full_name.strip(),
        department=payload.department.strip(),
        office_location=payload.office_location.strip(),
        email=payload.email.strip().lower(),
        office_hours=payload.office_hours.strip(),
        availability_status="unavailable",
        is_approved=False,
    )
    db.add(faculty); await db.commit(); await db.refresh(faculty)
    return {"message": "Registration submitted. An Administrator must approve your account before you can sign in.", "faculty": serialize(faculty, True)}
@api.get("/faculty/profile")
async def profile(faculty: Faculty = Depends(current_faculty)): return serialize(faculty, True)
@api.patch("/faculty/profile")
async def update_profile(payload: FacultyProfileUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(faculty, key, value)
    await db.commit(); await db.refresh(faculty); return serialize(faculty, True)
@api.patch("/faculty/availability")
async def availability(payload: AvailabilityUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    if payload.status not in {"available", "busy", "unavailable"}: raise HTTPException(422, "Invalid availability status")
    faculty.availability_status = payload.status
    faculty.accepting_consultations = (payload.status == "available") if payload.accepting_consultations is None else payload.accepting_consultations
    if payload.status == "unavailable": faculty.accepting_consultations = False
    await db.commit()
    event = {"faculty_id": faculty.school_id, "status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations}
    await connections.send("availability_changed", event)
    return {"message": "Availability updated", "status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations}
@api.post("/auth/logout")
async def logout(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    faculty.availability_status = "unavailable"; faculty.accepting_consultations = False; await db.commit()
    await connections.send("availability_changed", {"faculty_id": faculty.school_id, "status": "unavailable", "accepting_consultations": False})
    return {"message": "Logged out and marked unavailable"}
@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    if not pwd_context.verify(payload.current_password, faculty.password_hash): raise HTTPException(400, "Current password is incorrect")
    faculty.password_hash = pwd_context.hash(payload.new_password); await db.commit(); return {"message": "Password changed successfully"}

@api.get("/admin/summary")
async def admin_summary(db: AsyncSession = Depends(session), admin: Faculty = Depends(current_management_viewer)):
    today = now().date().isoformat()
    faculty_count = await db.scalar(select(func.count()).select_from(Faculty).where(Faculty.role.in_(["faculty", "it_chair"])))
    student_count = await db.scalar(select(func.count()).select_from(StudentRecord))
    pending_count = await db.scalar(select(func.count()).select_from(ConsultationRequestRecord).where(ConsultationRequestRecord.status == "pending"))
    today_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(ConsultationRecord.date == today))
    active_queues = await db.scalar(select(func.count()).select_from(QueueRecord).where(QueueRecord.status.in_(["waiting", "serving"])))
    return {"faculty_count": faculty_count or 0, "student_count": student_count or 0,
            "pending_requests": pending_count or 0, "today_consultations": today_count or 0,
            "active_queue_entries": active_queues or 0, "admin_name": admin.full_name}

@api.get("/admin/faculty")
async def admin_faculty(db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    rows = (await db.scalars(select(Faculty).where(Faculty.role.in_(["faculty", "it_chair"])).order_by(Faculty.full_name))).all()
    output = []
    for row in rows:
        item = serialize(row, True)
        item["total_consultations"] = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(ConsultationRecord.faculty_school_id == row.school_id)) or 0
        output.append(item)
    return output

@api.get("/admin/students")
async def admin_students(db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    return [serialize(row) for row in (await db.scalars(select(StudentRecord).order_by(StudentRecord.full_name))).all()]

@api.get("/admin/faculty/{school_id}/consultations")
async def admin_faculty_consultations(school_id: str, db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    rows = (await db.scalars(select(ConsultationRecord).where(ConsultationRecord.faculty_school_id == school_id).order_by(ConsultationRecord.date.desc(), ConsultationRecord.time.desc()))).all()
    return [serialize(row) for row in rows]

@api.get("/admin/consultations/today")
async def admin_today_consultations(db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    today = now().date().isoformat()
    rows = (await db.scalars(select(ConsultationRecord).where(ConsultationRecord.date == today).order_by(ConsultationRecord.time))).all()
    return [serialize(row) for row in rows]

@api.patch("/admin/faculty/{school_id}")
async def admin_update_faculty(school_id: str, payload: AdminFacultyUpdate, db: AsyncSession = Depends(session), _: Faculty = Depends(current_admin)):
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role == "faculty")))
    if not faculty: raise HTTPException(404, "Faculty account not found")
    if payload.availability_status and payload.availability_status not in {"available", "busy", "unavailable"}:
        raise HTTPException(422, "Invalid availability status")
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(faculty, key, value.strip() if isinstance(value, str) else value)
    if faculty.availability_status == "unavailable": faculty.accepting_consultations = False
    await db.commit(); await db.refresh(faculty)
    await connections.send("availability_changed", {"faculty_id": faculty.school_id, "status": faculty.availability_status})
    return serialize(faculty, True)

@api.post("/admin/faculty/{school_id}/approve")
async def approve_faculty(school_id: str, db: AsyncSession = Depends(session), _: Faculty = Depends(current_admin)):
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role == "faculty")))
    if not faculty: raise HTTPException(404, "Faculty registration not found")
    faculty.is_approved = True; await db.commit(); await db.refresh(faculty)
    return {"message": f"{faculty.full_name} is approved", "faculty": serialize(faculty, True)}

@api.post("/admin/faculty/{school_id}/reject")
async def reject_faculty(school_id: str, db: AsyncSession = Depends(session), _: Faculty = Depends(current_admin)):
    """Reject a pending sign-up. Approved accounts must use the deletion workflow."""
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role == "faculty")))
    if not faculty: raise HTTPException(404, "Faculty registration not found")
    if faculty.is_approved: raise HTTPException(409, "Approved faculty accounts cannot be rejected")
    await db.delete(faculty); await db.commit()
    return {"message": "Faculty registration rejected"}

@api.post("/admin/it-chair/{school_id}")
async def assign_it_chair(school_id: str, db: AsyncSession = Depends(session), _: Faculty = Depends(current_admin)):
    nominee = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role.in_(["faculty", "it_chair"]))))
    if not nominee: raise HTTPException(404, "Active faculty account not found")
    for chair in (await db.scalars(select(Faculty).where(Faculty.role == "it_chair"))).all(): chair.role = "faculty"
    nominee.role = "it_chair"; nominee.availability_status = "unavailable"; nominee.accepting_consultations = False
    await db.commit()
    await connections.send("availability_changed", {"faculty_id": nominee.school_id, "status": "unavailable", "accepting_consultations": False})
    return {"message": f"{nominee.full_name} is now the IT Chair", "it_chair": serialize(nominee, True)}

@api.delete("/admin/it-chair")
async def remove_it_chair(db: AsyncSession = Depends(session), _: Faculty = Depends(current_admin)):
    chair = await db.scalar(select(Faculty).where(Faculty.role == "it_chair"))
    if not chair: raise HTTPException(404, "No IT Chair is currently assigned")
    chair.role = "faculty"; await db.commit()
    return {"message": f"{chair.full_name} returned to normal faculty access"}

@api.delete("/admin/faculty/{school_id}")
async def delete_faculty_account(school_id: str, payload: AdminPasswordConfirmation, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    # A valid admin JWT alone is not enough for irreversible account deletion.
    if not pwd_context.verify(payload.admin_password, admin.password_hash):
        raise HTTPException(403, "Administrator password is incorrect")
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role.in_(["faculty", "it_chair"]))))
    if not faculty: raise HTTPException(404, "Faculty account not found")
    # Keep completed consultation history for institutional reporting, but remove live account/queue data.
    await db.execute(delete(NotificationRecord).where(NotificationRecord.faculty_school_id == school_id))
    await db.execute(delete(ConsultationRequestRecord).where(ConsultationRequestRecord.faculty_school_id == school_id))
    await db.execute(delete(QueueRecord).where(QueueRecord.faculty_school_id == school_id))
    await db.execute(delete(QueueCounter).where(QueueCounter.faculty_school_id == school_id))
    await db.delete(faculty); await db.commit()
    # Tell an active faculty app to clear its locally cached JWT immediately.
    await connections.send("account_deleted", {"message": "Your faculty account has been removed by an administrator."}, faculty_id=school_id)
    await connections.send("availability_changed", {"faculty_id": school_id, "status": "unavailable", "accepting_consultations": False})
    return {"message": "Faculty account deleted; completed consultation records were retained"}

@api.get("/kiosk/faculty")
async def kiosk_faculty(db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(Faculty).where(and_(Faculty.role.in_(["faculty", "it_chair"]), Faculty.is_approved == True)).order_by(Faculty.full_name))).all()
    return [{key: serialize(row, True)[key] for key in ("school_id", "full_name", "department", "office_location", "profile_image", "availability_status", "accepting_consultations", "office_hours")} for row in rows]
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
    # Remove historical closed entries before allocating a fresh queue number.
    # This keeps the A001 reset rule compatible with the database's per-faculty
    # unique queue-number constraint, including records created by older versions.
    active_count = await db.scalar(select(func.count()).select_from(QueueRecord).where(and_(
        QueueRecord.faculty_school_id == faculty.school_id,
        QueueRecord.status.in_(["waiting", "serving"]),
    )))
    if not active_count:
        await db.execute(delete(QueueRecord).where(and_(
            QueueRecord.faculty_school_id == faculty.school_id,
            QueueRecord.status.in_(["completed", "cancelled"]),
        )))
    counter = await db.scalar(select(QueueCounter).where(QueueCounter.faculty_school_id == faculty.school_id).with_for_update())
    if not counter: counter = QueueCounter(faculty_school_id=faculty.school_id, last_number=0); db.add(counter); await db.flush()
    elif not active_count: counter.last_number = 0
    counter.last_number += 1; names = [student.full_name for student in payload.students]; ids = [student.student_id for student in payload.students]
    queue = QueueRecord(faculty_school_id=faculty.school_id, queue_number=counter.last_number, student_ids=ids, student_names=names, topic=payload.topic, consultation_type=payload.consultation_type)
    db.add(queue); await db.flush(); display = names[0] if len(names) == 1 else f"{names[0]} +{len(names)-1} more"
    db.add(ConsultationRequestRecord(faculty_school_id=faculty.school_id, student_id=",".join(ids), student_name=display, student_program=f"{payload.students[0].program} • {payload.students[0].year_level} - {payload.students[0].section}", topic=payload.topic, preferred_date=now().date().isoformat(), preferred_time="Walk-in", queue_id=queue.id, queue_number=queue.queue_number, consultation_type=payload.consultation_type))
    db.add(NotificationRecord(faculty_school_id=faculty.school_id, type="new_request", title="New Kiosk Consultation Request", message=f"{display} requested consultation (Queue #{queue.queue_number})")); await db.commit()
    event_data = {"faculty_id": faculty.school_id, "queue_number": queue.queue_number}
    await connections.send("new_consultation_request", event_data, faculty.school_id)
    await connections.send("new_notification", event_data, faculty.school_id)
    await connections.send("queue_updated", {"faculty_id": faculty.school_id})
    return {"message": "Consultation request submitted", "queue_number": queue_label(queue.queue_number), "queue_id": queue.id, "faculty_name": faculty.full_name, "faculty_office": faculty.office_location}
@api.get("/kiosk/queue/{faculty_school_id}")
async def kiosk_queue(faculty_school_id: str, db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty_school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all()
    output = [serialize(row) for row in rows]
    for item in output: item["queue_number"] = queue_label(item["queue_number"])
    return output

@api.get("/consultation-requests")
async def requests(status: Optional[str] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(ConsultationRequestRecord).where(ConsultationRequestRecord.faculty_school_id == faculty.school_id)
    if status: query = query.where(ConsultationRequestRecord.status == status)
    output = []
    for row in (await db.scalars(query.order_by(ConsultationRequestRecord.created_at.desc()))).all():
        item = serialize(row)
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                item["student_names"] = queue.student_names
                item["student_ids"] = queue.student_ids
        output.append(item)
    return output
@api.get("/consultation-requests/{request_id}")
async def request_detail(request_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.id == request_id, ConsultationRequestRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Request not found")
    item = serialize(row)
    if row.queue_id and (queue := await db.get(QueueRecord, row.queue_id)):
        item["student_names"] = queue.student_names
        item["student_ids"] = queue.student_ids
    return item
@api.post("/consultation-requests/{request_id}/action")
async def request_action(request_id: str, payload: ConsultationAction, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.id == request_id, ConsultationRequestRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Request not found")
    if payload.action == "accept":
        row.status = "accepted"
        consultation = ConsultationRecord(faculty_school_id=faculty.school_id, student_id=row.student_id, student_name=row.student_name, student_program=row.student_program, topic=row.topic, date=row.preferred_date, time=row.preferred_time, status="ongoing", queue_id=row.queue_id, queue_number=row.queue_number, consultation_type=row.consultation_type)
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                queue.status = "serving"
        faculty.availability_status = "busy"
        db.add(consultation); event = "consultation_started"
    elif payload.action == "decline":
        row.status = "declined"; row.decline_reason = payload.reason; event = "queue_updated"
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                queue.status = "cancelled"
                await reset_queue_counter_if_empty(db, faculty.school_id)
    elif payload.action == "reschedule" and payload.reschedule_date and payload.reschedule_time:
        row.status = "rescheduled"; row.preferred_date = payload.reschedule_date; row.preferred_time = payload.reschedule_time; event = "consultation_rescheduled"
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                queue.status = "cancelled"
                await reset_queue_counter_if_empty(db, faculty.school_id)
    else: raise HTTPException(400, "Invalid action or missing reschedule details")
    db.add(NotificationRecord(faculty_school_id=faculty.school_id, type=payload.action, title=f"Request {payload.action.title()}ed", message=f"Request from {row.student_name} was {payload.action}ed")); await db.commit()
    event_data = {"faculty_id": faculty.school_id}
    if payload.action == "reschedule":
        event_data.update({"student_name": row.student_name, "date": row.preferred_date, "time": row.preferred_time})
    await connections.send(event, event_data, faculty.school_id)
    await connections.send("new_notification", event_data, faculty.school_id)
    if payload.action == "reschedule":
        await connections.send("consultation_rescheduled", event_data)
    # Public kiosk and TV displays must receive faculty actions too.
    await connections.send("queue_updated", event_data)
    await connections.send("availability_changed", event_data)
    return {"message": f"Request {payload.action}ed", "status": row.status}

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
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be edited")
    if payload.status is not None:
        raise HTTPException(422, "Use the session actions to change consultation status")
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(row, key, value)
    row.updated_at = now(); await db.commit(); return serialize(row)
@api.post("/consultations/{consultation_id}/start")
async def consultation_start(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be started")
    if row.status == "ongoing":
        return {"message": "Consultation is already ongoing", "status": "ongoing"}
    if row.status != "scheduled":
        raise HTTPException(409, "Only scheduled consultations can be started")
    row.status = "ongoing"; row.updated_at = now(); faculty.availability_status = "busy"
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue: queue.status = "serving"
    await db.commit()
    for event in ("consultation_started", "queue_updated", "availability_changed"): await connections.send(event, {"faculty_id": faculty.school_id})
    return {"message": "Consultation started", "status": "ongoing"}
@api.post("/consultations/{consultation_id}/complete")
async def consultation_complete(consultation_id: str, payload: Optional[ConsultationComplete] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be completed again")
    if row.status != "ongoing":
        raise HTTPException(409, "Start the consultation before completing it")
    if payload and payload.notes is not None: row.notes = payload.notes
    row.duration = max(1, int((now() - row.updated_at).total_seconds() / 60)); row.status = "completed"; row.updated_at = now(); faculty.availability_status = "available"
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue:
            queue.status = "completed"
            await reset_queue_counter_if_empty(db, faculty.school_id)
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
    return {"today_count": today_count or 0, "pending_requests": pending_requests or 0, "monthly_count": monthly_count or 0, "availability_status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations, "upcoming_consultations": [serialize(row) for row in upcoming]}

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
    for faculty in (await db.scalars(select(Faculty).where(Faculty.role.in_(["faculty", "it_chair"])).order_by(Faculty.full_name))).all():
        queue = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all(); serving = next((item for item in queue if item.status == "serving"), None); waiting = [item for item in queue if item.status == "waiting"]
        output.append({"school_id": faculty.school_id, "full_name": faculty.full_name, "department": faculty.department, "office_location": faculty.office_location, "profile_image": faculty.profile_image, "availability_status": faculty.availability_status, "now_serving": {"queue_number": queue_label(serving.queue_number), "student_names": serving.student_names, "topic": serving.topic} if serving else None, "waiting_count": len(waiting), "next_queue_numbers": [queue_label(item.queue_number) for item in waiting[:5]]})
    return output
@api.post("/seed")
async def seed_demo_data(db: AsyncSession = Depends(session)):
    """Reset demo data. This is deliberately unavailable in production."""
    if not ALLOW_SEED_DATA or ENVIRONMENT not in {"development", "test"}:
        raise HTTPException(403, "Demo seeding is only available in development or test environments")
    for model in (NotificationRecord, ConsultationRecord, ConsultationRequestRecord,
                  QueueRecord, QueueCounter, StudentRecord, Faculty):
        await db.execute(delete(model))

    faculty_data = [
        ("FAC2024001", "Dr. Maria Santos", "Computer Science", "Room 301, Science Building"),
        ("FAC2024002", "Prof. Juan Reyes", "Information Technology", "Room 202, Technology Building"),
        ("FAC2024003", "Dr. Elena Cruz", "Mathematics", "Room 104, Mathematics Building"),
        ("FAC2024004", "Prof. Antonio Villar", "Engineering", "Room 401, Engineering Building"),
        ("FAC2024005", "Dr. Sofia Mendoza", "Business Administration", "Room 205, Business Building"),
        ("FAC2024006", "Prof. Roberto Lim", "Computer Science", "Room 302, Science Building"),
    ]
    for school_id, full_name, department, office_location in faculty_data:
        db.add(Faculty(school_id=school_id, password_hash=pwd_context.hash("password123"),
                       full_name=full_name, department=department, office_location=office_location,
                       email=f"{school_id.lower()}@test.local", availability_status="available",
                       office_hours="Mon-Fri 9:00 AM - 5:00 PM"))
    students = [
        ("STU2024101", "John Dela Cruz", "BSCS", "4th Year", "BSCS-4A"),
        ("STU2024102", "Jane Smith", "BSIT", "3rd Year", "BSIT-3A"),
        ("STU2024103", "Miguel Torres", "BSCS", "4th Year", "BSCS-4A"),
        ("STU2024104", "Ana Garcia", "BSIT", "2nd Year", "BSIT-2A"),
        ("STU2024105", "Paolo Ramos", "BSBA", "3rd Year", "BSBA-3A"),
        ("STU2024106", "Lea Flores", "BS Math", "2nd Year", "BSM-2A"),
        ("STU2024107", "Carlo Diaz", "BSCE", "4th Year", "BSCE-4A"),
        ("STU2024108", "Mia Tan", "BSCS", "1st Year", "BSCS-1A"),
    ]
    for student_id, full_name, program, year_level, section in students:
        db.add(StudentRecord(student_id=student_id, full_name=full_name, program=program,
                             year_level=year_level, section=section))
    await db.commit()
    return {"message": "Test/demo data seeded", "faculty_count": len(faculty_data), "student_count": len(students)}

app.include_router(api)
socket_app = app
logging.basicConfig(level=logging.INFO)
