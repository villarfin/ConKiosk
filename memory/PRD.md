# ConKiosk Faculty Mobile App - PRD

## Overview
A professional mobile application for university faculty to manage student consultation requests. Connects to a Raspberry Pi 5 server via REST API and Socket.io for real-time synchronization.

## Tech Stack
- **Frontend**: Expo (React Native) + TypeScript + Expo Router
- **Backend**: FastAPI + MongoDB + Socket.io
- **Auth**: JWT (30-day expiration)
- **Storage**: Secure storage for tokens (expo-secure-store), AsyncStorage for faculty data
- **Real-time**: Socket.io (works well on Raspberry Pi 5)

## Features Implemented

### Authentication
- School ID + Password login (JWT-based)
- Secure token storage
- Auto-login on app relaunch
- Change password functionality
- Logout with confirmation

### Dashboard
- Personalized greeting with faculty photo
- One-tap availability status (Available/Busy/Unavailable) with color coding
- Today's consultations count
- Pending requests count
- Monthly consultation summary
- Upcoming consultations list
- Quick action buttons

### Consultation Requests
- View all pending requests with student details
- Accept requests (creates consultation record)
- Decline requests with optional reason
- Reschedule with date/time picker
- Real-time updates via Socket.io

### Consultation History
- List all consultations (past & present)
- Search by student name, ID, or topic
- Filter by status (All/Scheduled/Ongoing/Completed/Cancelled)
- Detailed view with editable notes and remarks
- Mark as completed
- Update consultation status

### Notifications Center
- View all notifications with icons and colors by type
- Unread indicator
- Mark individual/all as read
- Types: new_request, accepted, declined, cancelled, rescheduled, reminder, system
- Real-time updates via Socket.io

### Profile Management
- Profile image upload (from gallery)
- Edit personal information (name, email, department, office, hours)
- Change password
- View School ID
- Logout

## API Endpoints (All prefixed with /api)
- Auth: POST /auth/login, POST /auth/change-password
- Faculty: GET /faculty/profile, PATCH /faculty/profile, PATCH /faculty/availability
- Dashboard: GET /dashboard/stats
- Requests: GET /consultation-requests, POST /consultation-requests/{id}/action
- Consultations: GET /consultations, GET /consultations/{id}, PATCH /consultations/{id}
- Notifications: GET /notifications, PATCH /notifications/{id}/read, POST /notifications/mark-all-read
- Seed: POST /seed (for testing)

## Test Credentials
- School ID: `FAC2024001`
- Password: `password123`
- Name: Dr. Maria Santos
- Department: Computer Science

## Design System
- **Colors**: White background, Blue (#2196F3) primary, Green/Orange/Red for status
- **Typography**: System fonts with clear hierarchy (24pt titles, 16pt body, 14pt secondary)
- **Spacing**: 8pt grid (8, 12, 16, 24, 32)
- **Cards**: Rounded 12-16pt, soft shadows, elevation 2-4
- **Icons**: @expo/vector-icons (Ionicons)
- **Bottom Nav**: 5 tabs (Dashboard, Requests, History, Notifications, Profile)

## Testing Results
- ✅ 25/25 backend tests passed (100%)
- ✅ Frontend UI verified with screenshots (Dashboard, History, Login all functional)
- ✅ JWT authentication working
- ✅ MongoDB serialization correct (no ObjectId errors)
