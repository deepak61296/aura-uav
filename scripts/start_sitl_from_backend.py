#!/usr/bin/env python3
import json
import math
import os
import subprocess
import sys
import urllib.request

API_URL = os.getenv("AURA_API_URL", "http://localhost:5000")
DRONE_ID = os.getenv("AURA_DRONE_ID", "DRONE001")
OFFSET_METERS = float(os.getenv("AURA_SITL_OFFSET_METERS", "150"))
DEFAULT_ALT = float(os.getenv("AURA_SITL_ALT", "243.95"))

status_url = f"{API_URL}/drone/{DRONE_ID}"
with urllib.request.urlopen(status_url, timeout=5) as response:
    data = json.load(response)

lat = data.get("currentLat") or data.get("deliveryLat")
lng = data.get("currentLng") or data.get("deliveryLng")
alt = data.get("currentAlt") or data.get("deliveryAlt") or DEFAULT_ALT

if lat is None or lng is None:
    raise SystemExit(f"No browser location is stored yet at {status_url}. Open the site and allow location first.")

home_lat = float(lat)
home_lng = float(lng) - OFFSET_METERS / (111320 * math.cos(math.radians(float(lat))))

cmd = [
    "/home/deepak/ardupilot/build/sitl/bin/arducopter",
    "-w",
    "--model", "+",
    "--speedup", "1",
    "--slave", "0",
    "--defaults", "/home/deepak/ardupilot/Tools/autotest/default_params/copter.parm",
    "--sim-address=127.0.0.1",
    "--home", f"{home_lat},{home_lng},{alt},90",
    "--serial0", "udpclient:127.0.0.1:14550",
]

print(f"Using live browser location: {lat}, {lng}")
print(f"Launching SITL home: {home_lat}, {home_lng}, {alt}, 90")
print("Command:")
print(" ".join(cmd))
os.makedirs("/tmp/aura-sitl", exist_ok=True)
os.chdir("/tmp/aura-sitl")
os.execv(cmd[0], cmd)
