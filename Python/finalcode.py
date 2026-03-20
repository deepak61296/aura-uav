import math
import os
import threading
import time

import requests
from flask import Flask, jsonify
from flask_cors import CORS
from pymavlink import mavutil

DRONE_ID = os.getenv("DRONE_ID", "DRONE001")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:5000")
API_KEY = os.getenv("API_KEY", "SUPER_SECRET_KEY")
VEHICLE_CONNECTION = os.getenv("VEHICLE_CONNECTION", "udp:127.0.0.1:14550")
CONTROLLER_PORT = int(os.getenv("CONTROLLER_PORT", "5001"))
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2"))
TELEMETRY_PUSH_INTERVAL = float(os.getenv("TELEMETRY_PUSH_INTERVAL", "1"))
TAKEOFF_ALTITUDE = float(os.getenv("TAKEOFF_ALTITUDE", "5"))
DESCENT_ALTITUDE = float(os.getenv("DESCENT_ALTITUDE", "2"))
WAYPOINT_RADIUS = float(os.getenv("WAYPOINT_RADIUS", "2"))
DROP_HOVER_SECONDS = float(os.getenv("DROP_HOVER_SECONDS", "4"))
DROP_RELEASE_SECONDS = float(os.getenv("DROP_RELEASE_SECONDS", "3"))
RESET_RETRY_COUNT = int(os.getenv("RESET_RETRY_COUNT", "8"))

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
current_mode = "UNKNOWN"
is_armed = False
gps_fix_type = 0
rc_channels = {}

state_lock = threading.Lock()
mission_lock = threading.Lock()
send_lock = threading.Lock()

app = Flask(__name__)
CORS(app)

print(f"[INFO] Connecting to vehicle on {VEHICLE_CONNECTION}")
master = mavutil.mavlink_connection(VEHICLE_CONNECTION)
master.wait_heartbeat(timeout=120)
print(
    f"[INFO] Heartbeat from system={master.target_system} component={master.target_component}"
)

mode_mapping = master.mode_mapping() or {}
mode_mapping_inverse = {value: key for key, value in mode_mapping.items()}


def api_headers():
    return {"x-api-key": API_KEY, "Content-Type": "application/json"}


def normalized_mode_name():
    with state_lock:
        return current_mode


def send_command_long(command, params):
    padded = list(params) + [0] * (7 - len(params))
    with send_lock:
        master.mav.command_long_send(
            master.target_system,
            master.target_component,
            command,
            0,
            *padded[:7],
        )


def set_servo(servo_num, pwm_value):
    try:
        print(f"[SERVO] {servo_num} -> {pwm_value}")
        send_command_long(
            mavutil.mavlink.MAV_CMD_DO_SET_SERVO,
            [servo_num, pwm_value],
        )
    except Exception as exc:
        print(f"[SERVO] command failed: {exc}")


def request_message_streams():
    try:
        with send_lock:
            master.mav.request_data_stream_send(
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_ALL,
                10,
                1,
            )
    except Exception as exc:
        print(f"[LINK] data stream request failed: {exc}")


def telemetry_reader_loop():
    global current_pitch, current_roll, current_yaw
    global current_altitude, current_latitude, current_longitude
    global current_voltage, current_current, current_level
    global current_mode, is_armed, gps_fix_type, rc_channels

    while True:
        try:
            msg = master.recv_match(blocking=True, timeout=1)
            if msg is None:
                continue

            msg_type = msg.get_type()
            with state_lock:
                if msg_type == "HEARTBEAT":
                    current_mode = mode_mapping_inverse.get(msg.custom_mode, "UNKNOWN")
                    is_armed = bool(
                        msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
                    )
                elif msg_type == "ATTITUDE":
                    current_pitch = round(math.degrees(msg.pitch), 2)
                    current_roll = round(math.degrees(msg.roll), 2)
                    current_yaw = round(math.degrees(msg.yaw), 2)
                elif msg_type == "GLOBAL_POSITION_INT":
                    current_latitude = round(msg.lat / 1e7, 7)
                    current_longitude = round(msg.lon / 1e7, 7)
                    current_altitude = round(msg.relative_alt / 1000.0, 2)
                elif msg_type == "SYS_STATUS":
                    current_voltage = round(msg.voltage_battery / 1000.0, 2)
                    current_current = (
                        round(msg.current_battery / 100.0, 2)
                        if msg.current_battery != -1
                        else None
                    )
                    current_level = msg.battery_remaining if msg.battery_remaining != -1 else None
                elif msg_type == "GPS_RAW_INT":
                    gps_fix_type = msg.fix_type
                elif msg_type == "RC_CHANNELS":
                    rc_channels = {
                        "1": getattr(msg, "chan1_raw", None),
                        "2": getattr(msg, "chan2_raw", None),
                        "4": getattr(msg, "chan4_raw", None),
                    }
        except Exception as exc:
            print(f"[LINK] telemetry reader error: {exc}")
            time.sleep(1)


def haversine_distance(lat1, lon1, lat2, lon2):
    radius = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_rc_active():
    with state_lock:
        channels = dict(rc_channels)

    for channel in ("1", "2", "4"):
        pwm = channels.get(channel)
        if pwm and abs(pwm - 1500) > 100:
            return True
    return False


def has_position_fix():
    with state_lock:
        return (
            current_latitude is not None
            and current_longitude is not None
            and gps_fix_type >= 3
        )


def is_vehicle_armed():
    with state_lock:
        return is_armed


def set_mode(name):
    if name not in mode_mapping:
        raise RuntimeError(f"Unsupported flight mode: {name}")

    with send_lock:
        master.set_mode(mode_mapping[name])


def wait_for_mode(name, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if normalized_mode_name() == name:
            return True
        time.sleep(0.5)
    return False


def arm_vehicle(timeout=20):
    send_command_long(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        [1],
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_vehicle_armed():
            return True
        time.sleep(0.5)
    return False


def disarm_vehicle(timeout=10):
    send_command_long(
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        [0],
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_vehicle_armed():
            return True
        time.sleep(0.5)
    return False


def send_position_target(lat, lon, alt):
    with send_lock:
        master.mav.set_position_target_global_int_send(
            0,
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            int(
                mavutil.mavlink.POSITION_TARGET_TYPEMASK_VX_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_VY_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_VZ_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AX_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AY_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AZ_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_YAW_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE
            ),
            int(lat * 1e7),
            int(lon * 1e7),
            alt,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        )


def start_takeoff(altitude):
    send_command_long(
        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
        [0, 0, 0, 0, 0, 0, altitude],
    )


def abort_to_stabilize(reason="RC override"):
    global mission_state
    print(f"[ABORT] {reason}")
    try:
        set_mode("STABILIZE")
    except Exception as exc:
        print(f"[ABORT] failed to enter STABILIZE: {exc}")
    mission_state = "aborted"


def rc_safe_sleep(seconds, phase_name=""):
    for _ in range(max(1, int(seconds / 0.5))):
        if is_rc_active():
            abort_to_stabilize(f"RC override during {phase_name}")
            return False
        time.sleep(0.5)
    return True


def fly_to_and_wait(lat, lon, alt, label, timeout=180):
    print(f"[MISSION] Flying to {label}: {lat:.7f}, {lon:.7f} @ {alt}m")
    deadline = time.time() + timeout

    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override while flying to {label}")
            return False

        send_position_target(lat, lon, alt)

        with state_lock:
            cur_lat = current_latitude
            cur_lon = current_longitude
            cur_alt = current_altitude or 0.0

        if cur_lat is not None and cur_lon is not None:
            distance = haversine_distance(cur_lat, cur_lon, lat, lon)
            print(f"[MISSION] {label} distance={distance:.1f}m altitude={cur_alt:.1f}m")
            if distance <= WAYPOINT_RADIUS:
                return True

        time.sleep(1)

    print(f"[MISSION] Timed out before reaching {label}")
    return False


def change_altitude_and_wait(new_alt, label, timeout=30):
    with state_lock:
        cur_lat = current_latitude
        cur_lon = current_longitude

    if cur_lat is None or cur_lon is None:
        print(f"[MISSION] Cannot change altitude for {label}: no GPS fix")
        return False

    deadline = time.time() + timeout

    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override during {label}")
            return False

        send_position_target(cur_lat, cur_lon, new_alt)

        with state_lock:
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
        if not is_vehicle_armed():
            return True
        time.sleep(1)
    return False


def reset_api():
    for attempt in range(1, RESET_RETRY_COUNT + 1):
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
            with state_lock:
                lat = current_latitude
                lon = current_longitude
                alt = current_altitude

            if lat is not None and lon is not None:
                response = requests.post(
                    TELEMETRY_API_URL,
                    json={
                        "droneId": DRONE_ID,
                        "lat": lat,
                        "lon": lon,
                        "alt": alt,
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

        if is_vehicle_armed():
            print("[MISSION] Vehicle already armed, aborting new mission")
            mission_state = "idle"
            return

        if not has_position_fix():
            print("[MISSION] Vehicle is not ready: no GPS fix")
            mission_state = "idle"
            return

        with state_lock:
            home_lat = current_latitude
            home_lon = current_longitude

        if home_lat is None or home_lon is None:
            print("[MISSION] No GPS fix for home position")
            mission_state = "idle"
            return

        set_mode("GUIDED")
        if not wait_for_mode("GUIDED"):
            print("[MISSION] Failed to enter GUIDED")
            mission_state = "idle"
            return

        if not arm_vehicle():
            print("[MISSION] Failed to arm")
            mission_state = "idle"
            return

        mission_state = "taking_off"
        start_takeoff(TAKEOFF_ALTITUDE)
        climb_deadline = time.time() + 45
        while time.time() < climb_deadline:
            if is_rc_active():
                abort_to_stabilize("RC override during takeoff")
                return

            with state_lock:
                altitude = current_altitude or 0.0

            print(f"[MISSION] Takeoff altitude={altitude:.1f}m target={TAKEOFF_ALTITUDE:.1f}m")
            if altitude >= TAKEOFF_ALTITUDE - 0.5:
                break
            time.sleep(1)
        else:
            print("[MISSION] Failed to reach takeoff altitude")
            set_mode("LAND")
            mission_state = "landing"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "flying_to_delivery"
        if not fly_to_and_wait(delivery_lat, delivery_lng, TAKEOFF_ALTITUDE, "delivery point"):
            if mission_state != "aborted":
                set_mode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "descending"
        if not change_altitude_and_wait(DESCENT_ALTITUDE, "delivery descent"):
            if mission_state != "aborted":
                set_mode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "holding_over_delivery"
        if not rc_safe_sleep(DROP_HOVER_SECONDS, "delivery hover"):
            return

        mission_state = "dropping_parcel"
        servo_state = "active"
        set_servo(5, 1000)
        servo_state = "off"
        if not rc_safe_sleep(DROP_RELEASE_SECONDS, "payload drop"):
            return

        mission_state = "climbing"
        if not change_altitude_and_wait(TAKEOFF_ALTITUDE, "post-drop climb"):
            if mission_state != "aborted":
                set_mode("RTL")
                mission_state = "returning_home"
            wait_for_disarm()
            mission_state = "idle"
            return

        mission_state = "returning_home"
        set_mode("RTL")
        wait_for_disarm()

        servo_state = "active"
        set_servo(5, 2000)
        servo_state = "on"
        current_target = {"lat": delivery_lat, "lng": delivery_lng, "alt": delivery_alt}
        mission_state = "complete"
        print("[MISSION] Mission complete")
        time.sleep(2)
        if not reset_api():
            mission_state = "reset_failed"
            print("[API] Reset failed after all retries")


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

            if not booked and not confirmed and mission_state == "complete":
                mission_state = "idle"
                current_target = {"lat": None, "lng": None, "alt": None}

            ready = mission_state in ("idle", "aborted")
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
    with state_lock:
        telemetry = {
            "attitude": {"pitch": current_pitch, "roll": current_roll, "yaw": current_yaw},
            "altitude": current_altitude,
            "battery": {"voltage": current_voltage, "current": current_current, "level": current_level},
            "gps": {"latitude": current_latitude, "longitude": current_longitude},
            "home": {"latitude": home_lat, "longitude": home_lon},
            "delivery": current_target,
            "armed": is_armed,
            "mode": current_mode,
            "servo": servo_state,
            "mission": mission_state,
            "apiBaseUrl": API_BASE_URL,
            "gpsFixType": gps_fix_type,
        }
    return jsonify(telemetry)


@app.route("/mission/abort", methods=["POST"])
def abort_mission_route():
    abort_to_stabilize("Manual abort via Flask endpoint")
    return jsonify({"message": "Mission aborted", "mission": mission_state})


if __name__ == "__main__":
    try:
        request_message_streams()
        threading.Thread(target=telemetry_reader_loop, daemon=True).start()
        threading.Thread(target=poll_mission_api, daemon=True).start()
        threading.Thread(target=push_telemetry_loop, daemon=True).start()

        try:
            set_mode("STABILIZE")
        except Exception as exc:
            print(f"[MODE] failed to set initial STABILIZE: {exc}")

        set_servo(5, 2000)
        servo_state = "on"

        print(f"[INFO] Server    -> http://0.0.0.0:{CONTROLLER_PORT}")
        print("[INFO] Telemetry -> /telemetry")
        print("[INFO] Abort     -> POST /mission/abort")
        app.run(host="0.0.0.0", port=CONTROLLER_PORT)
    except KeyboardInterrupt:
        print("[INFO] Interrupted, disarming and closing link")
        try:
            disarm_vehicle()
        except Exception:
            pass
