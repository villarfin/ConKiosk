from fastapi import FastAPI, APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
import socketio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Production configuration must be explicit; never fall back to a shared secret.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
mongo_url = os.getenv("MONGO_URL")
db_name = os.getenv("DB_NAME")
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not mongo_url or not db_name or not SECRET_KEY:
    raise RuntimeError("MONGO_URL, DB_NAME, and JWT_SECRET_KEY must be set in backend/.env")

cors_origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081"
).split(",") if origin.strip()]
if ENVIRONMENT == "production" and "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS cannot use '*' in production")
ALLOW_SEED_DATA = os.getenv("ALLOW_SEED_DATA", "false").lower() == "true"

# MongoDB connection
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

security = HTTPBearer()

# Create FastAPI app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Socket.IO setup
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=cors_origins)
socket_app = socketio.ASGIApp(sio, app)

# ==================== Models ====================

class LoginRequest(BaseModel):
    school_id: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    faculty: dict

class FacultyProfile(BaseModel):
    school_id: str
    full_name: str
    department: str
    office_location: str
    email: str
    profile_image: Optional[str] = None  # base64
    availability_status: str = "unavailable"  # available, busy, unavailable
    office_hours: Optional[str] = None

class FacultyProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    office_location: Optional[str] = None
    email: Optional[str] = None
    profile_image: Optional[str] = None
    office_hours: Optional[str] = None

class AvailabilityUpdate(BaseModel):
    status: str  # available, busy, unavailable

class ConsultationRequest(BaseModel):
    student_id: str
    student_name: str
    student_program: str
    topic: str
    preferred_date: str
    preferred_time: str
    status: str = "pending"  # pending, accepted, declined, completed, cancelled
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ConsultationAction(BaseModel):
    action: str  # accept, decline, reschedule
    reschedule_date: Optional[str] = None
    reschedule_time: Optional[str] = None
    reason: Optional[str] = None

class Consultation(BaseModel):
    faculty_school_id: str
    student_id: str
    student_name: str
    student_program: str
    topic: str
    date: str
    time: str
    duration: Optional[int] = None  # minutes
    status: str  # scheduled, ongoing, completed, cancelled
    notes: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ConsultationUpdate(BaseModel):
    notes: Optional[str] = None
    remarks: Optional[str] = None
    status: Optional[str] = None
    duration: Optional[int] = None

class Notification(BaseModel):
    faculty_school_id: str
    type: str  # new_request, accepted, cancelled, rescheduled, reminder, system
    title: str
    message: str
    read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

# ==================== Kiosk & Queue Models ====================

class Student(BaseModel):
    student_id: str
    full_name: str
    # Kept optional for older kiosk clients; the current kiosk requires it.
    program: str = ""
    year_level: str
    section: str

class KioskConsultationRequest(BaseModel):
    faculty_school_id: str
    topic: str
    consultation_type: str = "individual"  # individual or group
    students: List[Student]  # 1 for individual, multiple for group

class ConsultationStartRequest(BaseModel):
    consultation_id: Optional[str] = None
    queue_id: Optional[str] = None

class QueueEntry(BaseModel):
    faculty_school_id: str
    queue_number: int
    student_ids: List[str]
    student_names: List[str]
    topic: str
    consultation_type: str
    status: str = "waiting"  # waiting, serving, completed, cancelled
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ==================== Helper Functions ====================

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_faculty(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        school_id: str = payload.get("sub")
        if school_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    faculty = await db.faculty.find_one({"school_id": school_id})
    if faculty is None:
        raise HTTPException(status_code=401, detail="Faculty not found")
    
    return faculty

def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict"""
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc

# ==================== Socket.IO Events ====================

@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

@sio.event
async def join_faculty_room(sid, data):
    """Faculty joins their personal room for notifications"""
    school_id = data.get('school_id')
    if school_id:
        await sio.enter_room(sid, f"faculty_{school_id}")
        logger.info(f"Faculty {school_id} joined room")

# ==================== Authentication Routes ====================

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    faculty = await db.faculty.find_one({"school_id": request.school_id})
    
    if not faculty or not verify_password(request.password, faculty["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect school ID or password"
        )
    
    access_token = create_access_token(data={"sub": faculty["school_id"]})
    
    # Remove sensitive data
    faculty_data = serialize_doc(faculty)
    del faculty_data["password_hash"]
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "faculty": faculty_data
    }

@api_router.post("/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    faculty = Depends(get_current_faculty)
):
    if not verify_password(request.current_password, faculty["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    new_hash = get_password_hash(request.new_password)
    await db.faculty.update_one(
        {"school_id": faculty["school_id"]},
        {"$set": {"password_hash": new_hash}}
    )
    
    return {"message": "Password changed successfully"}

# ==================== Faculty Profile Routes ====================

@api_router.get("/faculty/profile")
async def get_profile(faculty = Depends(get_current_faculty)):
    faculty_data = serialize_doc(faculty)
    del faculty_data["password_hash"]
    return faculty_data

@api_router.patch("/faculty/profile")
async def update_profile(
    update: FacultyProfileUpdate,
    faculty = Depends(get_current_faculty)
):
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    
    if update_data:
        await db.faculty.update_one(
            {"school_id": faculty["school_id"]},
            {"$set": update_data}
        )
    
    updated_faculty = await db.faculty.find_one({"school_id": faculty["school_id"]})
    faculty_data = serialize_doc(updated_faculty)
    del faculty_data["password_hash"]
    
    return faculty_data

@api_router.patch("/faculty/availability")
async def update_availability(
    update: AvailabilityUpdate,
    faculty = Depends(get_current_faculty)
):
    await db.faculty.update_one(
        {"school_id": faculty["school_id"]},
        {"$set": {"availability_status": update.status}}
    )
    
    # Notify via Socket.IO
    await sio.emit('availability_changed', {
        'faculty_id': faculty["school_id"],
        'status': update.status
    })
    
    return {"message": "Availability updated", "status": update.status}

# ==================== Dashboard Routes ====================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(faculty = Depends(get_current_faculty)):
    school_id = faculty["school_id"]
    today = datetime.utcnow().date().isoformat()
    
    # Today's consultations
    today_consultations = await db.consultations.count_documents({
        "faculty_school_id": school_id,
        "date": today
    })
    
    # Pending requests
    pending_requests = await db.consultation_requests.count_documents({
        "faculty_school_id": school_id,
        "status": "pending"
    })
    
    # Upcoming consultations (today and future)
    upcoming_consultations = await db.consultations.find({
        "faculty_school_id": school_id,
        "status": {"$in": ["scheduled", "ongoing"]},
        "date": {"$gte": today}
    }).sort("date", 1).limit(5).to_list(5)
    
    # Recent activity
    recent_activity = await db.consultations.find({
        "faculty_school_id": school_id
    }).sort("updated_at", -1).limit(5).to_list(5)
    
    # This month's count
    current_month = datetime.utcnow().strftime("%Y-%m")
    monthly_count = await db.consultations.count_documents({
        "faculty_school_id": school_id,
        "date": {"$regex": f"^{current_month}"}
    })
    
    return {
        "today_count": today_consultations,
        "pending_requests": pending_requests,
        "upcoming_consultations": [serialize_doc(c) for c in upcoming_consultations],
        "recent_activity": [serialize_doc(c) for c in recent_activity],
        "monthly_count": monthly_count,
        "availability_status": faculty.get("availability_status", "unavailable")
    }

# ==================== Consultation Requests Routes ====================

@api_router.get("/consultation-requests")
async def get_consultation_requests(
    status: Optional[str] = None,
    faculty = Depends(get_current_faculty)
):
    query = {"faculty_school_id": faculty["school_id"]}
    if status:
        query["status"] = status
    
    requests = await db.consultation_requests.find(query).sort("created_at", -1).to_list(100)
    return [serialize_doc(r) for r in requests]

@api_router.get("/consultation-requests/{request_id}")
async def get_consultation_request(
    request_id: str,
    faculty = Depends(get_current_faculty)
):
    obj_id = safe_object_id(request_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    request = await db.consultation_requests.find_one({
        "_id": obj_id,
        "faculty_school_id": faculty["school_id"]
    })

    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    return serialize_doc(request)

@api_router.post("/consultation-requests/{request_id}/action")
async def handle_consultation_request(
    request_id: str,
    action: ConsultationAction,
    faculty = Depends(get_current_faculty)
):
    obj_id = safe_object_id(request_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid request ID")

    request = await db.consultation_requests.find_one({
        "_id": obj_id,
        "faculty_school_id": faculty["school_id"]
    })

    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    if action.action == "accept":
        # Update request status
        await db.consultation_requests.update_one(
            {"_id": obj_id},
            {"$set": {"status": "accepted"}}
        )

        # Create consultation record - carry over queue fields for kiosk-originated requests
        consultation = {
            "faculty_school_id": faculty["school_id"],
            "student_id": request["student_id"],
            "student_name": request["student_name"],
            "student_program": request["student_program"],
            "topic": request["topic"],
            "date": request["preferred_date"],
            "time": request["preferred_time"],
            "status": "scheduled",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        # Preserve queue linkage if this request came from the kiosk
        if request.get("queue_id"):
            consultation["queue_id"] = request["queue_id"]
        if request.get("queue_number") is not None:
            consultation["queue_number"] = request["queue_number"]
        if request.get("consultation_type"):
            consultation["consultation_type"] = request["consultation_type"]

        await db.consultations.insert_one(consultation)

        # Create notification
        notification = {
            "faculty_school_id": faculty["school_id"],
            "type": "accepted",
            "title": "Request Accepted",
            "message": f"You accepted consultation request from {request['student_name']}",
            "read": False,
            "created_at": datetime.utcnow()
        }
        await db.notifications.insert_one(notification)

        # Emit real-time event
        await sio.emit('consultation_accepted', {
            'request_id': request_id,
            'student_id': request["student_id"]
        }, room=f"faculty_{faculty['school_id']}")

        return {"message": "Request accepted", "status": "accepted"}

    elif action.action == "decline":
        await db.consultation_requests.update_one(
            {"_id": obj_id},
            {"$set": {"status": "declined", "decline_reason": action.reason}}
        )

        # If this was a kiosk request with a queue entry, cancel it and notify
        if request.get("queue_id"):
            q_obj_id = safe_object_id(request["queue_id"])
            if q_obj_id:
                await db.queue.update_one(
                    {"_id": q_obj_id},
                    {"$set": {"status": "cancelled"}}
                )
                await sio.emit('queue_updated', {'faculty_id': faculty["school_id"]})

        # Create notification
        notification = {
            "faculty_school_id": faculty["school_id"],
            "type": "declined",
            "title": "Request Declined",
            "message": f"You declined consultation request from {request['student_name']}",
            "read": False,
            "created_at": datetime.utcnow()
        }
        await db.notifications.insert_one(notification)

        return {"message": "Request declined", "status": "declined"}

    elif action.action == "reschedule":
        if not action.reschedule_date or not action.reschedule_time:
            raise HTTPException(status_code=400, detail="Reschedule date and time required")

        await db.consultation_requests.update_one(
            {"_id": obj_id},
            {"$set": {
                "status": "rescheduled",
                "preferred_date": action.reschedule_date,
                "preferred_time": action.reschedule_time
            }}
        )

        return {"message": "Request rescheduled", "status": "rescheduled"}

    else:
        raise HTTPException(status_code=400, detail="Invalid action")

# ==================== Consultations History Routes ====================

@api_router.get("/consultations")
async def get_consultations(
    status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    faculty = Depends(get_current_faculty)
):
    query = {"faculty_school_id": faculty["school_id"]}
    
    if status:
        query["status"] = status
    
    if search:
        query["$or"] = [
            {"student_name": {"$regex": search, "$options": "i"}},
            {"student_id": {"$regex": search, "$options": "i"}},
            {"topic": {"$regex": search, "$options": "i"}}
        ]
    
    if date_from:
        query["date"] = {"$gte": date_from}
    
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    consultations = await db.consultations.find(query).sort("date", -1).to_list(100)
    return [serialize_doc(c) for c in consultations]

@api_router.get("/consultations/{consultation_id}")
async def get_consultation(
    consultation_id: str,
    faculty = Depends(get_current_faculty)
):
    obj_id = safe_object_id(consultation_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid consultation ID")
    consultation = await db.consultations.find_one({
        "_id": obj_id,
        "faculty_school_id": faculty["school_id"]
    })

    if not consultation:
        raise HTTPException(status_code=404, detail="Consultation not found")

    return serialize_doc(consultation)

@api_router.patch("/consultations/{consultation_id}")
async def update_consultation(
    consultation_id: str,
    update: ConsultationUpdate,
    faculty = Depends(get_current_faculty)
):
    obj_id = safe_object_id(consultation_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid consultation ID")

    update_data = {k: v for k, v in update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()

    result = await db.consultations.update_one(
        {"_id": obj_id, "faculty_school_id": faculty["school_id"]},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Consultation not found")

    updated = await db.consultations.find_one({"_id": obj_id})
    return serialize_doc(updated)

# ==================== Notifications Routes ====================

@api_router.get("/notifications")
async def get_notifications(
    unread_only: bool = False,
    faculty = Depends(get_current_faculty)
):
    query = {"faculty_school_id": faculty["school_id"]}
    if unread_only:
        query["read"] = False
    
    notifications = await db.notifications.find(query).sort("created_at", -1).to_list(100)
    return [serialize_doc(n) for n in notifications]

@api_router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    faculty = Depends(get_current_faculty)
):
    obj_id = safe_object_id(notification_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    result = await db.notifications.update_one(
        {"_id": obj_id, "faculty_school_id": faculty["school_id"]},
        {"$set": {"read": True}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"message": "Notification marked as read"}

@api_router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(faculty = Depends(get_current_faculty)):
    await db.notifications.update_many(
        {"faculty_school_id": faculty["school_id"], "read": False},
        {"$set": {"read": True}}
    )
    
    return {"message": "All notifications marked as read"}

# ==================== Kiosk / Public Routes (no auth) ====================

def safe_object_id(id_str: str):
    """Safely convert string to ObjectId. Returns None if invalid."""
    from bson.objectid import ObjectId
    from bson.errors import InvalidId
    try:
        return ObjectId(id_str)
    except (InvalidId, TypeError):
        return None

@api_router.get("/kiosk/faculty")
async def get_kiosk_faculty():
    """Public endpoint - list all faculty with availability for kiosk display"""
    faculty_list = await db.faculty.find({}).to_list(100)
    result = []
    for f in faculty_list:
        result.append({
            "school_id": f["school_id"],
            "full_name": f["full_name"],
            "department": f["department"],
            "office_location": f.get("office_location", ""),
            "profile_image": f.get("profile_image"),
            "availability_status": f.get("availability_status", "unavailable"),
            "office_hours": f.get("office_hours", "")
        })
    return result

@api_router.get("/kiosk/students/{student_id}")
async def lookup_student(student_id: str):
    """Lookup student by school ID (from QR or manual entry)"""
    student = await db.students.find_one({"student_id": student_id})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return {
        "student_id": student["student_id"],
        "full_name": student["full_name"],
        "program": student.get("program", student.get("section", "").split("-")[0]),
        "year_level": student["year_level"],
        "section": student["section"]
    }

@api_router.post("/kiosk/students")
async def upsert_student(student: Student):
    """Register a new student without allowing a kiosk to overwrite existing records."""
    try:
        await db.students.insert_one(student.dict())
        return {"message": "Student registered", "student": student.dict()}
    except DuplicateKeyError:
        # Existing records are intentionally never changed from a public kiosk.
        return {"message": "Student already registered", "student": student.dict()}

@api_router.post("/kiosk/consultation-request")
async def submit_kiosk_request(request: KioskConsultationRequest):
    """Submit a consultation request from the kiosk. Creates queue entry."""
    if not request.topic.strip():
        raise HTTPException(status_code=422, detail="Consultation topic is required")
    if not request.students:
        raise HTTPException(status_code=422, detail="At least one student is required")
    for student in request.students:
        if not all((student.student_id.strip(), student.full_name.strip(), student.program.strip(),
                    student.year_level.strip(), student.section.strip())):
            raise HTTPException(status_code=422, detail="Student ID, name, program, year level, and section are required")

    # Verify faculty exists
    faculty = await db.faculty.find_one({"school_id": request.faculty_school_id})
    if not faculty:
        raise HTTPException(status_code=404, detail="Faculty not found")

    # Save all students
    for student in request.students:
        existing = await db.students.find_one({"student_id": student.student_id})
        if not existing:
            try:
                await db.students.insert_one(student.dict())
            except DuplicateKeyError:
                # Another request registered the student first; retain that record.
                pass

    # Atomically allocate one ticket for this faculty. This remains safe even if
    # a future deployment adds more than one kiosk or retries a submission.
    counter = await db.queue_counters.find_one_and_update(
        {"faculty_school_id": request.faculty_school_id},
        {"$inc": {"last_number": 1}, "$setOnInsert": {"created_at": datetime.utcnow()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    next_number = counter["last_number"]

    # Determine names for display
    student_ids = [s.student_id for s in request.students]
    student_names = [s.full_name for s in request.students]
    display_name = student_names[0] if len(student_names) == 1 else f"{student_names[0]} +{len(student_names)-1} more"

    # Create queue entry
    queue_entry = {
        "faculty_school_id": request.faculty_school_id,
        "queue_number": next_number,
        "student_ids": student_ids,
        "student_names": student_names,
        "topic": request.topic,
        "consultation_type": request.consultation_type,
        "status": "waiting",
        "created_at": datetime.utcnow()
    }
    queue_result = await db.queue.insert_one(queue_entry)
    queue_id = str(queue_result.inserted_id)

    # Create consultation request for faculty mobile app
    consultation_request = {
        "faculty_school_id": request.faculty_school_id,
        "student_id": ",".join(student_ids),
        "student_name": display_name,
            "student_program": " • ".join(filter(None, [
                request.students[0].program,
                f"{request.students[0].year_level} - {request.students[0].section}",
            ])),
        "topic": request.topic,
        "preferred_date": datetime.utcnow().date().isoformat(),
        "preferred_time": "Walk-in",
        "status": "pending",
        "queue_id": queue_id,
        "queue_number": next_number,
        "consultation_type": request.consultation_type,
        "created_at": datetime.utcnow()
    }
    await db.consultation_requests.insert_one(consultation_request)

    # Create notification for faculty
    notification = {
        "faculty_school_id": request.faculty_school_id,
        "type": "new_request",
        "title": "New Kiosk Consultation Request",
        "message": f"{display_name} requested consultation (Queue #{next_number})",
        "read": False,
        "created_at": datetime.utcnow()
    }
    await db.notifications.insert_one(notification)

    # Emit real-time events
    await sio.emit('new_consultation_request', {
        'faculty_id': request.faculty_school_id,
        'queue_number': next_number,
        'student_name': display_name
    })
    await sio.emit('queue_updated', {'faculty_id': request.faculty_school_id})

    return {
        "message": "Consultation request submitted",
        "queue_number": next_number,
        "queue_id": queue_id,
        "faculty_name": faculty["full_name"],
        "faculty_office": faculty.get("office_location", "")
    }

@api_router.get("/kiosk/queue/{faculty_school_id}")
async def get_faculty_queue(faculty_school_id: str):
    """Get current queue for a specific faculty"""
    queue = await db.queue.find(
        {"faculty_school_id": faculty_school_id, "status": {"$in": ["waiting", "serving"]}}
    ).sort("queue_number", 1).to_list(100)
    return [serialize_doc(q) for q in queue]

# ==================== TV Display Routes ====================

@api_router.get("/tv-display/status")
async def get_tv_display_data():
    """Get complete status board for TV display - all faculty + their queues"""
    faculty_list = await db.faculty.find({}).to_list(100)
    result = []
    for f in faculty_list:
        # Get active queue for this faculty
        queue = await db.queue.find(
            {"faculty_school_id": f["school_id"], "status": {"$in": ["waiting", "serving"]}}
        ).sort("queue_number", 1).to_list(20)

        now_serving = next((q for q in queue if q["status"] == "serving"), None)
        waiting = [q for q in queue if q["status"] == "waiting"]

        result.append({
            "school_id": f["school_id"],
            "full_name": f["full_name"],
            "department": f["department"],
            "office_location": f.get("office_location", ""),
            "availability_status": f.get("availability_status", "unavailable"),
            "now_serving": {
                "queue_number": now_serving["queue_number"],
                "student_names": now_serving["student_names"],
                "topic": now_serving["topic"]
            } if now_serving else None,
            "waiting_count": len(waiting),
            "next_queue_numbers": [q["queue_number"] for q in waiting[:5]]
        })
    return result

# ==================== Faculty Consultation Actions (Start/Complete) ====================

@api_router.post("/consultations/{consultation_id}/start")
async def start_consultation(
    consultation_id: str,
    faculty = Depends(get_current_faculty)
):
    """Faculty starts consultation - marks queue as serving, auto-sets Busy status"""
    obj_id = safe_object_id(consultation_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid consultation ID")

    consultation = await db.consultations.find_one({
        "_id": obj_id,
        "faculty_school_id": faculty["school_id"]
    })
    if not consultation:
        raise HTTPException(status_code=404, detail="Consultation not found")

    # Update consultation status
    await db.consultations.update_one(
        {"_id": obj_id},
        {"$set": {"status": "ongoing", "updated_at": datetime.utcnow()}}
    )

    # Update queue entry if linked
    if consultation.get("queue_id"):
        q_obj_id = safe_object_id(consultation["queue_id"])
        if q_obj_id:
            await db.queue.update_one(
                {"_id": q_obj_id},
                {"$set": {"status": "serving"}}
            )

    # Auto-set faculty to busy
    await db.faculty.update_one(
        {"school_id": faculty["school_id"]},
        {"$set": {"availability_status": "busy"}}
    )

    await sio.emit('consultation_started', {'faculty_id': faculty["school_id"]})
    await sio.emit('queue_updated', {'faculty_id': faculty["school_id"]})
    await sio.emit('availability_changed', {
        'faculty_id': faculty["school_id"],
        'status': 'busy'
    })

    return {"message": "Consultation started", "status": "ongoing"}

@api_router.post("/consultations/{consultation_id}/complete")
async def complete_consultation(
    consultation_id: str,
    faculty = Depends(get_current_faculty)
):
    """Complete consultation - marks queue completed, sets faculty back to available"""
    obj_id = safe_object_id(consultation_id)
    if not obj_id:
        raise HTTPException(status_code=400, detail="Invalid consultation ID")

    consultation = await db.consultations.find_one({
        "_id": obj_id,
        "faculty_school_id": faculty["school_id"]
    })
    if not consultation:
        raise HTTPException(status_code=404, detail="Consultation not found")

    # Compute duration if we have start times
    duration = None
    if consultation.get("updated_at"):
        try:
            delta = datetime.utcnow() - consultation["updated_at"]
            duration = max(1, int(delta.total_seconds() / 60))
        except Exception:
            duration = None

    update = {"status": "completed", "updated_at": datetime.utcnow()}
    if duration:
        update["duration"] = duration

    await db.consultations.update_one({"_id": obj_id}, {"$set": update})

    # Complete queue entry
    if consultation.get("queue_id"):
        q_obj_id = safe_object_id(consultation["queue_id"])
        if q_obj_id:
            await db.queue.update_one(
                {"_id": q_obj_id},
                {"$set": {"status": "completed"}}
            )

    # Auto-set faculty back to available
    await db.faculty.update_one(
        {"school_id": faculty["school_id"]},
        {"$set": {"availability_status": "available"}}
    )

    await sio.emit('consultation_completed', {'faculty_id': faculty["school_id"]})
    await sio.emit('queue_updated', {'faculty_id': faculty["school_id"]})
    await sio.emit('availability_changed', {
        'faculty_id': faculty["school_id"],
        'status': 'available'
    })

    return {"message": "Consultation completed", "duration_minutes": duration}

# ==================== Seed Data (For Testing) ====================

@api_router.post("/seed")
async def seed_database():
    """Seed the database with test data - 6 faculty, students, requests, queue entries"""
    if not ALLOW_SEED_DATA:
        raise HTTPException(status_code=403, detail="Demo seeding is disabled")

    # Clear existing data
    await db.faculty.delete_many({})
    await db.consultation_requests.delete_many({})
    await db.consultations.delete_many({})
    await db.notifications.delete_many({})
    await db.students.delete_many({})
    await db.queue.delete_many({})
    await db.queue_counters.delete_many({})

    # Create multiple faculty with different statuses
    faculty_list = [
        {
            "school_id": "FAC2024001",
            "password_hash": get_password_hash("password123"),
            "full_name": "Dr. Maria Santos",
            "department": "Computer Science",
            "office_location": "Room 301, Science Building",
            "email": "maria.santos@university.edu",
            "availability_status": "available",
            "office_hours": "Mon-Fri 9:00 AM - 5:00 PM"
        },
        {
            "school_id": "FAC2024002",
            "password_hash": get_password_hash("password123"),
            "full_name": "Prof. Juan Reyes",
            "department": "Information Technology",
            "office_location": "Room 305, Science Building",
            "email": "juan.reyes@university.edu",
            "availability_status": "busy",
            "office_hours": "Mon-Fri 8:00 AM - 4:00 PM"
        },
        {
            "school_id": "FAC2024003",
            "password_hash": get_password_hash("password123"),
            "full_name": "Dr. Elena Cruz",
            "department": "Mathematics",
            "office_location": "Room 210, Academic Building",
            "email": "elena.cruz@university.edu",
            "availability_status": "available",
            "office_hours": "Mon-Wed-Fri 10:00 AM - 3:00 PM"
        },
        {
            "school_id": "FAC2024004",
            "password_hash": get_password_hash("password123"),
            "full_name": "Prof. Antonio Villar",
            "department": "Engineering",
            "office_location": "Room 501, Engineering Building",
            "email": "antonio.villar@university.edu",
            "availability_status": "unavailable",
            "office_hours": "Tue-Thu 1:00 PM - 5:00 PM"
        },
        {
            "school_id": "FAC2024005",
            "password_hash": get_password_hash("password123"),
            "full_name": "Dr. Sofia Mendoza",
            "department": "Business Administration",
            "office_location": "Room 402, Business Building",
            "email": "sofia.mendoza@university.edu",
            "availability_status": "available",
            "office_hours": "Mon-Fri 9:00 AM - 4:00 PM"
        },
        {
            "school_id": "FAC2024006",
            "password_hash": get_password_hash("password123"),
            "full_name": "Prof. Roberto Lim",
            "department": "Computer Science",
            "office_location": "Room 303, Science Building",
            "email": "roberto.lim@university.edu",
            "availability_status": "busy",
            "office_hours": "Mon-Fri 10:00 AM - 6:00 PM"
        }
    ]
    await db.faculty.insert_many(faculty_list)

    # Create sample students
    students = [
        {"student_id": "STU2024101", "full_name": "John Dela Cruz", "program": "BSCS", "year_level": "4th Year", "section": "BSCS-4A"},
        {"student_id": "STU2024102", "full_name": "Sarah Reyes", "program": "BSIT", "year_level": "3rd Year", "section": "BSIT-3B"},
        {"student_id": "STU2024103", "full_name": "Miguel Torres", "program": "BSCS", "year_level": "4th Year", "section": "BSCS-4A"},
        {"student_id": "STU2024104", "full_name": "Anna Garcia", "program": "BSCS", "year_level": "4th Year", "section": "BSCS-4B"},
        {"student_id": "STU2024105", "full_name": "Carlos Ramos", "program": "BSIT", "year_level": "2nd Year", "section": "BSIT-2A"},
        {"student_id": "STU2024106", "full_name": "Lucia Fernandez", "program": "BSCS", "year_level": "3rd Year", "section": "BSCS-3A"},
        {"student_id": "STU2024107", "full_name": "Diego Morales", "program": "BSIT", "year_level": "1st Year", "section": "BSIT-1B"},
        {"student_id": "STU2024108", "full_name": "Isabella Cruz", "program": "BSBA", "year_level": "4th Year", "section": "BSBA-4A"}
    ]
    await db.students.insert_many(students)

    # Create sample consultation requests (pending in the mobile app)
    requests = [
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024101",
            "student_name": "John Dela Cruz",
            "student_program": "4th Year - BSCS-4A",
            "topic": "Thesis consultation - AI Research",
            "preferred_date": (datetime.utcnow() + timedelta(days=1)).date().isoformat(),
            "preferred_time": "10:00 AM",
            "status": "pending",
            "created_at": datetime.utcnow()
        },
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024102",
            "student_name": "Sarah Reyes",
            "student_program": "3rd Year - BSIT-3B",
            "topic": "Academic advising - Course selection",
            "preferred_date": (datetime.utcnow() + timedelta(days=2)).date().isoformat(),
            "preferred_time": "2:00 PM",
            "status": "pending",
            "created_at": datetime.utcnow()
        },
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024103",
            "student_name": "Miguel Torres",
            "student_program": "4th Year - BSCS-4A",
            "topic": "Project consultation - Mobile App Development",
            "preferred_date": (datetime.utcnow()).date().isoformat(),
            "preferred_time": "3:00 PM",
            "status": "pending",
            "created_at": datetime.utcnow()
        }
    ]
    await db.consultation_requests.insert_many(requests)

    # Create sample consultations (history)
    consultations = [
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024104",
            "student_name": "Anna Garcia",
            "student_program": "4th Year - BSCS-4B",
            "topic": "Capstone project discussion",
            "date": (datetime.utcnow() - timedelta(days=2)).date().isoformat(),
            "time": "10:00 AM",
            "duration": 45,
            "status": "completed",
            "notes": "Discussed project requirements and timeline",
            "remarks": "Student is on track",
            "created_at": datetime.utcnow() - timedelta(days=2),
            "updated_at": datetime.utcnow() - timedelta(days=2)
        },
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024105",
            "student_name": "Carlos Ramos",
            "student_program": "2nd Year - BSIT-2A",
            "topic": "Academic performance review",
            "date": (datetime.utcnow() - timedelta(days=5)).date().isoformat(),
            "time": "2:00 PM",
            "duration": 30,
            "status": "completed",
            "notes": "Reviewed midterm grades",
            "remarks": "Recommended additional study sessions",
            "created_at": datetime.utcnow() - timedelta(days=5),
            "updated_at": datetime.utcnow() - timedelta(days=5)
        }
    ]
    await db.consultations.insert_many(consultations)

    # Create sample queue entries (walk-ins from kiosk)
    queue_entries = [
        {
            "faculty_school_id": "FAC2024002",
            "queue_number": 1,
            "student_ids": ["STU2024106"],
            "student_names": ["Lucia Fernandez"],
            "topic": "Programming assignment help",
            "consultation_type": "individual",
            "status": "serving",
            "created_at": datetime.utcnow() - timedelta(minutes=10)
        },
        {
            "faculty_school_id": "FAC2024002",
            "queue_number": 2,
            "student_ids": ["STU2024107"],
            "student_names": ["Diego Morales"],
            "topic": "Database design questions",
            "consultation_type": "individual",
            "status": "waiting",
            "created_at": datetime.utcnow() - timedelta(minutes=5)
        },
        {
            "faculty_school_id": "FAC2024003",
            "queue_number": 1,
            "student_ids": ["STU2024108"],
            "student_names": ["Isabella Cruz"],
            "topic": "Calculus problems review",
            "consultation_type": "individual",
            "status": "waiting",
            "created_at": datetime.utcnow() - timedelta(minutes=2)
        }
    ]
    await db.queue.insert_many(queue_entries)

    # Create sample notifications
    notifications = [
        {
            "faculty_school_id": "FAC2024001",
            "type": "new_request",
            "title": "New Consultation Request",
            "message": "John Dela Cruz requested a consultation",
            "read": False,
            "created_at": datetime.utcnow()
        },
        {
            "faculty_school_id": "FAC2024001",
            "type": "reminder",
            "title": "Upcoming Consultation",
            "message": "You have a consultation with Miguel Torres at 3:00 PM today",
            "read": False,
            "created_at": datetime.utcnow()
        }
    ]
    await db.notifications.insert_many(notifications)

    return {
        "message": "Database seeded successfully",
        "faculty_count": len(faculty_list),
        "students_count": len(students),
        "test_credentials": {
            "school_id": "FAC2024001",
            "password": "password123"
        }
    }

# Database indexes and queue-counter migration
@app.on_event("startup")
async def initialize_database():
    """Enforce uniqueness and initialize ticket counters from existing data."""
    await db.students.create_index("student_id", unique=True)
    await db.faculty.create_index("school_id", unique=True)
    await db.queue.create_index(
        [("faculty_school_id", 1), ("queue_number", 1)], unique=True
    )
    await db.queue_counters.create_index("faculty_school_id", unique=True)

    # Supports deployments that already have queue records before counters exist.
    queue_maxes = db.queue.aggregate([
        {"$group": {"_id": "$faculty_school_id", "last_number": {"$max": "$queue_number"}}}
    ])
    async for queue_max in queue_maxes:
        await db.queue_counters.update_one(
            {"faculty_school_id": queue_max["_id"]},
            {"$max": {"last_number": queue_max["last_number"]},
             "$setOnInsert": {"created_at": datetime.utcnow()}},
            upsert=True,
        )

# Include router
app.include_router(api_router)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
