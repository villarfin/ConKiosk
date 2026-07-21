# ConKiosk – Complete Consultation Management System

## Overview
An integrated 4-component consultation management system for universities:
1. **Faculty Mobile App** – JWT-authenticated, manage requests, availability, history
2. **Student Kiosk** – Public touchscreen for QR/manual student identification & consultation requests
3. **TV Queue Display** – Real-time dashboard showing all faculty status & queues
4. **Raspberry Pi 5 Backend** – FastAPI + MongoDB + Socket.IO (central server)

## Tech Stack
- **Frontend**: Expo (React Native) + TypeScript + Expo Router (all 3 UIs in one project)
- **Backend**: FastAPI + MongoDB + python-socketio (works on RPi 5)
- **Auth**: JWT (30-day expiration) with bcrypt password hashing
- **Real-time**: Socket.IO for instant sync across all components

## Deliverables
- **Mobile App** (faculty): 5-tab bottom nav (Dashboard, Requests, History, Notifications, Profile)
- **Kiosk UI** (`/kiosk` route): faculty grid → identify (QR/manual, individual/group) → request → confirmation with queue number
- **TV Display** (`/tv` route): dark-theme dashboard with live status, "Now Serving", waiting counts, next queue numbers, live clock
- **Backend**: 30+ REST endpoints, WebSocket events
- **RPi 5 Deployment Guide** (`/app/RPI5_DEPLOYMENT.md`)

## Key Flows Working End-to-End

### Kiosk → Queue → TV Display → Faculty App
1. Student scans QR (or types) at kiosk → auto-fills info
2. Selects faculty → enters topic → submits
3. **Queue #N assigned + shown on kiosk confirmation**
4. TV Display updates in real-time (Socket.IO)
5. Faculty receives notification on mobile app
6. Faculty accepts → consultation record created with queue linkage
7. Faculty taps "Start Consultation" → status auto-changes to Busy, TV shows "Now Serving #N"
8. Faculty taps "Complete" → duration computed, queue advances, faculty auto-set to Available

### Faculty Status Sync
- Faculty toggles Available/Busy/Unavailable on mobile
- Backend broadcasts `availability_changed` via Socket.IO
- Kiosk grid updates (unavailable = disabled)
- TV Display updates status strip color instantly

## Test Credentials
- **Faculty**: `FAC2024001` through `FAC2024006` (all use password `password123`)
- **Students**: `STU2024101` to `STU2024108` (for QR scanner testing)

## API Endpoints Summary

### Public (Kiosk/TV)
- `GET /api/kiosk/faculty` – Faculty list with status
- `GET /api/kiosk/students/{id}` – Student lookup
- `POST /api/kiosk/students` – Upsert student
- `POST /api/kiosk/consultation-request` – Submit request
- `GET /api/kiosk/queue/{faculty_id}` – Faculty queue
- `GET /api/tv-display/status` – TV dashboard data

### Authenticated (Faculty App)
- `POST /api/auth/login`, `POST /api/auth/change-password`
- `GET/PATCH /api/faculty/profile`, `PATCH /api/faculty/availability`
- `GET /api/dashboard/stats`
- `GET/POST /api/consultation-requests` + `/action`
- `GET/PATCH /api/consultations` + `/start` + `/complete`
- `GET/PATCH /api/notifications`

## Test Results
- ✅ **50/50 backend tests passed** (auth, consultations, kiosk, queue, TV, start/complete, regression)
- ✅ Frontend flows verified via screenshots (login → dashboard, kiosk complete flow, TV display)
- ✅ End-to-end integration working: Kiosk request → Faculty accept → Start → TV updates
- ✅ Real-time Socket.IO broadcasting `availability_changed`, `queue_updated`, `consultation_started/completed`, `new_consultation_request`

## Deployment
See `/app/RPI5_DEPLOYMENT.md` for complete step-by-step guide including:
- MongoDB + Python + Chromium setup on RPi 5
- systemd service for backend auto-start
- nginx config to serve web build + proxy Socket.IO
- Kiosk browser auto-launch scripts
- USB QR scanner setup (works as HID keyboard)
- Security hardening for production
