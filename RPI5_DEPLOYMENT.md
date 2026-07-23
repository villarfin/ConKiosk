# ConKiosk – Raspberry Pi 5 Deployment Guide

Complete guide to run the ConKiosk system on your Raspberry Pi 5.

---

## System Architecture on RPi 5

```
                    ┌──────────────────────┐
                    │   Raspberry Pi 5     │
                    │  ─────────────────   │
                    │  • FastAPI Backend   │◄──────┐
                    │  • MongoDB           │       │
                    │  • Socket.IO Server  │       │ Local WiFi
                    │  • Port 8001         │       │
                    └──────────┬───────────┘       │
                               │                    │
                    ┌──────────┴──────────┐         │
                    │                     │         │
        ┌───────────▼─────┐   ┌───────────▼─────┐  │
        │  Kiosk Browser  │   │   TV Browser    │  │
        │  (Touchscreen)  │   │  (Full screen)  │  │
        │  /kiosk         │   │  /tv            │  │
        └─────────────────┘   └─────────────────┘  │
                                                     │
        ┌────────────────────────────────────────────┘
        │
   ┌────▼─────────┐
   │ Faculty      │
   │ Mobile App   │
   │ (WiFi)       │
   └──────────────┘
```

All 4 components communicate through the RPi via REST API + WebSockets.

---

## Prerequisites

- Raspberry Pi 5 (4GB or 8GB recommended)
- Raspberry Pi OS (64-bit) — Bookworm or later
- MicroSD card (32GB minimum)
- Ethernet or WiFi connection
- Touchscreen for kiosk (optional but recommended)
- TV/Monitor for queue display
- USB QR code scanner (optional — most work as HID keyboards)

---

## Step 1: Install Dependencies on RPi 5

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.11+ and pip
sudo apt install -y python3 python3-pip python3-venv git

# Install MongoDB (using official Debian package)
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=arm64,amd64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl enable mongod
sudo systemctl start mongod

# Install Chromium (for kiosk & TV browser)
sudo apt install -y chromium-browser unclutter
```

---

## Step 2: Deploy the Backend

```bash
# Clone or copy your project
cd /home/pi
git clone <your-repo-url> conkiosk
cd conkiosk/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Create .env file from the template. Set production credentials before starting.
cp .env.example .env

# Test run (uses the Socket.IO-enabled ASGI application)
uvicorn server:socket_app --host 0.0.0.0 --port 8001

# Development only: enable this destructive endpoint before seeding demo data.
echo ALLOW_SEED_DATA=true >> .env
curl -X POST http://localhost:8001/api/seed
```

---

## Step 3: Run Backend as a Service

Create `/etc/systemd/system/conkiosk.service`:

```ini
[Unit]
Description=ConKiosk Backend Server
After=network.target mongod.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/conkiosk/backend
Environment="PATH=/home/pi/conkiosk/backend/venv/bin"
ExecStart=/home/pi/conkiosk/backend/venv/bin/uvicorn server:socket_app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable conkiosk
sudo systemctl start conkiosk
sudo systemctl status conkiosk
```

---

## Step 4: Find Your RPi's Local IP

```bash
hostname -I
# Example output: 192.168.1.100
```

Note this IP — you'll need it for the mobile app and browser setup.

---

## Step 5: Configure Faculty Mobile App

In your Expo project's `frontend/.env`:

```
EXPO_PUBLIC_BACKEND_URL=http://192.168.1.100:8001
```

Rebuild the app with EAS Build and distribute the APK to faculty. The app will now connect to the RPi over WiFi.

**Important:** All faculty phones and the RPi must be on the **same WiFi network**.

---

## Step 6: Set Up the Kiosk (Touchscreen)

Auto-launch Chromium in kiosk mode on RPi boot:

Create `/home/pi/kiosk.sh`:

```bash
#!/bin/bash
xset s off
xset -dpms
xset s noblank
unclutter -idle 0.1 -root &
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-pinch --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  http://localhost/kiosk
```

Make it executable:

```bash
chmod +x /home/pi/kiosk.sh
```

Add to autostart. Edit `~/.config/lxsession/LXDE-pi/autostart`:

```
@/home/pi/kiosk.sh
```

**Note:** Since the frontend is served through Expo Metro (port 3000/8081 in dev) or you'll need to build it for web output first (`npx expo export -p web`) and serve via nginx. For simplicity, you can host the web build on the RPi itself.

---

## Step 7: Set Up the TV Display

Same approach as kiosk, but point to `/tv`:

Create `/home/pi/tvdisplay.sh` (on a second RPi or the same one with dual display):

```bash
#!/bin/bash
xset s off
xset -dpms
xset s noblank
unclutter -idle 0.1 -root &
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  http://localhost/tv
```

If using the same RPi for both kiosk and TV, use `xrandr` to configure dual displays and launch each Chromium instance on a specific screen with `--window-position`.

---

## Step 8: Build Web Frontend for Kiosk & TV

On your dev machine (where you have Node):

```bash
cd frontend
# Set EXPO_PUBLIC_BACKEND_URL in frontend/.env to http://YOUR_RPI_IP:8001
# before exporting so the built kiosk and TV can reach the API.
npx expo export -p web
```

This creates a `dist/` folder. Copy it to the RPi:

```bash
scp -r dist/ pi@192.168.1.100:/home/pi/conkiosk-web/
```

Install nginx on the RPi to serve the web build:

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/conkiosk <<EOF
server {
    listen 80;
    root /home/pi/conkiosk-web;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:8001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /socket.io/ {
        proxy_pass http://localhost:8001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/conkiosk /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

Now the kiosk and TV can access:
- `http://YOUR_RPI_IP/kiosk` — Kiosk
- `http://YOUR_RPI_IP/tv` — TV Display

Update the kiosk.sh/tvdisplay.sh scripts to point to these URLs.

---

## Step 9: USB QR Scanner Setup

Most USB QR scanners work as HID keyboards — no driver setup needed. Just:

1. Plug the scanner into a USB port on the RPi
2. Open the kiosk in browser
3. Focus the QR scan input field (it auto-focuses on the identify page)
4. Scan a QR code → the scanner types the ID and presses Enter automatically

**Recommended:** Print QR codes for each student's ID (using the Student ID Number as the QR content).

---

## Step 10: Test the Full System

1. **Backend running:** `curl http://YOUR_RPI_IP:8001/api/kiosk/faculty` returns 6 faculty
2. **Kiosk works:** Open `http://YOUR_RPI_IP/kiosk` on a browser — see faculty grid
3. **TV Display:** Open `http://YOUR_RPI_IP/tv` on a monitor — real-time board
4. **Faculty App:** Install APK, login with FAC2024001/password123, see 3 pending requests
5. **End-to-end:** Submit request from kiosk → appears on faculty app → accept it → auto-added to queue → visible on TV

---

## Test Credentials

- **Faculty School IDs:** FAC2024001 through FAC2024006 (all use password `password123`)
- **Sample Student IDs:** STU2024101 to STU2024108

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Mobile app can't connect | Check RPi IP + WiFi network. Verify port 8001 is not firewalled. |
| Kiosk shows blank page | Ensure `nginx` is running and `expo export -p web` was run. |
| Socket.IO not working | Check nginx `proxy_pass` for `/socket.io/` block. |
| MongoDB won't start | Check `sudo journalctl -u mongod` for errors. Common: disk space. |
| QR scanner doesn't work | Test in any text editor first. Should type + press Enter automatically. |
| Slow performance | RPi 5 with 8GB recommended. Enable swap if 4GB. |

---

## Security Recommendations (Before Production)

1. Use `backend/.env.example` as the template and set `ENVIRONMENT=production`.
2. Set a long random `JWT_SECRET_KEY`, MongoDB credentials, and exact `CORS_ORIGINS`.
3. Keep `ALLOW_SEED_DATA=false`; `/api/seed` must never run against real data.
4. Enable MongoDB auth (`sudo systemctl edit mongod`).
5. Set up HTTPS via Let's Encrypt if exposing beyond the school network.
6. Regularly back up and restore-test MongoDB: `mongodump --db conkiosk`.

---

## Support

For issues, check:
- Backend logs: `sudo journalctl -u conkiosk -f`
- MongoDB logs: `sudo journalctl -u mongod -f`
- Nginx logs: `sudo tail -f /var/log/nginx/error.log`
