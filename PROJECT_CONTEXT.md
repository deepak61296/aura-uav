# Aura Delivery Project Context

## Overview
This project is a local drone-delivery demo stack built around:
- a React frontend
- a Node/Express backend
- a Python mission controller using `pymavlink`
- ArduPilot SITL (`arducopter`)

The current setup is for localhost testing and SITL simulation, not production deployment.

## Current Goal
Demonstrate this flow locally:
1. user opens the website
2. browser shares current location
3. backend stores that location
4. backend starts SITL + controller
5. drone appears on the map near the user
6. user books and confirms delivery
7. drone takes off, flies to the user, hovers, drops, returns
8. order resets after mission completes

## Main Components

### Frontend
Path: `Frontend/`
Tech: Vite, React, React Leaflet
Main behavior:
- fetches backend order state \& controller telemetry
- shows user location and drone location on map
- displays health pills (SITL, Controller, GPS, Mission)
- supports Book, Confirm, Reset Order, and Reset Sim flows

### Backend
Path: `Backend/`
Tech: Node.js, Express, MongoDB / Mongoose
Responsibilities:
- store order state, user location, telemetry
- manage simulation lifecycle (`/sim/start`, `/sim/stop`, `/sim/reset`, `/sim/status`)

### Python Controller
Path: `Python/finalcode.py`
Tech: Flask, `pymavlink`
Responsibilities:
- connect to SITL over MAVLink, read telemetry and expose via `/telemetry`
- poll backend for mission state
- arm, takeoff, fly, descend, drop, climb, RTL
- Note: DroneKit has been removed in favor of pure `pymavlink`.

### SITL
ArduPilot path: `/home/deepak/ardupilot`
SITL binary: `/home/deepak/ardupilot/build/sitl/bin/arducopter`

## Connecting to a Real Drone
By default, the backend Python controller connects to the local ArduPilot SITL simulator over UDP (`udp:127.0.0.1:14550`).
To use this project with a physical drone:
1. Provide the `VEHICLE_CONNECTION` environment variable when running the Python controller, pointing to your telemetry radio or serial port.
   - Example: `VEHICLE_CONNECTION=serial:/dev/ttyUSB0:57600 python Python/finalcode.py`
2. Once connected, the Admin Dashboard and User App will automatically source telemetry and track the physical drone instead of the simulated one.

## Architecture & Flow
- Backend on `localhost:5000`
- Controller on `localhost:5001`
- Frontend on `127.0.0.1:5173`
- SITL MAVLink on `127.0.0.1:14550`

## Future Roadmap (Production Polish)
- **Fleet & Ops**: Multiple drones, assignment engine, live fleet dashboard.
- **Mission Lifecycle**: Proper state machine with timestamped events.
- **Safety Readiness**: Preflight checks, automatic fail handling.
- **User Experience**: Richer delivery booking, tracking, notifications.
- **Maps**: Markers for launch/drop points, path coloring, No-Fly Zones.
- **Reliability/Admin**: Health watchdog, detailed admin dashboard, error logs.
