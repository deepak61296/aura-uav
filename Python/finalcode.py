import collections
import collections.abc
import math
import os
import threading
import time

collections.MutableMapping = collections.abc.MutableMapping
collections.Mapping = collections.abc.Mapping
collections.Sequence = collections.abc.Sequence

import requests
from flask import Flask, jsonify
from flask_cors import CORS
from dronekit import LocationGlobalRelative, VehicleMode, connect
from pymavlink import mavutil

DRONE_ID = os.getenv("DRONE_ID", "DRONE001")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:5000")
API_KEY = os.getenv("API_KEY", "SUPER_SECRET_KEY")
VEHICLE_CONNECTION = os.getenv("VEHICLE_CONNECTION", "udp:127.0.0.1:14550")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2"))
TELEMETRY_PUSH_INTERVAL = float(os.getenv("TELEMETRY_PUSH_INTERVAL", "1"))
TAKEOFF_ALTITUDE = float(os.getenv("TAKEOFF_ALTITUDE", "5"))
DESCENT_ALTITUDE = float(os.getenv("DESCENT_ALTITUDE", "2"))
WAYPOINT_RADIUS = float(os.getenv("WAYPOINT_RADIUS", "2"))

MISSION_API_URL = f"{API_BASE_URL}/drone/{DRONE_ID}"
RESET_API_URL = f"{API_BASE_URL}/drone/reset"
TELEMETRY_API_URL = f"{API_BASE_URL}/telemetry"

current_pitch = current_roll = current_yaw = 0.0
current_altitude = None
current_voltage = current_current = current_level = None
current_latitude = current_longitude = None
mission_state = "idle"
servo_state = "idle"
home_lat = None
home_lon = None
current_target = {"lat": None, "lng": None, "alt": None}
mission_lock = threading.Lock()

app = Flask(__name__)
CORS(app)

print(f"[INFO] Connecting to vehicle on {VEHICLE_CONNECTION}")
vehicle = connect(VEHICLE_CONNECTION, wait_ready=True, timeout=120)


def api_headers():
    return {"x-api-key": API_KEY, "Content-Type": "application/json"}


def set_servo(servo_num, pwm_value):
    try:
        print(f"[SERVO] {servo_num} -> {pwm_value}")
        vehicle._master.mav.command_long_send(
            vehicle._master.target_system,
            vehicle._master.target_component,
            mavutil.mavlink.MAV_CMD_DO_SET_SERVO,
            0,
            servo_num,
            pwm_value,
            0,
            0,
            0,
            0,
            0,
        )
    except Exception as exc:
        print(f"[SERVO] command failed: {exc}")


def attitude_listener(_, __, value):
    global current_pitch, current_roll, current_yaw
    current_pitch = round(math.degrees(value.pitch), 2)
    current_roll = round(math.degrees(value.roll), 2)
    current_yaw = round(math.degrees(value.yaw), 2)


def location_listener(_, __, value):
    global current_altitude, current_latitude, current_longitude
    current_altitude = round(value.alt, 2) if value.alt is not None else None
    current_latitude = round(value.lat, 7) if value.lat is not None else None
    current_longitude = round(value.lon, 7) if value.lon is not None else None


def battery_listener(_, __, value):
    global current_voltage, current_current, current_level
    current_voltage = round(value.voltage, 2) if value.voltage is not None else None
    current_current = round(value.current, 2) if value.current is not None else None
    current_level = value.level if value.level is not None else None


vehicle.add_attribute_listener("attitude", attitude_listener)
vehicle.add_attribute_listener("location.global_relative_frame", location_listener)
vehicle.add_attribute_listener("battery", battery_listener)

try:
    vehicle.mode = VehicleMode("STABILIZE")
except Exception as exc:
    print(f"[MODE] failed to set initial STABILIZE: {exc}")

set_servo(5, 2000)
servo_state = "on"


def haversine_distance(lat1, lon1, lat2, lon2):
    radius = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_rc_active():
    try:
        for channel in ("1", "2", "4"):
            pwm = vehicle.channels.get(channel)
            if pwm and abs(pwm - 1500) > 100:
                return True
    except Exception:
        return False
    return False


def abort_to_stabilize(reason="RC override"):
    global mission_state
    print(f"[ABORT] {reason}")
    vehicle.mode = VehicleMode("STABILIZE")
    mission_state = "aborted"


def rc_safe_sleep(seconds, phase_name=""):
    for _ in range(max(1, int(seconds / 0.5))):
        if is_rc_active():
            abort_to_stabilize(f"RC override during {phase_name}")
            return False
        time.sleep(0.5)
    return True


def wait_for_mode(name, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if vehicle.mode.name == name:
            return True
        time.sleep(0.5)
    return False


def fly_to_and_wait(lat, lon, alt, label, timeout=180):
    vehicle.simple_goto(LocationGlobalRelative(lat, lon, alt))
    print(f"[MISSION] Flying to {label}: {lat:.7f}, {lon:.7f} @ {alt}m")
    deadline = time.time() + timeout

    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override while flying to {label}")
            return False

        if current_latitude is not None and current_longitude is not None:
            distance = haversine_distance(current_latitude, current_longitude, lat, lon)
            altitude = current_altitude or 0.0
            print(f"[MISSION] {label} distance={distance:.1f}m altitude={altitude:.1f}m")
            if distance <= WAYPOINT_RADIUS:
                return True

        time.sleep(1)

    print(f"[MISSION] Timed out before reaching {label}")
    return False


def change_altitude_and_wait(new_alt, label, timeout=30):
    if current_latitude is None or current_longitude is None:
        print(f"[MISSION] Cannot change altitude for {label}: no GPS fix")
        return False

    vehicle.simple_goto(LocationGlobalRelative(current_latitude, current_longitude, new_alt))
    deadline = time.time() + timeout

    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override during {label}")
            return False

        altitude = current_altitude or 0.0
        print(f"[MISSION] {label}: altitude={altitude:.1f}m target={new_alt:.1f}m")
        if abs(altitude - new_alt) <= 0.4:
            return True
        time.sleep(0.5)

    print(f"[MISSION] Timed out during {label}")
    return False


def wait_for_disarm(timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not vehicle.armed:
            return True
        time.sleep(1)
    return False


def reset_api():
    for attempt in range(1, 4):
        try:
            response = requests.post(
                RESET_API_URL,
                json={"droneId": DRONE_ID},
                headers=api_headers(),
                timeout=5,
            )
            if response.ok:
                print("[API] Order reset")
                return True
            print(f"[API] Reset failed with {response.status_code} on attempt {attempt}")
        except Exception as exc:
            print(f"[API] Reset error on attempt {attempt}: {exc}")
        time.sleep(2)
    return False


def push_telemetry_loop():
    while True:
        try:
            if current_latitude is not None and current_longitude is not None:
                response = requests.post(
                    TELEMETRY_API_URL,
                    json={
                        "droneId": DRONE_ID,
                        "lat": current_latitude,
                        "lon": current_longitude,
                        "alt": current_altitude,
                    },
                    headers=api_headers(),
                    timeout=5,
                )
                if not response.ok:
                    print(f"[API] Telemetry push failed: {response.status_code} {response.text}")
        except Exception as exc:
            print(f"[API] Telemetry push error: {exc}")
        time.sleep(TELEMETRY_PUSH_INTERVAL)


def run_delivery_mission(delivery_lat, delivery_lng, delivery_alt=None):
    global mission_state, servo_state, home_lat, home_lon, current_target

    with mission_lock:
        mission_state = "starting"
        current_target = {"lat": delivery_lat, "lng": delivery_lng, "alt": delivery_alt}
        print(f"[MISSION] Starting mission to {delivery_lat:.7f}, {delivery_lng:.7f}")

        if vehicle.armed:
            print("[MISSION] Vehicle already armed, aborting new mission")
            mission_state = "idle"
            return

        if not vehicle.is_armable:
            print("[MISSION] Vehicle not armable")
            mission_state = "idle"
            return

        home_lat = current_latitude
        home_lon = current_longitude
        if home_lat is None or home_lon is None:
            print("[MISSION] No GPS fix for home position")
            mission_state = "idle"
            return

        vehicle.mode = VehicleMode("GUIDED")
        if not wait_for_mode("GUIDED"):
            print("[MISSION] Failed to enter GUIDED")
            mission_state = "idle"
            return

        vehicle.armed = True
        arm_deadline = time.time() + 20
        while not vehicle.armed and time.time() < arm_deadline:
            time.sleep(0.5)

        if not vehicle.armed:
            print("[MISSION] Failed to arm")
            mission_state = "idle"
            return

        mission_state = "taking_off"
        vehicle.simple_takeoff(TAKEOFF_ALTITUDE)
        climb_deadline = time.time() + 45
        while time.time() < climb_deadline:
            if is_rc_active():
                abort_to_stabilize("RC override during takeoff")
                return
            altitude = current_altitude or 0.0
            print(f"[MISSION] Takeoff altitude={altitude:.1f}m target={TAKEOFF_ALTITUDE:.1f}m")
            if altitude >= TAKEOFF_ALTITUDE - 0.5:
                break
            time.sleep(1)
        else:
            print("[MISSION] Failed to reach takeoff altitude")
            vehicle.mode = VehicleMode("LAND")
            mission_state = "landing"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "flying_to_delivery"
        if not fly_to_and_wait(delivery_lat, delivery_lng, TAKEOFF_ALTITUDE, "delivery point"):
            if mission_state != "aborted":
                vehicle.mode = VehicleMode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "descending"
        if not change_altitude_and_wait(DESCENT_ALTITUDE, "delivery descent"):
            if mission_state != "aborted":
                vehicle.mode = VehicleMode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        servo_state = "active"
        set_servo(5, 1000)
        servo_state = "off"
        if not rc_safe_sleep(2, "payload drop"):
            return

        reset_api()

        mission_state = "climbing"
        if not change_altitude_and_wait(TAKEOFF_ALTITUDE, "post-drop climb"):
            if mission_state != "aborted":
                vehicle.mode = VehicleMode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "returning_home"
        vehicle.mode = VehicleMode("RTL")
        wait_for_disarm()

        servo_state = "active"
        set_servo(5, 2000)
        servo_state = "on"
        current_target = {"lat": delivery_lat, "lng": delivery_lng, "alt": delivery_alt}
        mission_state = "complete"
        print("[MISSION] Mission complete")


def poll_mission_api():
    global mission_state, current_target
    print(f"[INFO] Polling mission API: {MISSION_API_URL}")

    while True:
        try:
            response = requests.get(MISSION_API_URL, headers={"x-api-key": API_KEY}, timeout=5)
            if not response.ok:
                print(f"[API] Mission poll returned {response.status_code}")
                time.sleep(POLL_INTERVAL)
                continue

            data = response.json()
            booked = bool(data.get("booked"))
            confirmed = bool(data.get("confirmed"))
            delivery_lat = data.get("deliveryLat")
            delivery_lng = data.get("deliveryLng")
            delivery_alt = data.get("deliveryAlt")

            if delivery_lat is not None and delivery_lng is not None:
                current_target = {"lat": delivery_lat, "lng": delivery_lng, "alt": delivery_alt}

            print(
                f"[API] booked={booked} confirmed={confirmed} "
                f"target=({delivery_lat}, {delivery_lng}) mission={mission_state}"
            )

            ready = mission_state in ("idle", "complete", "aborted")
            if booked and confirmed and ready:
                if delivery_lat is None or delivery_lng is None:
                    print("[API] Waiting for delivery coordinates before launch")
                else:
                    mission_state = "queued"
                    threading.Thread(
                        target=run_delivery_mission,
                        args=(float(delivery_lat), float(delivery_lng), delivery_alt),
                        daemon=True,
                    ).start()
        except Exception as exc:
            print(f"[API] Mission poll error: {exc}")

        time.sleep(POLL_INTERVAL)


@app.route("/telemetry")
def get_telemetry():
    return jsonify({
        "attitude": {"pitch": current_pitch, "roll": current_roll, "yaw": current_yaw},
        "altitude": current_altitude,
        "battery": {"voltage": current_voltage, "current": current_current, "level": current_level},
        "gps": {"latitude": current_latitude, "longitude": current_longitude},
        "home": {"latitude": home_lat, "longitude": home_lon},
        "delivery": current_target,
        "armed": vehicle.armed,
        "mode": vehicle.mode.name,
        "servo": servo_state,
        "mission": mission_state,
        "apiBaseUrl": API_BASE_URL,
    })


@app.route("/mission/abort", methods=["POST"])
def abort_mission_route():
    abort_to_stabilize("Manual abort via Flask endpoint")
    return jsonify({"message": "Mission aborted", "mission": mission_state})


if __name__ == "__main__":
    try:
        threading.Thread(target=poll_mission_api, daemon=True).start()
        threading.Thread(target=push_telemetry_loop, daemon=True).start()

        print("[INFO] Server    -> http://0.0.0.0:5001")
        print("[INFO] Telemetry -> /telemetry")
        print("[INFO] Abort     -> POST /mission/abort")
        app.run(host="0.0.0.0", port=5001)
    except KeyboardInterrupt:
        print("[INFO] Interrupted, disarming and closing vehicle")
        vehicle.armed = False
        time.sleep(2)
        vehicle.close()
