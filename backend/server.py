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
import socketio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "conkiosk-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

security = HTTPBearer()

# Create FastAPI app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Socket.IO setup
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
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
    from bson.objectid import ObjectId
    request = await db.consultation_requests.find_one({
        "_id": ObjectId(request_id),
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
    from bson.objectid import ObjectId
    
    request = await db.consultation_requests.find_one({
        "_id": ObjectId(request_id),
        "faculty_school_id": faculty["school_id"]
    })
    
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    
    if action.action == "accept":
        # Update request status
        await db.consultation_requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": {"status": "accepted"}}
        )
        
        # Create consultation record
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
            {"_id": ObjectId(request_id)},
            {"$set": {"status": "declined", "decline_reason": action.reason}}
        )
        
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
            {"_id": ObjectId(request_id)},
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
    from bson.objectid import ObjectId
    consultation = await db.consultations.find_one({
        "_id": ObjectId(consultation_id),
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
    from bson.objectid import ObjectId
    
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    
    result = await db.consultations.update_one(
        {"_id": ObjectId(consultation_id), "faculty_school_id": faculty["school_id"]},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Consultation not found")
    
    updated = await db.consultations.find_one({"_id": ObjectId(consultation_id)})
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
    from bson.objectid import ObjectId
    
    result = await db.notifications.update_one(
        {"_id": ObjectId(notification_id), "faculty_school_id": faculty["school_id"]},
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

# ==================== Seed Data (For Testing) ====================

@api_router.post("/seed")
async def seed_database():
    """Seed the database with test data"""
    
    # Clear existing data
    await db.faculty.delete_many({})
    await db.consultation_requests.delete_many({})
    await db.consultations.delete_many({})
    await db.notifications.delete_many({})
    
    # Create test faculty
    faculty_data = {
        "school_id": "FAC2024001",
        "password_hash": get_password_hash("password123"),
        "full_name": "Dr. Maria Santos",
        "department": "Computer Science",
        "office_location": "Room 301, Science Building",
        "email": "maria.santos@university.edu",
        "availability_status": "available",
        "office_hours": "Mon-Fri 9:00 AM - 5:00 PM"
    }
    await db.faculty.insert_one(faculty_data)
    
    # Create sample consultation requests
    requests = [
        {
            "faculty_school_id": "FAC2024001",
            "student_id": "STU2024101",
            "student_name": "John Dela Cruz",
            "student_program": "BS Computer Science",
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
            "student_program": "BS Information Technology",
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
            "student_program": "BS Computer Science",
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
            "student_id": "STU2024201",
            "student_name": "Anna Garcia",
            "student_program": "BS Computer Science",
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
            "student_id": "STU2024202",
            "student_name": "Carlos Ramos",
            "student_program": "BS Information Technology",
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
        "test_credentials": {
            "school_id": "FAC2024001",
            "password": "password123"
        }
    }

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
