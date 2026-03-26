# 🛸 Aura Delivery — Drone Medical Delivery Platform

> Emergency medical supply delivery via autonomous drones. Built with React, Node.js, Python/pymavlink, and ArduPilot SITL.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![SITL](https://img.shields.io/badge/ArduPilot-SITL%20Tested-blue)
![Hardware](https://img.shields.io/badge/hardware-partially%20tested-orange)

---

## 🏗 Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        BROWSER                                 │
│  ┌──────────────┐    ┌─────────────────────────────────────┐  │
│  │  User Panel   │    │         Admin Dashboard              │  │
│  │  /user        │    │         /admin                       │  │
│  │  - Products   │    │  - Artificial Horizon                │  │
│  │  - Booking    │    │  - Telemetry Panel                   │  │
│  │  - Tracking   │    │  - System Health                     │  │
│  └──────┬───────┘    │  - Ops Controls                      │  │
│         │            └──────────┬──────────────────────────┘  │
│         └─────────┬─────────────┘                              │
│                   ▼                                            │
│     ┌─────────────────────────────┐                           │
│     │   Node.js Backend (:5000)   │                           │
│     │   Express + MongoDB         │                           │
│     └────────────┬────────────────┘                           │
│                  ▼                                             │
│     ┌─────────────────────────────┐                           │
│     │  Python Controller (:5001)  │                           │
│     │  pymavlink + Flask          │                           │
│     └────────────┬────────────────┘                           │
│                  ▼                                             │
│     ┌─────────────────────────────┐                           │
│     │  ArduPilot SITL / Real FC   │                           │
│     │  MAVLink UDP/Serial         │                           │
│     └─────────────────────────────┘                           │
└───────────────────────────────────────────────────────────────┘
```

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- ArduPilot SITL (`arducopter`) — [install guide](https://ardupilot.org/dev/docs/building-setup-linux.html)
- MongoDB Atlas account (or local MongoDB)

### 1. Clone & Install

```bash
git clone https://github.com/deepak61296/aura-uav.git
cd aura-uav
```

**Backend:**
```bash
cd Backend
cp .env.example .env    # edit with your MongoDB URI and API key
npm install
```

**Frontend:**
```bash
cd Frontend
cp .env.example .env.local   # edit with your API URL and key
npm install
```

### 2. Run

```bash
# Terminal 1 — Backend
cd Backend && npm run dev

# Terminal 2 — Frontend
cd Frontend && npm run dev
```

### 3. Access

| Panel | URL | Purpose |
|-------|-----|---------|
| Portal | http://localhost:5173 | Landing page |
| User App | http://localhost:5173/user | Order medical supplies |
| Admin Dashboard | http://localhost:5173/admin | Fleet ops, telemetry, sim control |

---

## 🛰 Connection Modes

### SITL (Test Mode) — Default
The backend auto-spawns an ArduPilot SITL instance ~150m from your browser-reported GPS location. No hardware needed.

> **💡 SITL Configuration:** Aura UAV expects the ArduPilot `arducopter` binary to be compiled on your system. 
> By default, it looks in `/home/$USER/ardupilot/build/sitl/bin/arducopter`. You can override this path by setting `SITL_BIN=/path/to/arducopter` in your Backend `.env` file.

Click **"▶ Start Simulation"** in the Admin Dashboard to launch.

### Real Drone (Hardware)
Set the `VEHICLE_CONNECTION` environment variable when running the Python controller:

```bash
VEHICLE_CONNECTION=serial:/dev/ttyUSB0:57600 python Python/finalcode.py
```

Or for a networked drone:
```bash
VEHICLE_CONNECTION=udp:<drone-ip>:14550 python Python/finalcode.py
```

> ⚠️ **Hardware Status**: Partially tested on physical hardware. Full cloud deployment with online drone connectivity is planned for future releases.

---

## 📊 Admin Dashboard Features

| Instrument | Description |
|------------|-------------|
| **Artificial Horizon** | Real-time pitch/roll/yaw visualization from MAVLink ATTITUDE messages |
| **Telemetry Panel** | Altitude, GPS coordinates, battery V/A/%, armed state, flight mode, servo state |
| **System Health** | Live status badges for SITL, Controller, GPS Lock, Armed state |
| **Ops Panel** | Start / Restart / Stop simulation with one click |
| **Live Map** | Drone position, flight path (orange outbound, blue return), home & delivery pins |

---

## 🔐 Security

- API keys are stored in `.env` files (gitignored)
- `.env.example` files provide templates without secrets
- Backend validates `x-api-key` header on all mutation endpoints

---

## 🗺 Roadmap

- [ ] Multi-drone fleet support (DRONE002, DRONE003…)
- [ ] Cloud-hosted drone connectivity via WebSocket bridge
- [ ] Real-time video feed integration
- [ ] Mission audit logging in MongoDB
- [ ] Mobile-responsive PWA
- [ ] Role-based access control (Admin vs Operator)

---

## 📄 License

MIT © Aura UAV
