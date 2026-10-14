# ConKiosk offline LAN deployment

ConKiosk is a **FastAPI + PostgreSQL + Expo** system. It is not a Laravel or MariaDB project, so do not add PHP-FPM, Composer, Laravel, or MariaDB for this deployment. The supported local architecture is:

```
Faculty phone / kiosk / TV -- dedicated Wi-Fi router -- Raspberry Pi
                                                    ├─ Nginx (port 80)
                                                    ├─ FastAPI/Uvicorn (loopback port 8001)
                                                    └─ PostgreSQL (loopback port 5432)
```

The router's WAN/internet connection is not used by normal consultation, queue, dashboard, admin, or database operations.

## Boot behavior with no network

The Pi can boot while no Wi-Fi router, Ethernet cable, DHCP service, or internet connection exists. PostgreSQL, the FastAPI systemd service, and Nginx are local processes and start from disk. They do not require a network to start.

When the Netless router is connected later, the Pi must receive its reserved address `192.168.0.2`; clients can then reach the already-running Nginx/API at that address. This is why a router DHCP reservation is preferred over a manually changing IP.

Expo Go is development tooling, not the production server: it needs a LAN address to create a phone-reachable QR URL. `corepack yarn start:lan` now starts in local mode when no LAN exists instead of failing, but it must be restarted after the router is connected so the QR contains `192.168.0.2`. Kiosk and TV production access through Nginx do not use Expo/Metro at all.

## 1. Give the Pi a stable LAN address

Keep the router at `192.168.0.1` and reserve `192.168.0.2` for the ConKiosk Raspberry Pi in the router's DHCP configuration (recommended), or configure a static address in Raspberry Pi OS. Connect every phone, kiosk, TV, and the Pi to the same SSID/VLAN. Disable wireless client/AP isolation.

On the Pi, confirm the address:

```bash
hostname -I
```

## 2. Backend configuration

```bash
cd /home/conkiosk/ConKiosk/backend
cp .env.example .env
```

Set these values in `backend/.env`; keep the generated JWT secret and database password private:

```dotenv
DATABASE_URL=postgresql+asyncpg://conkiosk:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/conkiosk
JWT_SECRET_KEY=GENERATE_A_LONG_RANDOM_VALUE
ENVIRONMENT=production
LAN_ORIGIN=http://192.168.0.2
CORS_ORIGINS=http://conkiosk.local,http://localhost:8081
ALLOW_SEED_DATA=false
```

`LAN_ORIGIN` lets the server allow the deployed Nginx web app and Expo development server on that Pi address without using a wildcard CORS policy. `127.0.0.1` in `DATABASE_URL` is correct: only the Pi connects to PostgreSQL. Phones must only access the API.

Install and enable the supplied service:

```bash
sudo cp /home/conkiosk/ConKiosk/deploy/conkiosk-backend.service /etc/systemd/system/conkiosk.service
sudo systemctl daemon-reload
sudo systemctl enable --now conkiosk
sudo systemctl status conkiosk
```

## 3. Faculty Expo configuration

Create `frontend/.env` from `frontend/.env.example`:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.0.2/api
```

This is the only API address used by the mobile app, kiosk, TV, CRUD calls, authentication, and WebSockets. It must be changed when the Pi LAN address changes; no source file needs editing.

For the deployed Pi, this routes app traffic through Nginx on port 80; FastAPI
and PostgreSQL are not exposed to phones. For Expo Go development on the Pi or
a LAN-connected laptop before Nginx is installed, use the LAN launcher instead:

```bash
cd /home/conkiosk/ConKiosk/frontend
corepack yarn start:lan
```

The LAN launcher detects the current Wi-Fi IP and temporarily sets
`EXPO_PUBLIC_API_URL=http://CURRENT_PI_IP/api`, which uses the local Nginx
proxy. It is development-only. Set `CONKIOSK_API_PORT=8001` only when using a
separate, deliberately LAN-bound development API server.
Expo Go itself must already be installed on phones. First-time Expo Go installation, JavaScript package installation, and cloud builds may require internet, but a running LAN Metro server and the ConKiosk API do not use internet.

## 4. Nginx deployment for kiosk and TV

Build the static web app after setting `EXPO_PUBLIC_API_URL`:

```bash
cd /home/conkiosk/ConKiosk/frontend
corepack yarn expo export --platform web --output-dir dist
sudo mkdir -p /var/www/conkiosk
sudo rsync -a --delete dist/ /var/www/conkiosk/
```

Install Nginx and create `/etc/nginx/sites-available/conkiosk`:

```nginx
server {
    listen 80;
    server_name _;
    root /var/www/conkiosk;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo apt install -y nginx rsync
sudo ln -sf /etc/nginx/sites-available/conkiosk /etc/nginx/sites-enabled/conkiosk
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable --now nginx
```

Open `http://192.168.0.2/kiosk` and `http://192.168.0.2/tv` from LAN displays. Nginx serves `/public`-equivalent static web assets here; there is no Laravel `public/` directory because this is not Laravel.

## 5. Database and firewall

PostgreSQL listens locally; do not publish port 5432 to the LAN. If UFW is used, permit only HTTP from the dedicated subnet:

```bash
sudo ufw allow from 192.168.0.0/24 to any port 80 proto tcp
sudo ufw deny 5432/tcp
sudo ufw enable
```

Keep Uvicorn on `127.0.0.1` behind Nginx for the production design above. If Expo Go directly uses `:8001` during development, bind a separate development process to `0.0.0.0` and permit that port only from `192.168.0.0/24`; do not expose it on an internet-facing router.

## 6. Offline LAN test procedure

1. Disconnect the router WAN/internet cable; leave Pi and phones on `CONKIOSK-LAN`.
2. On the Pi, run `hostname -I`; confirm `192.168.0.2`.
3. From a phone, open `http://192.168.0.2/api/health`. It must return `{"status":"ok","service":"conkiosk-api","database":"ok"}`.
4. Open `http://192.168.0.2/kiosk` and `http://192.168.0.2/tv` on kiosk/TV browsers.
5. Start Expo with `corepack yarn start:lan`, scan its LAN QR code in Expo Go, and wait for **ConKiosk Server Connected**.
6. Sign in, create and action a consultation request, verify queue/TV updates, and test admin functions.
7. If the status says **Server Unreachable**, verify the phone is on the same subnet, client isolation is disabled, and the `EXPO_PUBLIC_API_URL` address matches `hostname -I`.

## Internet dependency audit

Normal API/database functions, JWT authentication, queue WebSockets, kiosk, TV, admin, and faculty workflows are local. There are no application calls to cloud APIs. Expo Go distribution/update, npm/yarn package installation, EAS builds, and OS package installation can require internet before the offline deployment is prepared. Expo Go must have the SDK-compatible app already installed; for a fully managed field deployment, distribute a prebuilt APK rather than relying on Expo Go.
