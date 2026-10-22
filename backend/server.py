"""ConKiosk FastAPI backend: PostgreSQL/SQLAlchemy and native WebSockets."""
import asyncio
import logging
import os
import uuid
import base64
import hashlib
import re
import time
from collections import defaultdict, deque
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel as PydanticBaseModel, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Text, UniqueConstraint, and_, delete, func, or_, select, text, update
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
def local_today() -> str: return datetime.now(ZoneInfo('Asia/Manila')).date().isoformat()
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
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    privacy_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    privacy_acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    class_schedules: Mapped[list] = mapped_column(JSON, default=list)
    presence_last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    presence_restore_available: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')

class StudentRecord(Base):
    __tablename__ = "students"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    student_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    program: Mapped[str] = mapped_column(String(128), default="")
    year_level: Mapped[str] = mapped_column(String(64), default="")
    section: Mapped[str] = mapped_column(String(64), default="")
    roster_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')

class QueueCounter(Base):
    __tablename__ = "queue_counters"
    faculty_school_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0)

class GlobalQueueCounter(Base):
    __tablename__ = 'global_queue_counter'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0)

class QueueRecord(Base):
    __tablename__ = "queue"
    __table_args__ = (UniqueConstraint("faculty_school_id", "queue_number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    queue_number: Mapped[int] = mapped_column(Integer)
    student_ids: Mapped[list] = mapped_column(JSON, default=list)
    student_names: Mapped[list] = mapped_column(JSON, default=list)
    student_details: Mapped[list] = mapped_column(JSON, default=list)
    topic: Mapped[str] = mapped_column(String(500))
    consultation_type: Mapped[str] = mapped_column(String(32), default="individual")
    status: Mapped[str] = mapped_column(String(32), default="waiting")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ConsultationRequestRecord(Base):
    __tablename__ = "consultation_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_school_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(Text)
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
    student_id: Mapped[str] = mapped_column(Text)
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
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    students: Mapped[list] = mapped_column(JSON, default=list)

class AuthSession(Base):
    __tablename__ = 'auth_sessions'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    faculty_id: Mapped[str] = mapped_column(String(36), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)

class RetiredFacultyID(Base):
    __tablename__ = 'retired_faculty_ids'
    school_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    retired_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class AuditLog(Base):
    __tablename__ = 'audit_log'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=id_value)
    actor_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class SubmissionReceipt(Base):
    __tablename__ = 'submission_receipts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)

def audit(db, actor, action, target):
    db.add(AuditLog(actor_id=actor.id, action=action, target=target))

class BaseModel(PydanticBaseModel):
    @model_validator(mode='after')
    def validate_fields(self):
        limits = {'school_id': 64, 'faculty_school_id': 64, 'student_id': 64, 'topic': 500, 'reason': 2000, 'notes': 20000, 'remarks': 2000, 'year_level': 64, 'section': 64, 'program': 128, 'profile_image': 750000, 'privacy_version': 64, 'submission_id': 36, 'reschedule_date': 10, 'reschedule_time': 64}
        for key in type(self).model_fields:
            value = getattr(self, key)
            if not isinstance(value, str): continue
            if 'password' in key:
                if not value or len(value.encode('utf-8')) > 72: raise ValueError('Passwords must contain 1–72 UTF-8 bytes')
                if key in {'new_password', 'password'} and type(self).__name__ != 'LoginRequest' and len(value) < 12: raise ValueError('Use at least 12 characters for the new password')
                continue
            if len(value) > limits.get(key, 255): raise ValueError(f'{key} is too long')
            if key not in {'notes', 'remarks', 'profile_image', 'reason'}:
                value = value.strip()
                setattr(self, key, value)
                if not value and key != 'program': raise ValueError(f'{key} cannot be blank')
            if key == 'email' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value): raise ValueError('Enter a valid email address')
            if key in {'school_id', 'student_id', 'faculty_school_id'} and not re.fullmatch(r'[A-Za-z0-9_-]+', value): raise ValueError('IDs may contain letters, numbers, underscores and hyphens')
            if key == 'profile_image' and value:
                decode_photo(value)
            if key == 'reason' and not value.strip(): raise ValueError('Enter a reason')
            if key == 'reschedule_date':
                try: datetime.strptime(value, '%Y-%m-%d')
                except ValueError: raise ValueError('Use a valid YYYY-MM-DD date')
                if value < local_today(): raise ValueError('Choose today or a future appointment date')
        return self

def decode_photo(value, enforce_size=True):
    match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)', value)
    if not match: raise ValueError('Use a JPG, PNG or WebP profile photo')
    try: data = base64.b64decode(match[2], validate=True)
    except Exception: raise ValueError('Invalid profile photo')
    if enforce_size and len(data) > 512 * 1024: raise ValueError('Profile photo must be at most 512 KB')
    if not (data.startswith(b'\xff\xd8\xff') or data.startswith(b'\x89PNG\r\n\x1a\n') or (data.startswith(b'RIFF') and data[8:12] == b'WEBP')): raise ValueError('Invalid image content')
    return data, f'image/{match[1]}'

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
    class_schedules: list[dict] = Field(default_factory=list, max_length=30)
    privacy_acknowledged: bool = False
    privacy_version: str = '1'
class FacultyProfileUpdate(BaseModel):
    full_name: Optional[str] = None; department: Optional[str] = None; office_location: Optional[str] = None
    email: Optional[str] = None; profile_image: Optional[str] = None; office_hours: Optional[str] = None; class_schedules: Optional[list[dict]] = None
class AvailabilityUpdate(BaseModel): status: str; accepting_consultations: Optional[bool] = None
class ConsultationAction(BaseModel):
    action: str; reschedule_date: Optional[str] = None; reschedule_time: Optional[str] = None; reason: Optional[str] = None
class ConsultationUpdate(BaseModel):
    notes: Optional[str] = None; remarks: Optional[str] = None; status: Optional[str] = None; duration: Optional[int] = None
class ConsultationComplete(BaseModel):
    notes: Optional[str] = None
    advance: bool = True
class ConsultationCancel(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
class PasswordReset(BaseModel):
    admin_password: str
    new_password: str
class ChangePasswordRequest(BaseModel): current_password: str; new_password: str
class AdminPasswordConfirmation(BaseModel):
    admin_password: str = Field(min_length=1, max_length=512)
    delete_history: bool = False
class Student(BaseModel): student_id: str; full_name: str; program: str = ""; year_level: str; section: str
class KioskConsultationRequest(BaseModel):
    faculty_school_id: str; topic: str; consultation_type: str = 'individual'; students: list[Student] = Field(min_length=1, max_length=30)
    submission_id: Optional[str] = None
class AdminFacultyUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=255)
    department: Optional[str] = Field(default=None, max_length=255)
    office_location: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    office_hours: Optional[str] = Field(default=None, max_length=255)
    availability_status: Optional[str] = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

SCHEDULE_DAYS = {'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'}
def validate_schedules(entries: list[dict]) -> list[dict]:
    """Normalize schedule entries and reject malformed/overlapping periods."""
    normalized = []
    for item in entries:
        if not isinstance(item, dict): raise HTTPException(422, 'Each class schedule must be an object')
        day, start, end = str(item.get('day', '')).strip(), str(item.get('start', '')).strip(), str(item.get('end', '')).strip()
        if day not in SCHEDULE_DAYS or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', start) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', end):
            raise HTTPException(422, 'Choose a valid class day, start time, and end time')
        if start >= end: raise HTTPException(422, 'A class must end after it starts')
        normalized.append({'day': day, 'start': start, 'end': end})
    for day in SCHEDULE_DAYS:
        periods = sorted((entry for entry in normalized if entry['day'] == day), key=lambda entry: entry['start'])
        if any(current['start'] < previous['end'] for previous, current in zip(periods, periods[1:])):
            raise HTTPException(422, f'Class schedules overlap on {day}')
    return normalized

def schedule_summary(entries: list[dict]) -> str:
    return ', '.join(f"{entry['day'][:3]} {entry['start']}–{entry['end']}" for entry in entries)
def serialize(record: Any, secret: bool = False) -> dict:
    values = {column.name: getattr(record, column.name) for column in record.__table__.columns}
    values["_id"] = values.pop("id")
    if secret: values.pop("password_hash", None)
    if isinstance(record, ConsultationRecord) and record.students:
        values['student_name'] = ', '.join(student.get('full_name', '') for student in record.students)
    return values
async def session() -> AsyncSession:
    async with SessionLocal() as value: yield value
async def current_faculty(credentials: HTTPAuthorizationCredentials = Depends(security), db: AsyncSession = Depends(session)) -> Faculty:
    faculty = await authenticate_token(credentials.credentials, db)
    return faculty

async def authenticate_token(token, db):
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        session_record = await db.get(AuthSession, claims.get('sid', ''))
        faculty = await db.get(Faculty, claims.get('uid', ''))
        if not session_record or not faculty or session_record.faculty_id != faculty.id or session_record.expires_at <= now() or not faculty.is_approved or faculty.is_deleted:
            raise HTTPException(401, 'Your session has ended. Please sign in again.')
        return faculty
    except JWTError:
        raise HTTPException(401, 'Your session has ended. Please sign in again.')

async def trusted_kiosk(request: Request):
    allowed = {'127.0.0.1', '::1'} | {value.strip() for value in os.getenv('KIOSK_ALLOWED_IPS', '').split(',') if value.strip()}
    lan_host = urlparse(lan_origin).hostname
    if lan_host: allowed.add(lan_host)
    if not request.client or request.client.host not in allowed:
        raise HTTPException(403, 'Student lookup is restricted to the registered kiosk')
async def current_admin(faculty: Faculty = Depends(current_faculty)) -> Faculty:
    if faculty.role != "admin": raise HTTPException(403, "Administrator access is required")
    return faculty
async def current_management_viewer(faculty: Faculty = Depends(current_faculty)) -> Faculty:
    if faculty.role not in {"admin", "it_chair"}: raise HTTPException(403, "Administrator or IT Chair access is required")
    return faculty

async def reset_queue_counter_if_empty(db: AsyncSession, faculty_school_id: str) -> None:
    """Remove closed live tickets without resetting the shared number counter."""
    active_count = await db.scalar(select(func.count()).select_from(QueueRecord).where(and_(
        QueueRecord.faculty_school_id == faculty_school_id,
        QueueRecord.status.in_(["waiting", "serving"]),
    )))
    if not active_count:
        # Consultation history retains its own queue-number snapshot.
        await db.execute(delete(QueueRecord).where(and_(
            QueueRecord.faculty_school_id == faculty_school_id,
            QueueRecord.status.in_(["completed", "cancelled"]),
        )))

async def lock_faculty_queue(db: AsyncSession, faculty: Faculty) -> None:
    """Serialize all queue mutations for a faculty, including empty queues."""
    await db.execute(select(Faculty).where(Faculty.school_id == faculty.school_id).with_for_update())

async def advance_queue(db: AsyncSession, faculty: Faculty) -> Optional[ConsultationRecord]:
    await db.flush()
    if await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == faculty.school_id, ConsultationRecord.status == 'ongoing'))):
        return None
    head = await db.scalar(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status == 'waiting')).order_by(QueueRecord.queue_number).limit(1))
    if not head:
        return None
    consultation = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.queue_id == head.id, ConsultationRecord.status == 'scheduled')).order_by(ConsultationRecord.created_at).limit(1))
    # A pending request must be accepted before its student can be called.
    if not consultation:
        return None
    consultation.status = 'ongoing'
    consultation.started_at = consultation.updated_at = now()
    head.status = 'serving'
    faculty.availability_status = 'busy'
    return consultation

class Connections:
    def __init__(self): self.all: set[WebSocket] = set(); self.faculty: dict[str, set[WebSocket]] = {}
    async def connect(self, ws: WebSocket, faculty_id: Optional[str]):
        await ws.accept(); self.all.add(ws)
        if faculty_id: self.faculty.setdefault(faculty_id, set()).add(ws)
    def remove(self, ws: WebSocket, faculty_id: Optional[str]):
        self.all.discard(ws)
        if faculty_id: self.faculty.get(faculty_id, set()).discard(ws)
        # Start the grace period at the authenticated app's server disconnect.
        if faculty_id: asyncio.create_task(mark_faculty_disconnected(faculty_id))
    async def send(self, event: str, data: dict, faculty_id: Optional[str] = None):
        sockets = self.faculty.get(faculty_id, set()) if faculty_id else self.all
        for ws in list(sockets):
            try: await ws.send_json({"type": event, "data": data})
            except Exception: self.remove(ws, faculty_id)
connections = Connections()

async def mark_faculty_disconnected(faculty_school_id: str):
    """After a continuous 100-second app-server disconnect, mark Available offline."""
    await asyncio.sleep(100)
    if connections.faculty.get(faculty_school_id): return
    async with SessionLocal() as db:
        faculty = await db.scalar(select(Faculty).where(Faculty.school_id == faculty_school_id))
        if not faculty or faculty.availability_status != 'available': return
        faculty.availability_status = 'unavailable'
        faculty.accepting_consultations = False
        faculty.presence_restore_available = True
        await db.commit()
        await connections.send('availability_changed', {'faculty_id': faculty.school_id, 'status': 'unavailable', 'accepting_consultations': False})

app = FastAPI(); api = APIRouter(prefix="/api")
@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    messages = [f"{'.'.join(str(part) for part in item['loc'][1:])}: {item['msg']}" for item in error.errors()]
    return JSONResponse({'detail': '; '.join(messages)}, status_code=422)
_attempts = defaultdict(deque)
@app.middleware('http')
async def throttle(request: Request, call_next):
    path = request.url.path
    if request.method in {'POST', 'DELETE'} and (path.startswith('/api/auth/') or path.startswith('/api/admin/') or path.startswith('/api/kiosk/')):
        peer = request.client.host if request.client else 'unknown'
        bucket = 'login' if path == '/api/auth/login' else 'signup' if path == '/api/auth/signup' else 'sensitive' if (path.endswith('/reset-password') or (request.method == 'DELETE' and path.startswith(('/api/admin/faculty/', '/api/admin/archives/')))) else 'write'
        key = (peer, bucket)
        stamp = time.monotonic()
        limit, window = (10, 60) if bucket == 'login' else (5, 3600) if bucket == 'signup' else (5, 300) if bucket == 'sensitive' else (120, 60)
        entries = _attempts[key]
        while entries and entries[0] <= stamp - window: entries.popleft()
        if len(entries) >= limit:
            return JSONResponse({'detail': 'Too many attempts. Please wait and try again.'}, status_code=429, headers={'Retry-After': str(max(1, int(window - stamp + entries[0])))})
        entries.append(stamp)
        if len(_attempts) > 10000:
            for old_key in list(_attempts):
                if not _attempts[old_key] or _attempts[old_key][-1] < stamp - 3600: _attempts.pop(old_key, None)
    return await call_next(request)
app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
@api.get("/health")
async def health(db: AsyncSession = Depends(session)):
    """Public local-service health check; no internet is involved."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "ConKiosk database is unavailable")
    return {"status": "ok", "service": "conkiosk-api", "database": "ok"}

@api.get('/privacy-notice')
async def privacy_notice():
    return {'version': '1', 'institution': os.getenv('PRIVACY_INSTITUTION', ''), 'contact': os.getenv('PRIVACY_CONTACT', ''), 'retention': os.getenv('PRIVACY_RETENTION', ''), 'roster_required': os.getenv('REQUIRE_STUDENT_ROSTER', 'false').lower() == 'true'}
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all does not add columns to existing PostgreSQL tables.
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'faculty'"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS accepting_consultations BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS privacy_version VARCHAR(64) NULL"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS privacy_acknowledged_at TIMESTAMP NULL"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS class_schedules JSON NOT NULL DEFAULT '[]'"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS presence_last_seen TIMESTAMP NULL"))
        await conn.execute(text("ALTER TABLE faculty ADD COLUMN IF NOT EXISTS presence_restore_available BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS students JSON NOT NULL DEFAULT '[]'"))
        await conn.execute(text("ALTER TABLE students ADD COLUMN IF NOT EXISTS roster_verified BOOLEAN NOT NULL DEFAULT false"))
        await conn.execute(text("ALTER TABLE queue ADD COLUMN IF NOT EXISTS student_details JSON NOT NULL DEFAULT '[]'"))
        await conn.execute(text("ALTER TABLE consultations ALTER COLUMN student_id TYPE TEXT"))
        await conn.execute(text("ALTER TABLE consultation_requests ALTER COLUMN student_id TYPE TEXT"))
        # Bootstrap above every known legacy ticket; never move backwards on restart.
        await conn.execute(text("""INSERT INTO global_queue_counter (id, last_number)
            SELECT 1, COALESCE(MAX(number), 0) FROM (
                SELECT queue_number AS number FROM queue
                UNION ALL SELECT queue_number FROM consultations
                UNION ALL SELECT queue_number FROM consultation_requests
                UNION ALL SELECT last_number FROM queue_counters
            ) known ON CONFLICT (id) DO UPDATE
            SET last_number = GREATEST(global_queue_counter.last_number, EXCLUDED.last_number)"""))
        await conn.execute(text("""UPDATE consultations c SET students = (SELECT json_agg(json_build_object('student_id', ids.value, 'full_name', names.value)) FROM json_array_elements_text(q.student_ids) WITH ORDINALITY ids(value, n) JOIN json_array_elements_text(q.student_names) WITH ORDINALITY names(value,n) USING (n)) FROM queue q WHERE c.queue_id=q.id AND json_array_length(c.students)=0"""))
        await conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS started_at TIMESTAMP NULL"))
        await conn.execute(text("""
            WITH duplicates AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY queue_id
                    ORDER BY CASE WHEN status = 'ongoing' THEN 0 ELSE 1 END, created_at, id) AS position
                FROM consultations WHERE queue_id IS NOT NULL AND status IN ('ongoing', 'scheduled')
            ) UPDATE consultations SET status = 'cancelled',
                remarks = CONCAT(COALESCE(remarks, ''), ' [Duplicate active ticket reconciled; notes retained.]')
              WHERE id IN (SELECT id FROM duplicates WHERE position > 1)
        """))
        # Preserve legacy history and notes; keep the earliest session active and
        # move accidental concurrent sessions back into the waiting workflow.
        await conn.execute(text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY faculty_school_id
                    ORDER BY queue_number ASC NULLS LAST, created_at, id) AS position
                FROM consultations WHERE status = 'ongoing'
            ) UPDATE consultations SET status = 'scheduled', started_at = NULL
              WHERE id IN (SELECT id FROM ranked WHERE position > 1)
        """))
        await conn.execute(text("UPDATE consultations SET started_at = updated_at WHERE status = 'ongoing' AND started_at IS NULL"))
        await conn.execute(text("""UPDATE queue q SET status = 'waiting'
            WHERE q.status = 'serving' AND NOT EXISTS (
                SELECT 1 FROM consultations c WHERE c.queue_id = q.id AND c.status = 'ongoing')"""))
        await conn.execute(text("""UPDATE queue q SET status = 'serving'
            WHERE q.status = 'waiting' AND EXISTS (
                SELECT 1 FROM consultations c WHERE c.queue_id = q.id AND c.status = 'ongoing')"""))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS one_ongoing_consultation_per_faculty ON consultations (faculty_school_id) WHERE status = 'ongoing'"))
        await conn.execute(text("UPDATE faculty f SET availability_status = 'busy' WHERE EXISTS (SELECT 1 FROM consultations c WHERE c.faculty_school_id = f.school_id AND c.status = 'ongoing')"))
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
            await db.commit()

    # Presence is intentionally authenticated and conservative.  It is a
    # fallback for routers (including the deployed Tenda) that do not expose a
    # usable client-presence API.  A missing heartbeat only changes an account
    # which was previously available; Busy/manual-Unavailable states are kept.
    async def presence_watchdog():
        while True:
            await asyncio.sleep(30)
            cutoff = now() - timedelta(seconds=100)
            async with SessionLocal() as db:
                rows = (await db.scalars(select(Faculty).where(and_(Faculty.presence_last_seen.is_not(None), Faculty.presence_last_seen < cutoff, Faculty.availability_status == 'available')))).all()
                for faculty in rows:
                    faculty.availability_status = 'unavailable'
                    faculty.accepting_consultations = False
                    faculty.presence_restore_available = True
                    await connections.send('availability_changed', {'faculty_id': faculty.school_id, 'status': 'unavailable', 'accepting_consultations': False})
                if rows: await db.commit()
    asyncio.create_task(presence_watchdog())
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, faculty_id: Optional[str] = None):
    # Public displays may subscribe without a faculty id.  Faculty-specific
    # updates must be tied to the same identity as a valid login token.
    if faculty_id:
        try:
            # Authenticate in the first frame, keeping credentials out of URLs.
            await websocket.accept()
            frame = await asyncio.wait_for(websocket.receive_json(), timeout=5)
            async with SessionLocal() as db:
                account = await authenticate_token(frame.get('token', ''), db)
                if account.school_id != faculty_id: raise HTTPException(401)
                account.presence_last_seen = now()
                if account.presence_restore_available and account.availability_status == 'unavailable':
                    account.availability_status, account.accepting_consultations = 'available', True
                    account.presence_restore_available = False
                    await connections.send('availability_changed', {'faculty_id': account.school_id, 'status': 'available', 'accepting_consultations': True})
                await db.commit()
        except (HTTPException, asyncio.TimeoutError, ValueError, WebSocketDisconnect):
            await websocket.close(code=1008)
            return
        connections.all.add(websocket)
        connections.faculty.setdefault(faculty_id, set()).add(websocket)
    else:
        await connections.connect(websocket, None)
    try:
        while True:
            try: await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError: pass
            if faculty_id:
                async with SessionLocal() as db: await authenticate_token(frame.get('token', ''), db)
    except HTTPException:
        await websocket.close(code=1008)
    except WebSocketDisconnect: pass
    finally: connections.remove(websocket, faculty_id)

@api.post("/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(session)):
    school_id = payload.school_id.strip().upper()
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == school_id))
    if not faculty: raise HTTPException(404, "No account was found for this School ID")
    if faculty.is_deleted: raise HTTPException(403, 'This account has been removed. Contact the administrator.')
    if not pwd_context.verify(payload.password, faculty.password_hash): raise HTTPException(401, "Incorrect password")
    if not faculty.is_approved: raise HTTPException(403, "Your faculty registration is awaiting Administrator approval")
    expires = now() + timedelta(hours=12)
    session_record = AuthSession(faculty_id=faculty.id, expires_at=expires)
    db.add(session_record)
    await db.execute(delete(AuthSession).where(AuthSession.expires_at <= now()))
    await db.flush()
    token = jwt.encode({'sub': faculty.school_id, 'uid': faculty.id, 'sid': session_record.id, 'exp': expires}, SECRET_KEY, algorithm='HS256')
    await db.commit()
    return {"access_token": token, "token_type": "bearer", "faculty": serialize(faculty, True)}
@api.post("/auth/signup", status_code=201)
async def signup(payload: FacultySignup, db: AsyncSession = Depends(session)):
    school_id = payload.school_id.strip().upper()
    required_fields = [school_id, payload.full_name.strip(), payload.department.strip(),
                       payload.office_location.strip(), payload.email.strip(), payload.office_hours.strip()]
    if not all(required_fields): raise HTTPException(422, "All registration fields are required")
    if not payload.privacy_acknowledged: raise HTTPException(422, 'Please acknowledge the Privacy Notice')
    if payload.privacy_version != '1': raise HTTPException(422, 'Please refresh and read the current Privacy Notice')
    if len(payload.password) < 12: raise HTTPException(422, "Password must be at least 12 characters")
    if "@" not in payload.email: raise HTTPException(422, "Enter a valid email address")
    if await db.scalar(select(Faculty).where(Faculty.school_id == school_id)) or await db.get(RetiredFacultyID, school_id):
        raise HTTPException(409, "A faculty account with this School ID already exists")
    schedules = validate_schedules(payload.class_schedules)
    faculty = Faculty(
        school_id=school_id,
        password_hash=pwd_context.hash(payload.password),
        full_name=payload.full_name.strip(),
        department=payload.department.strip(),
        office_location=payload.office_location.strip(),
        email=payload.email.strip().lower(),
        office_hours=schedule_summary(schedules) or payload.office_hours.strip(), class_schedules=schedules,
        availability_status="unavailable",
        is_approved=False,
        privacy_version=payload.privacy_version,
        privacy_acknowledged_at=now(),
    )
    db.add(faculty)
    try: await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, 'A faculty account with this School ID already exists or is archived')
    await db.refresh(faculty)
    return {"message": "Registration submitted. An Administrator must approve your account before you can sign in.", "faculty": serialize(faculty, True)}
@api.get("/faculty/profile")
async def profile(faculty: Faculty = Depends(current_faculty)): return serialize(faculty, True)
@api.patch("/faculty/profile")
async def update_profile(payload: FacultyProfileUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    changes = payload.model_dump(exclude_none=True)
    if 'class_schedules' in changes:
        changes['class_schedules'] = validate_schedules(changes['class_schedules'])
        changes['office_hours'] = schedule_summary(changes['class_schedules']) or changes.get('office_hours', faculty.office_hours)
    for key, value in changes.items(): setattr(faculty, key, value)
    await db.commit(); await db.refresh(faculty); return serialize(faculty, True)
@api.patch("/faculty/availability")
async def availability(payload: AvailabilityUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    await lock_faculty_queue(db, faculty)
    if payload.status != 'busy' and await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == faculty.school_id, ConsultationRecord.status == 'ongoing'))):
        raise HTTPException(409, 'Complete the active consultation before changing availability')
    if payload.status not in {"available", "busy", "unavailable"}: raise HTTPException(422, "Invalid availability status")
    faculty.availability_status = payload.status
    faculty.presence_restore_available = False
    faculty.accepting_consultations = (payload.status == "available") if payload.accepting_consultations is None else payload.accepting_consultations
    if payload.status == "unavailable": faculty.accepting_consultations = False
    await db.commit()
    event = {"faculty_id": faculty.school_id, "status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations}
    await connections.send("availability_changed", event)
    return {"message": "Availability updated", "status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations}
@api.post('/faculty/presence')
async def faculty_presence(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    """Authenticated app heartbeat; no router credentials or device MACs are used."""
    faculty.presence_last_seen = now()
    if faculty.presence_restore_available and faculty.availability_status == 'unavailable':
        faculty.availability_status, faculty.accepting_consultations = 'available', True
        faculty.presence_restore_available = False
        await connections.send('availability_changed', {'faculty_id': faculty.school_id, 'status': 'available', 'accepting_consultations': True})
    await db.commit()
    return {'status': faculty.availability_status}
@api.post("/auth/logout")
async def logout(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty), credentials: HTTPAuthorizationCredentials = Depends(security)):
    await lock_faculty_queue(db, faculty)
    active = await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == faculty.school_id, ConsultationRecord.status == 'ongoing')))
    faculty.availability_status = 'busy' if active else 'unavailable'
    faculty.accepting_consultations = False
    claims = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=['HS256'])
    await db.execute(delete(AuthSession).where(AuthSession.id == claims['sid']))
    audit(db, faculty, 'logout', faculty.school_id)
    await db.commit()
    await connections.send('availability_changed', {'faculty_id': faculty.school_id, 'status': faculty.availability_status, 'accepting_consultations': False})
    return {'message': 'Logged out'}
@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    if not pwd_context.verify(payload.current_password, faculty.password_hash): raise HTTPException(400, "Current password is incorrect")
    faculty.password_hash = pwd_context.hash(payload.new_password)
    await db.execute(delete(AuthSession).where(AuthSession.faculty_id == faculty.id))
    audit(db, faculty, 'password_changed', faculty.school_id)
    await db.commit()
    await connections.send('account_deleted', {'message': 'Password changed. Please sign in again.'}, faculty.school_id)
    return {'message': 'Password changed. All sessions were signed out.'}

@api.post('/admin/faculty/{school_id}/reset-password')
async def reset_password(school_id: str, payload: PasswordReset, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    if not pwd_context.verify(payload.admin_password, admin.password_hash): raise HTTPException(403, 'Administrator password is incorrect')
    account = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.is_deleted == False, Faculty.role != 'admin')).with_for_update())
    if not account: raise HTTPException(404, 'Faculty account not found')
    account.password_hash = pwd_context.hash(payload.new_password)
    await db.execute(delete(AuthSession).where(AuthSession.faculty_id == account.id))
    audit(db, admin, 'password_reset', school_id)
    await db.commit()
    await connections.send('account_deleted', {'message': 'Your password was reset. Please sign in again.'}, school_id)
    return {'message': 'Password reset. Existing sessions have been signed out.'}

@api.get("/admin/summary")
async def admin_summary(db: AsyncSession = Depends(session), admin: Faculty = Depends(current_management_viewer)):
    today = local_today()
    faculty_count = await db.scalar(select(func.count()).select_from(Faculty).where(and_(Faculty.role.in_(['faculty', 'it_chair']), Faculty.is_deleted == False)))
    student_count = await db.scalar(select(func.count()).select_from(StudentRecord))
    pending_count = await db.scalar(select(func.count()).select_from(ConsultationRequestRecord).where(ConsultationRequestRecord.status == "pending"))
    today_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(ConsultationRecord.date == today, ConsultationRecord.status == 'completed')))
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
        item.pop('profile_image', None)
        item['archived_record_count'] = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(ConsultationRecord.faculty_school_id == row.school_id)) or 0
        item['total_consultations'] = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(ConsultationRecord.faculty_school_id == row.school_id, ConsultationRecord.status == 'completed'))) or 0
        output.append(item)
    return output

@api.get("/admin/students")
async def admin_students(limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    return [serialize(row) for row in (await db.scalars(select(StudentRecord).order_by(StudentRecord.full_name, StudentRecord.id).offset(offset).limit(limit))).all()]

@api.get('/admin/audit')
async def audit_records(limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    return [serialize(row) for row in (await db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id).offset(offset).limit(limit))).all()]

@api.get("/admin/faculty/{school_id}/consultations")
async def admin_faculty_consultations(school_id: str, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    rows = (await db.scalars(select(ConsultationRecord).where(ConsultationRecord.faculty_school_id == school_id).order_by(ConsultationRecord.date.desc(), ConsultationRecord.id).offset(offset).limit(limit))).all()
    return [serialize(row) for row in rows]

@api.get("/admin/consultations/today")
async def admin_today_consultations(limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), _: Faculty = Depends(current_management_viewer)):
    today = local_today()
    rows = (await db.scalars(select(ConsultationRecord).where(ConsultationRecord.date == today).order_by(ConsultationRecord.time, ConsultationRecord.id).offset(offset).limit(limit))).all()
    return [serialize(row) for row in rows]

@api.patch("/admin/faculty/{school_id}")
async def admin_update_faculty(school_id: str, payload: AdminFacultyUpdate, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role.in_(['faculty', 'it_chair']), Faculty.is_deleted == False)).with_for_update())
    if not faculty: raise HTTPException(404, "Faculty account not found")
    if payload.availability_status and payload.availability_status != 'busy' and await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == school_id, ConsultationRecord.status == 'ongoing'))):
        raise HTTPException(409, 'Complete the active consultation before changing availability')
    if payload.availability_status and payload.availability_status not in {"available", "busy", "unavailable"}:
        raise HTTPException(422, "Invalid availability status")
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(faculty, key, value.strip() if isinstance(value, str) else value)
    if faculty.availability_status == "unavailable": faculty.accepting_consultations = False
    audit(db, admin, 'faculty_updated', school_id)
    await db.commit(); await db.refresh(faculty)
    await connections.send("availability_changed", {"faculty_id": faculty.school_id, "status": faculty.availability_status})
    return serialize(faculty, True)

@api.post("/admin/faculty/{school_id}/approve")
async def approve_faculty(school_id: str, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role == "faculty")))
    if not faculty: raise HTTPException(404, "Faculty registration not found")
    if faculty.is_deleted: raise HTTPException(409, 'This account is archived')
    faculty.is_approved = True
    audit(db, admin, 'registration_approved', school_id)
    await db.commit(); await db.refresh(faculty)
    return {"message": f"{faculty.full_name} is approved", "faculty": serialize(faculty, True)}

@api.post("/admin/faculty/{school_id}/reject")
async def reject_faculty(school_id: str, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    """Reject a pending sign-up. Approved accounts must use the deletion workflow."""
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role == "faculty")))
    if not faculty: raise HTTPException(404, "Faculty registration not found")
    if faculty.is_approved: raise HTTPException(409, "Approved faculty accounts cannot be rejected")
    if faculty.is_deleted: raise HTTPException(409, 'Archived account IDs remain reserved')
    audit(db, admin, 'registration_rejected', school_id)
    await db.delete(faculty); await db.commit()
    return {"message": "Faculty registration rejected"}

@api.post("/admin/it-chair/{school_id}")
async def assign_it_chair(school_id: str, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    await db.execute(text("SELECT pg_advisory_xact_lock(9328471)"))
    nominee = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role.in_(["faculty", "it_chair"]))))
    if not nominee: raise HTTPException(404, "Active faculty account not found")
    if not nominee.is_approved or nominee.is_deleted: raise HTTPException(409, 'Only an approved active faculty can become IT Chair')
    for chair in (await db.scalars(select(Faculty).where(Faculty.role == "it_chair"))).all(): chair.role = "faculty"
    nominee.role = 'it_chair'
    audit(db, admin, 'it_chair_assigned', school_id)
    await db.commit()
    await connections.send('role_changed', {'faculty_id': nominee.school_id})
    return {"message": f"{nominee.full_name} is now the IT Chair", "it_chair": serialize(nominee, True)}

@api.delete("/admin/it-chair")
async def remove_it_chair(db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    await db.execute(text("SELECT pg_advisory_xact_lock(9328471)"))
    chair = await db.scalar(select(Faculty).where(Faculty.role == "it_chair"))
    if not chair: raise HTTPException(404, "No IT Chair is currently assigned")
    chair.role = 'faculty'
    audit(db, admin, 'it_chair_removed', chair.school_id)
    await db.commit()
    await connections.send('role_changed', {'faculty_id': chair.school_id})
    return {"message": f"{chair.full_name} returned to normal faculty access"}

@api.delete("/admin/faculty/{school_id}")
async def delete_faculty_account(school_id: str, payload: AdminPasswordConfirmation, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    # A valid admin JWT alone is not enough for irreversible account deletion.
    if not pwd_context.verify(payload.admin_password, admin.password_hash):
        raise HTTPException(403, "Administrator password is incorrect")
    faculty = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.role.in_(["faculty", "it_chair"]))))
    if not faculty: raise HTTPException(404, "Faculty account not found")
    await lock_faculty_queue(db, faculty)
    # Keep completed consultation history for institutional reporting, but remove live account/queue data.
    await db.execute(delete(NotificationRecord).where(NotificationRecord.faculty_school_id == school_id))
    await db.execute(delete(ConsultationRequestRecord).where(ConsultationRequestRecord.faculty_school_id == school_id))
    await db.execute(delete(QueueRecord).where(QueueRecord.faculty_school_id == school_id))
    await db.execute(delete(QueueCounter).where(QueueCounter.faculty_school_id == school_id))
    for consultation in (await db.scalars(select(ConsultationRecord).where(and_(ConsultationRecord.faculty_school_id == school_id, ConsultationRecord.status.in_(['ongoing', 'scheduled']))))).all():
        consultation.status = 'cancelled'
        consultation.remarks = 'Faculty account archived by administrator'
        consultation.updated_at = now()
    if payload.delete_history:
        await db.execute(delete(ConsultationRecord).where(ConsultationRecord.faculty_school_id == school_id))
        # Receipts contain ticket/faculty metadata, so remove them with the history.
        receipts = (await db.scalars(select(SubmissionReceipt).where(SubmissionReceipt.result['faculty_school_id'].as_string() == school_id))).all()
        for receipt in receipts:
            if receipt.result.get('faculty_school_id') == school_id: await db.delete(receipt)
    faculty.is_deleted = True
    faculty.is_approved = False
    faculty.availability_status = 'unavailable'
    faculty.accepting_consultations = False
    faculty.role = 'faculty'
    if payload.delete_history:
        faculty.full_name = 'Deleted account'
        faculty.email = faculty.department = faculty.office_location = faculty.office_hours = ''
        faculty.profile_image = None
        faculty.privacy_version = None
        faculty.privacy_acknowledged_at = None
    await db.execute(delete(AuthSession).where(AuthSession.faculty_id == faculty.id))
    audit(db, admin, 'faculty_and_history_deleted' if payload.delete_history else 'faculty_archived', school_id)
    await db.commit()
    # Tell an active faculty app to clear its locally cached JWT immediately.
    await connections.send("account_deleted", {"message": "Your faculty account has been removed by an administrator."}, faculty_id=school_id)
    await connections.send("availability_changed", {"faculty_id": school_id, "status": "unavailable", "accepting_consultations": False})
    return {'message': 'Faculty account and consultation history deleted' if payload.delete_history else 'Faculty account archived; consultation records retained'}

async def purge_archive(school_id, payload, db, admin, remove_faculty):
    if not pwd_context.verify(payload.admin_password, admin.password_hash):
        raise HTTPException(403, 'Administrator password is incorrect')
    account = await db.scalar(select(Faculty).where(Faculty.school_id == school_id).with_for_update())
    if not account: raise HTTPException(404, 'Archived faculty not found')
    if not account.is_deleted or account.role == 'admin':
        raise HTTPException(409, 'Only an already archived faculty account can be cleaned up here')
    result = await db.execute(delete(ConsultationRecord).where(ConsultationRecord.faculty_school_id == school_id))
    deleted_count = result.rowcount
    await db.execute(delete(SubmissionReceipt).where(SubmissionReceipt.result['faculty_school_id'].as_string() == school_id))
    if remove_faculty:
        if not await db.get(RetiredFacultyID, school_id): db.add(RetiredFacultyID(school_id=school_id))
        await db.execute(delete(AuthSession).where(AuthSession.faculty_id == account.id))
        for model in (NotificationRecord, ConsultationRequestRecord, QueueRecord, QueueCounter):
            await db.execute(delete(model).where(model.faculty_school_id == school_id))
        await db.delete(account)
    audit(db, admin, 'archived_faculty_removed' if remove_faculty else 'archived_records_deleted', school_id)
    await db.commit()
    return {'message': 'Archived faculty and remaining consultation records removed' if remove_faculty else 'Archived consultation records removed; faculty archive retained', 'deleted_records': deleted_count}

@api.delete('/admin/archives/{school_id}/records')
async def delete_archive_records(school_id: str, payload: AdminPasswordConfirmation, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    return await purge_archive(school_id, payload, db, admin, False)

@api.delete('/admin/archives/{school_id}')
async def delete_archive_faculty(school_id: str, payload: AdminPasswordConfirmation, db: AsyncSession = Depends(session), admin: Faculty = Depends(current_admin)):
    return await purge_archive(school_id, payload, db, admin, True)

@api.get("/kiosk/faculty")
async def kiosk_faculty(db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(Faculty).where(and_(Faculty.role.in_(["faculty", "it_chair"]), Faculty.is_approved == True)).order_by(Faculty.full_name))).all()
    return [{**{key: getattr(row, key) for key in ('school_id', 'full_name', 'department', 'office_location', 'availability_status', 'accepting_consultations', 'office_hours')}, 'profile_image': public_photo(row)} for row in rows if not row.is_deleted]
@api.get("/kiosk/students/{student_id}", dependencies=[Depends(trusted_kiosk)])
async def student_lookup(student_id: str, db: AsyncSession = Depends(session)):
    row = await db.scalar(select(StudentRecord).where(StudentRecord.student_id == student_id))
    if not row: raise HTTPException(404, "Student not found")
    return {key: getattr(row, key) for key in ("student_id", "full_name", "program", "year_level", "section")}
@api.post("/kiosk/students", dependencies=[Depends(trusted_kiosk)])
async def student_create(payload: Student, db: AsyncSession = Depends(session)):
    row = await db.scalar(select(StudentRecord).where(StudentRecord.student_id == payload.student_id))
    if not row: db.add(StudentRecord(**payload.model_dump())); await db.commit()
    return {"message": "Student already registered" if row else "Student registered", "student": payload.model_dump()}
@api.post("/kiosk/consultation-request")
async def kiosk_request(payload: KioskConsultationRequest, db: AsyncSession = Depends(session)):
    if payload.consultation_type not in {'individual', 'group'} or (payload.consultation_type == 'individual' and len(payload.students) != 1): raise HTTPException(422, 'Choose individual for one student or group for multiple students')
    if len({s.student_id for s in payload.students}) != len(payload.students): raise HTTPException(422, 'Each student may only be listed once')
    payload_hash = hashlib.sha256(payload.model_dump_json(exclude={'submission_id'}).encode()).hexdigest()
    if payload.submission_id:
        try: uuid.UUID(payload.submission_id)
        except ValueError: raise HTTPException(422, 'Invalid submission identifier')
        await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': payload.submission_id})
        receipt = await db.get(SubmissionReceipt, payload.submission_id)
        if receipt:
            if receipt.payload_hash != payload_hash: raise HTTPException(409, 'This submission identifier has already been used')
            return receipt.result
    if not payload.topic.strip() or not payload.students: raise HTTPException(422, "Topic and at least one student are required")
    faculty = await db.scalar(select(Faculty).where(Faculty.school_id == payload.faculty_school_id).with_for_update())
    if not faculty: raise HTTPException(404, "Faculty not found")
    if faculty.role not in {'faculty', 'it_chair'} or not faculty.is_approved or faculty.availability_status == 'unavailable' or (faculty.availability_status == 'busy' and not faculty.accepting_consultations):
        raise HTTPException(409, 'This faculty is not accepting consultations')
    for student in sorted(payload.students, key=lambda item: item.student_id):
        await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 1))'), {'key': student.student_id})
        record = await db.scalar(select(StudentRecord).where(StudentRecord.student_id == student.student_id))
        if os.getenv('REQUIRE_STUDENT_ROSTER', 'false').lower() == 'true':
            if not record or not record.roster_verified: raise HTTPException(422, 'Student ID is not on the school roster. Please contact the administrator.')
            student.full_name = record.full_name
            student.program = record.program
        if not record: db.add(StudentRecord(**student.model_dump()))
        else:
            record.program = student.program
            record.year_level = student.year_level
            record.section = student.section
    # Closed live tickets may be removed, but numbering never resets.
    active_count = await db.scalar(select(func.count()).select_from(QueueRecord).where(and_(
        QueueRecord.faculty_school_id == faculty.school_id,
        QueueRecord.status.in_(["waiting", "serving"]),
    )))
    if not active_count:
        await db.execute(delete(QueueRecord).where(and_(
            QueueRecord.faculty_school_id == faculty.school_id,
            QueueRecord.status.in_(["completed", "cancelled"]),
        )))
    number = await db.scalar(update(GlobalQueueCounter).where(GlobalQueueCounter.id == 1).values(last_number=GlobalQueueCounter.last_number + 1).returning(GlobalQueueCounter.last_number))
    if number is None: raise HTTPException(503, 'Queue numbering is not ready. Please retry shortly.')
    names = [student.full_name for student in payload.students]; ids = [student.student_id for student in payload.students]
    queue = QueueRecord(faculty_school_id=faculty.school_id, queue_number=number, student_ids=ids, student_names=names, student_details=[student.model_dump() for student in payload.students], topic=payload.topic, consultation_type=payload.consultation_type)
    db.add(queue); await db.flush(); display = names[0] if len(names) == 1 else f"{names[0]} +{len(names)-1} more"
    db.add(ConsultationRequestRecord(faculty_school_id=faculty.school_id, student_id=",".join(ids), student_name=display, student_program=f"{payload.students[0].program} • {payload.students[0].year_level} - {payload.students[0].section}", topic=payload.topic, preferred_date=local_today(), preferred_time="Walk-in", queue_id=queue.id, queue_number=queue.queue_number, consultation_type=payload.consultation_type))
    db.add(NotificationRecord(faculty_school_id=faculty.school_id, type="new_request", title="New Kiosk Consultation Request", message=f"{display} requested consultation (Queue #{queue.queue_number})"))
    result = {'message': 'Consultation request submitted', 'queue_number': queue_label(queue.queue_number), 'queue_id': queue.id, 'faculty_school_id': faculty.school_id, 'faculty_name': faculty.full_name, 'faculty_office': faculty.office_location}
    if payload.submission_id: db.add(SubmissionReceipt(id=payload.submission_id, payload_hash=payload_hash, result=result))
    await db.commit()
    event_data = {"faculty_id": faculty.school_id, "queue_number": queue.queue_number}
    await connections.send("new_consultation_request", event_data, faculty.school_id)
    await connections.send("new_notification", event_data, faculty.school_id)
    await connections.send("queue_updated", {"faculty_id": faculty.school_id})
    return result
@api.get("/kiosk/queue/{faculty_school_id}")
async def kiosk_queue(faculty_school_id: str, db: AsyncSession = Depends(session)):
    rows = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty_school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all()
    output = [{'queue_number': row.queue_number, 'status': row.status} for row in rows]
    for item in output: item["queue_number"] = queue_label(item["queue_number"])
    return output

@api.get("/consultation-requests")
async def requests(status: Optional[str] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(ConsultationRequestRecord).where(ConsultationRequestRecord.faculty_school_id == faculty.school_id)
    if status: query = query.where(ConsultationRequestRecord.status == status)
    output = []
    # Pending consultations are served first-come, first-served. Queue numbers
    # are allocated atomically at kiosk submission, so they are the authoritative
    # order even when two requests arrive almost simultaneously.
    for row in (await db.scalars(query.order_by(ConsultationRequestRecord.queue_number.asc().nullslast(), ConsultationRequestRecord.created_at.asc(), ConsultationRequestRecord.id.asc()))).all():
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
    await lock_faculty_queue(db, faculty)
    row = await db.scalar(select(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.id == request_id, ConsultationRequestRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Request not found")
    if row.status != 'pending': raise HTTPException(409, 'This request has already been processed. Refresh your requests.')
    if payload.action == "accept":
        first_pending = await db.scalar(
            select(ConsultationRequestRecord.id)
            .where(and_(ConsultationRequestRecord.faculty_school_id == faculty.school_id, ConsultationRequestRecord.status == 'pending'))
            .order_by(ConsultationRequestRecord.queue_number.asc().nullslast(), ConsultationRequestRecord.created_at.asc(), ConsultationRequestRecord.id.asc())
            .limit(1)
        )
        if first_pending != row.id:
            raise HTTPException(409, 'Accept the first pending request before accepting a later request.')
        row.status = "accepted"
        consultation = ConsultationRecord(faculty_school_id=faculty.school_id, student_id=row.student_id, student_name=row.student_name, student_program=row.student_program, topic=row.topic, date=row.preferred_date, time=row.preferred_time, status="scheduled", queue_id=row.queue_id, queue_number=row.queue_number, consultation_type=row.consultation_type)
        if row.queue_id:
            ticket = await db.get(QueueRecord, row.queue_id)
            if ticket: consultation.students = ticket.student_details or [{'student_id': sid, 'full_name': name} for sid, name in zip(ticket.student_ids, ticket.student_names)]
        db.add(consultation)
        started = await advance_queue(db, faculty)
        if not row.queue_id and not started:
            active = await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == faculty.school_id, ConsultationRecord.status == 'ongoing')))
            waiting = await db.scalar(select(QueueRecord.id).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status == 'waiting')))
            if not active and not waiting and row.preferred_date <= local_today():
                consultation.status = 'ongoing'
                consultation.started_at = consultation.updated_at = now()
                faculty.availability_status = 'busy'
                started = consultation
        event = 'consultation_started' if started else 'consultation_accepted'
    elif payload.action == "decline":
        row.status = "declined"; row.decline_reason = payload.reason; event = "queue_updated"
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                queue.status = "cancelled"
                await reset_queue_counter_if_empty(db, faculty.school_id)
    elif payload.action == "reschedule" and payload.reschedule_date and payload.reschedule_time:
        row.status = "rescheduled"; row.preferred_date = payload.reschedule_date; row.preferred_time = payload.reschedule_time; event = "consultation_rescheduled"
        appointment = ConsultationRecord(faculty_school_id=faculty.school_id, student_id=row.student_id, student_name=row.student_name, student_program=row.student_program, topic=row.topic, date=payload.reschedule_date, time=payload.reschedule_time, status='scheduled', consultation_type=row.consultation_type)
        db.add(appointment)
        if row.queue_id:
            queue = await db.get(QueueRecord, row.queue_id)
            if queue:
                appointment.students = queue.student_details or [{'student_id': sid, 'full_name': name} for sid, name in zip(queue.student_ids, queue.student_names)]
                queue.status = "cancelled"
                await reset_queue_counter_if_empty(db, faculty.school_id)
    else: raise HTTPException(400, "Invalid action or missing reschedule details")
    if payload.action != 'accept': await advance_queue(db, faculty)
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
    return {"message": f"Request {payload.action}ed", "status": row.status, "consultation_status": consultation.status if payload.action == 'accept' else None}

@api.get("/consultations")
async def consultations(status: Optional[str] = None, search: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(ConsultationRecord).where(ConsultationRecord.faculty_school_id == faculty.school_id)
    if status: query = query.where(ConsultationRecord.status == status)
    if search: query = query.where(or_(ConsultationRecord.student_name.ilike(f"%{search}%"), ConsultationRecord.student_id.ilike(f"%{search}%"), ConsultationRecord.topic.ilike(f"%{search}%")))
    if date_from: query = query.where(ConsultationRecord.date >= date_from)
    if date_to: query = query.where(ConsultationRecord.date <= date_to)
    return [serialize(row) for row in (await db.scalars(query.order_by(ConsultationRecord.date.desc(), ConsultationRecord.id).offset(offset).limit(limit))).all()]
@api.get("/consultations/{consultation_id}")
async def consultation_detail(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    return serialize(row)
@api.patch("/consultations/{consultation_id}")
async def consultation_update(consultation_id: str, payload: ConsultationUpdate, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    await lock_faculty_queue(db, faculty)
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be edited")
    if payload.status is not None:
        raise HTTPException(422, "Use the session actions to change consultation status")
    if payload.duration is not None: raise HTTPException(422, 'Session duration is calculated by the server')
    for key, value in payload.model_dump(exclude_none=True).items(): setattr(row, key, value)
    row.updated_at = now(); await db.commit(); return serialize(row)
@api.post("/consultations/{consultation_id}/start")
async def consultation_start(consultation_id: str, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    await lock_faculty_queue(db, faculty)
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be started")
    if row.status == "ongoing":
        return {"message": "Consultation is already ongoing", "status": "ongoing"}
    if row.status != "scheduled":
        raise HTTPException(409, "Only scheduled consultations can be started")
    if row.date > local_today(): raise HTTPException(409, 'This appointment is scheduled for a future date')
    if await db.scalar(select(ConsultationRecord.id).where(and_(ConsultationRecord.faculty_school_id == faculty.school_id, ConsultationRecord.status == 'ongoing'))):
        raise HTTPException(409, 'Complete the current session before starting another')
    head = await db.scalar(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status == 'waiting')).order_by(QueueRecord.queue_number).limit(1))
    if head and head.id != row.queue_id:
        raise HTTPException(409, 'Please serve the first student in the queue before this consultation')
    if row.queue_id:
        linked_queue = await db.get(QueueRecord, row.queue_id)
        if not linked_queue or linked_queue.status != 'waiting':
            raise HTTPException(409, 'This queue ticket is no longer waiting')
    row.status = "ongoing"; row.started_at = row.updated_at = now(); faculty.availability_status = "busy"
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue: queue.status = "serving"
    await db.commit()
    for event in ("consultation_started", "queue_updated", "availability_changed"): await connections.send(event, {"faculty_id": faculty.school_id})
    return {"message": "Consultation started", "status": "ongoing"}
@api.post("/consultations/{consultation_id}/complete")
async def consultation_complete(consultation_id: str, payload: Optional[ConsultationComplete] = None, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    await lock_faculty_queue(db, faculty)
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, "Consultation not found")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "Completed or cancelled consultations cannot be completed again")
    if row.status != "ongoing":
        raise HTTPException(409, "Start the consultation before completing it")
    if payload and payload.notes is not None: row.notes = payload.notes
    row.duration = max(1, int((now() - (row.started_at or row.updated_at)).total_seconds() / 60)); row.status = "completed"; row.updated_at = now()
    if row.queue_id:
        queue = await db.get(QueueRecord, row.queue_id)
        if queue:
            queue.status = "completed"
            await reset_queue_counter_if_empty(db, faculty.school_id)
    next_session = await advance_queue(db, faculty) if payload is None or payload.advance else None
    if not next_session: faculty.availability_status = 'unavailable' if payload and not payload.advance else 'available'
    await db.commit()
    for event in ("consultation_completed", "queue_updated", "availability_changed"): await connections.send(event, {"faculty_id": faculty.school_id})
    return {"message": "Consultation completed", "duration_minutes": row.duration, "next_started": bool(next_session)}

@api.post('/consultations/{consultation_id}/cancel')
async def consultation_cancel(consultation_id: str, payload: ConsultationCancel, db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    await lock_faculty_queue(db, faculty)
    row = await db.scalar(select(ConsultationRecord).where(and_(ConsultationRecord.id == consultation_id, ConsultationRecord.faculty_school_id == faculty.school_id)))
    if not row: raise HTTPException(404, 'Consultation not found')
    if row.status not in {'scheduled', 'ongoing'}: raise HTTPException(409, 'This consultation is already closed')
    active = row.status == 'ongoing'
    row.status = 'cancelled'
    row.remarks = payload.reason
    row.updated_at = now()
    if row.queue_id and (ticket := await db.get(QueueRecord, row.queue_id)): ticket.status = 'cancelled'
    await db.flush()
    next_session = await advance_queue(db, faculty)
    if active and not next_session: faculty.availability_status = 'available'
    await reset_queue_counter_if_empty(db, faculty.school_id)
    audit(db, faculty, 'consultation_cancelled', consultation_id)
    await db.commit()
    for event in ('queue_updated', 'consultation_completed', 'availability_changed'): await connections.send(event, {'faculty_id': faculty.school_id})
    return {'message': 'Consultation cancelled', 'next_started': bool(next_session)}

@api.get("/dashboard/stats")
async def dashboard_stats(db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    today = local_today()
    month_prefix = today[:7]
    scope = ConsultationRecord.faculty_school_id == faculty.school_id
    today_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(scope, ConsultationRecord.date == today, ConsultationRecord.status == 'completed')))
    pending_requests = await db.scalar(select(func.count()).select_from(ConsultationRequestRecord).where(and_(ConsultationRequestRecord.faculty_school_id == faculty.school_id, ConsultationRequestRecord.status == "pending")))
    monthly_count = await db.scalar(select(func.count()).select_from(ConsultationRecord).where(and_(scope, ConsultationRecord.date.like(f"{month_prefix}%"), ConsultationRecord.status == 'completed')))
    upcoming = (await db.scalars(select(ConsultationRecord).where(and_(scope, or_(ConsultationRecord.status == 'ongoing', and_(ConsultationRecord.status == 'scheduled', ConsultationRecord.date >= today)))).order_by(ConsultationRecord.date, ConsultationRecord.time).limit(5))).all()
    return {"today_count": today_count or 0, "pending_requests": pending_requests or 0, "monthly_count": monthly_count or 0, "availability_status": faculty.availability_status, "accepting_consultations": faculty.accepting_consultations, "upcoming_consultations": [serialize(row) for row in upcoming]}

@api.get("/notifications")
async def notifications(unread_only: bool = False, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(session), faculty: Faculty = Depends(current_faculty)):
    query = select(NotificationRecord).where(NotificationRecord.faculty_school_id == faculty.school_id)
    if unread_only: query = query.where(NotificationRecord.read == False)
    return [serialize(row) for row in (await db.scalars(query.order_by(NotificationRecord.created_at.desc(), NotificationRecord.id).offset(offset).limit(limit))).all()]

@api.get('/public/faculty/{school_id}/photo')
async def faculty_photo(school_id: str, request: Request, db: AsyncSession = Depends(session)):
    account = await db.scalar(select(Faculty).where(and_(Faculty.school_id == school_id, Faculty.is_approved == True, Faculty.is_deleted == False)))
    if not account or not account.profile_image: raise HTTPException(404, 'Photo not found')
    try: data, mime = decode_photo(account.profile_image, enforce_size=False)
    except ValueError: raise HTTPException(404, 'Photo unavailable')
    etag = '"' + hashlib.sha256(data).hexdigest() + '"'
    headers = {'ETag': etag, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'}
    if request.headers.get('if-none-match') == etag: return Response(status_code=304, headers=headers)
    return Response(data, media_type=mime, headers=headers)

def public_photo(account):
    if not account.profile_image: return None
    version = hashlib.sha256(account.profile_image.encode()).hexdigest()[:12]
    return f'/api/public/faculty/{account.school_id}/photo?v={version}'
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
    for faculty in (await db.scalars(select(Faculty).where(and_(Faculty.role.in_(["faculty", "it_chair"]), Faculty.is_approved == True, Faculty.is_deleted == False)).order_by(Faculty.full_name))).all():
        queue = (await db.scalars(select(QueueRecord).where(and_(QueueRecord.faculty_school_id == faculty.school_id, QueueRecord.status.in_(["waiting", "serving"]))).order_by(QueueRecord.queue_number))).all(); serving = next((item for item in queue if item.status == "serving"), None); waiting = [item for item in queue if item.status == "waiting"]
        output.append({"school_id": faculty.school_id, "full_name": faculty.full_name, "department": faculty.department, "office_location": faculty.office_location, "profile_image": public_photo(faculty), "availability_status": faculty.availability_status, "now_serving": {"queue_id": serving.id, "queue_number": queue_label(serving.queue_number)} if serving else None, "waiting_count": len(waiting), "next_queue_numbers": [queue_label(item.queue_number) for item in waiting]})
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
