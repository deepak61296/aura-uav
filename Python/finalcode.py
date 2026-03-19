import cv2
import threading
import time
import math
import requests
from flask import Flask, Response, jsonify
from flask_cors import CORS
from dronekit import connect, VehicleMode, LocationGlobalRelative
from pymavlink import mavutil

# ===============================================================
#  DELIVERY CONFIG
# ===============================================================
DELIVERY_LAT      = 30.7685666   # target drop-off latitude
DELIVERY_LON      = 76.5768448  # target drop-off longitude
TAKEOFF_ALTITUDE  = 5.0          # metres — cruise/travel altitude
DESCENT_ALTITUDE  = 2.0          # metres — hover altitude at delivery point
WAYPOINT_RADIUS   = 2.0          # metres — "close enough" to waypoint

LANDING_LAT       = 30.7685839   # predefined landing pad latitude
LANDING_LON       = 76.5770003   # predefined landing pad longitude

DRONE_ID          = "DRONE001"
MISSION_API_URL   = f"https://aura-delivery-1.onrender.com/drone/{DRONE_ID}"
RESET_API_URL     = "https://aura-delivery-1.onrender.com/drone/reset"
POLL_INTERVAL     = 5            # seconds between API checks

# ===============================================================
#  RC OVERRIDE CONFIG
# ===============================================================
RC_OVERRIDE_THRESHOLD = 100               # µs deviation from neutral 1500
RC_WATCH_CHANNELS     = ["1", "2", "4"]  # Roll, Pitch, Yaw

# ===============================================================
#  VIDEO STREAMS
# ===============================================================
stream_url_1   = "rtsp://192.168.15.194:8554/cam"
stream_url_2   = "rtsp://192.168.15.237:8555/cam"
latest_frame_1 = None
latest_frame_2 = None

# ===============================================================
#  GLOBAL TELEMETRY
# ===============================================================
current_pitch = current_roll = current_yaw = 0.0
current_altitude  = 0.0
current_voltage   = current_current = current_level = 0
current_latitude  = current_longitude = None

# ===============================================================
#  MISSION STATE
# ===============================================================
# idle | starting | taking_off | flying_to_delivery
# descending | climbing | returning_home | landing | complete | aborted
mission_state = "idle"
mission_lock  = threading.Lock()
servo_state   = "idle"

home_lat = None
home_lon = None

# ===============================================================
#  FLASK
# ===============================================================
app = Flask(__name__)
CORS(app)

# ===============================================================
#  DRONE CONNECTION
# ===============================================================
print("🔌 Connecting to drone over WiFi (UDP 14550)...")
vehicle = connect('udp:0.0.0.0:14550', wait_ready=True)

print("🛠️  Setting mode to STABILIZE...")
vehicle.mode = VehicleMode("STABILIZE")
while vehicle.mode.name != "STABILIZE":
    print("   Waiting for STABILIZE...")
    time.sleep(1)
print("✅ Connected and in STABILIZE\n")

# ===============================================================
#  SERVO INIT — servo starts ON (2000 µs) at boot
# ===============================================================
def set_servo(servo_num, pwm_value):
    print(f"   👉 Servo {servo_num} → {pwm_value} µs")
    vehicle._master.mav.command_long_send(
        vehicle._master.target_system,
        vehicle._master.target_component,
        mavutil.mavlink.MAV_CMD_DO_SET_SERVO,
        0,
        servo_num, pwm_value,
        0, 0, 0, 0, 0
    )

print("🔧 Initialising servo → ON (2000 µs)...")
set_servo(5, 2000)   # servo starts ON at boot
servo_state = "on"

# ===============================================================
#  ATTRIBUTE LISTENERS
# ===============================================================
def attitude_listener(self, attr_name, value):
    global current_pitch, current_roll, current_yaw
    current_pitch = round(math.degrees(value.pitch), 2)
    current_roll  = round(math.degrees(value.roll),  2)
    current_yaw   = round(math.degrees(value.yaw),   2)

def location_listener(self, attr_name, value):
    global current_altitude, current_latitude, current_longitude
    current_altitude  = round(value.alt, 2) if value.alt else None
    current_latitude  = round(value.lat, 6) if value.lat else None
    current_longitude = round(value.lon, 6) if value.lon else None

def battery_listener(self, attr_name, value):
    global current_voltage, current_current, current_level
    current_voltage = round(value.voltage, 2) if value.voltage          else None
    current_current = round(value.current, 2) if value.current          else None
    current_level   = value.level             if value.level is not None else None

vehicle.add_attribute_listener('attitude',                        attitude_listener)
vehicle.add_attribute_listener('location.global_relative_frame', location_listener)
vehicle.add_attribute_listener('battery',                        battery_listener)


# ===============================================================
#  HELPERS
# ===============================================================
def is_rc_active():
    """True if pilot is moving any stick beyond threshold."""
    try:
        for ch in RC_WATCH_CHANNELS:
            pwm = vehicle.channels.get(ch)
            if pwm and abs(pwm - 1500) > RC_OVERRIDE_THRESHOLD:
                return True
    except Exception:
        pass
    return False


def haversine_distance(lat1, lon1, lat2, lon2):
    """Straight-line distance in metres between two GPS coords."""
    R       = 6371000
    phi1    = math.radians(lat1)
    phi2    = math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def abort_to_stabilize(reason="RC override"):
    """Immediately give control back to pilot."""
    global mission_state
    print(f"\n🕹️  {reason}")
    print("   ⚠️  Switching to STABILIZE — pilot has full control")
    vehicle.mode  = VehicleMode("STABILIZE")
    mission_state = "aborted"


def rc_safe_sleep(seconds, phase_name=""):
    """
    Sleep in 0.5s ticks, checking RC override each tick.
    Returns True if completed safely, False if aborted.
    """
    ticks = max(1, int(seconds / 0.5))
    for _ in range(ticks):
        if is_rc_active():
            abort_to_stabilize(f"RC override during {phase_name}")
            return False
        time.sleep(0.5)
    return True


def fly_to_and_wait(lat, lon, alt, label="waypoint", timeout=180):
    """
    Command drone to GPS location + altitude and wait until it arrives.
    Checks RC override every 0.5s.
    Returns True on arrival, False on RC override or timeout.
    """
    target = LocationGlobalRelative(lat, lon, alt)
    vehicle.simple_goto(target)
    print(f"   ✈️  Flying to {label}  ({lat:.6f}, {lon:.6f})  alt={alt} m")

    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override while flying to {label}")
            return False
        cur_lat = current_latitude  or 0.0
        cur_lon = current_longitude or 0.0
        dist    = haversine_distance(cur_lat, cur_lon, lat, lon)
        alt_now = current_altitude  or 0.0
        print(f"   📍 Dist to {label}: {dist:.1f} m  |  Alt: {alt_now:.1f} m")
        if dist <= WAYPOINT_RADIUS:
            print(f"   ✅ Reached {label}")
            return True
        time.sleep(0.5)

    print(f"   ⚠️  Timeout reaching {label}")
    return False


def change_altitude_and_wait(new_alt, label="", timeout=20):
    """
    Command altitude change while holding current XY, wait until reached.
    Returns True on success, False on RC override or timeout.
    """
    cur_lat = current_latitude  or 0.0
    cur_lon = current_longitude or 0.0
    print(f"   ↕️  {label or f'Changing altitude to {new_alt} m'}")
    vehicle.simple_goto(LocationGlobalRelative(cur_lat, cur_lon, new_alt))

    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize(f"RC override during {label or 'altitude change'}")
            return False
        alt = current_altitude or 0.0
        print(f"   ↕️  Alt: {alt:.1f} m  →  target: {new_alt} m")
        if abs(alt - new_alt) <= 0.4:
            print(f"   ✅ Altitude {new_alt} m reached")
            return True
        time.sleep(0.5)

    print(f"   ⚠️  Altitude change timeout")
    return False


def wait_for_disarm(timeout=90):
    """Wait for drone to land and auto-disarm. Checks RC override."""
    global mission_state
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_rc_active():
            abort_to_stabilize("RC override during final landing")
            return False
        if not vehicle.armed:
            print("   ✅ Disarmed — drone on ground")
            return True
        time.sleep(1)
    print("   ⚠️  Disarm timeout — check drone")
    return True


def reset_api():
    """
    POST /drone/reset → sets booked=false, confirmed=false.
    Called after delivery hover. Retries up to 3 times.
    """
    for attempt in range(1, 4):
        try:
            resp = requests.post(
                RESET_API_URL,
                json={"droneId": DRONE_ID},
                timeout=5
            )
            if resp.status_code == 200:
                print(f"[API] ✅ Reset done — booked=false, confirmed=false")
                return
            else:
                print(f"[API] Reset returned {resp.status_code} (attempt {attempt})")
        except Exception as e:
            print(f"[API] Reset failed (attempt {attempt}): {e}")
        time.sleep(2)
    print("[API] ⚠️  Could not reset after 3 attempts — reset manually if needed")


# ===============================================================
#  AUTONOMOUS DELIVERY MISSION
# ===============================================================
def run_delivery_mission():
    """
    Full flight sequence:

      ① Takeoff to 5 m
      ② Fly to delivery point  (DELIVERY_LAT, DELIVERY_LON)  at 5 m
      ③ Descend to 2 m  →  servo OFF (1000 µs)  →  hover 2 s
         → POST /reset  (booked=false, confirmed=false)
      ④ Climb back to 5 m
      ⑤ Fly back to home at 5 m
      ⑥ Land & disarm → STABILIZE  →  servo back ON (2000 µs)

    Servo default state: ON (2000 µs)
    Servo active/delivery state: OFF (1000 µs)

    RC input at ANY point instantly aborts to STABILIZE.
    """
    global mission_state, servo_state, home_lat, home_lon

    with mission_lock:

        # ── 0. Pre-flight safety checks ────────────────────────────────
        print("\n" + "="*55)
        print("  🚁 DELIVERY MISSION STARTING")
        print("="*55)

        if vehicle.armed:
            print("⚠️  Already armed — mission aborted for safety")
            mission_state = "idle"
            return

        if not vehicle.is_armable:
            print("⚠️  Not armable (GPS lock? pre-arm checks?) — aborted")
            mission_state = "idle"
            return

        # ── 1. Lock home position ───────────────────────────────────────
        home_lat = current_latitude
        home_lon = current_longitude
        if not home_lat or not home_lon:
            print("⚠️  No GPS fix — cannot store home, aborted")
            mission_state = "idle"
            return

        dist_total = haversine_distance(home_lat, home_lon, DELIVERY_LAT, DELIVERY_LON)
        print(f"📌 Home:     {home_lat:.6f}, {home_lon:.6f}")
        print(f"🎯 Delivery: {DELIVERY_LAT:.6f}, {DELIVERY_LON:.6f}")
        print(f"📏 Distance: {dist_total:.1f} m\n")

        # ── 2. Switch to GUIDED & arm ───────────────────────────────────
        vehicle.mode = VehicleMode("GUIDED")
        time.sleep(1)

        print("⚡ Arming motors...")
        vehicle.armed = True
        arm_timeout   = 15
        while not vehicle.armed and arm_timeout > 0:
            if is_rc_active():
                abort_to_stabilize("RC override during arming")
                return
            time.sleep(1)
            arm_timeout -= 1

        if not vehicle.armed:
            print("❌ Arming failed — aborted")
            mission_state = "idle"
            return

        # ── 3. ① Takeoff to 5 m ────────────────────────────────────────
        mission_state = "taking_off"
        print(f"\n📈 ① Taking off to {TAKEOFF_ALTITUDE} m...")
        vehicle.simple_takeoff(TAKEOFF_ALTITUDE)

        deadline = time.time() + 30
        reached  = False
        while time.time() < deadline:
            if is_rc_active():
                abort_to_stabilize("RC override during take-off")
                return
            alt = current_altitude or 0.0
            print(f"   Alt: {alt:.1f} m  /  target: {TAKEOFF_ALTITUDE} m")
            if alt >= TAKEOFF_ALTITUDE - 0.5:
                reached = True
                break
            time.sleep(0.5)

        if not reached:
            print("⚠️  Failed to reach takeoff altitude — landing")
            vehicle.mode  = VehicleMode("LAND")
            mission_state = "landing"
            wait_for_disarm()
            mission_state = "idle"
            return

        print(f"✅ Airborne at {current_altitude:.1f} m\n")

        # ── 4. ② Fly to delivery point at 5 m ──────────────────────────
        mission_state = "flying_to_delivery"
        print("🗺️  ② Flying to delivery point at 5 m...")
        arrived = fly_to_and_wait(
            DELIVERY_LAT, DELIVERY_LON, TAKEOFF_ALTITUDE,
            label="delivery point", timeout=180
        )
        if not arrived:
            if mission_state != "aborted":
                print("⚠️  Could not reach delivery — returning home")
                mission_state = "returning_home"
                fly_to_and_wait(home_lat, home_lon, TAKEOFF_ALTITUDE, label="home")
                vehicle.mode  = VehicleMode("LAND")
                mission_state = "landing"
                wait_for_disarm()
                mission_state = "idle"
            return

        if not rc_safe_sleep(2, "hover at delivery 5 m"):
            return

        # ── 5. ③ Descend to 2 m ─────────────────────────────────────────
        mission_state = "descending"
        print(f"\n⬇️  ③ Descending to {DESCENT_ALTITUDE} m...")
        if not change_altitude_and_wait(DESCENT_ALTITUDE, label=f"descend to {DESCENT_ALTITUDE} m"):
            if mission_state != "aborted":
                vehicle.mode  = VehicleMode("LAND")
                mission_state = "landing"
                wait_for_disarm()
                mission_state = "idle"
            return

        # Servo OFF (payload release) at delivery point
        if is_rc_active():
            abort_to_stabilize("RC override before servo")
            return

        print("   📦 Servo → OFF (1000 µs) — payload release")
        servo_state   = "active"
        mission_state = "servo_active"
        set_servo(5, 1000)   # OFF
        servo_state = "off"

        print(f"   ⏸️  Hovering at {DESCENT_ALTITUDE} m...")
        if not rc_safe_sleep(2, f"hover at {DESCENT_ALTITUDE} m"):
            return

        # Reset API right after delivery hover
        print("\n📡 Calling POST /reset → booked=false, confirmed=false...")
        reset_api()

        # ── 6. ④ Climb back to 5 m ──────────────────────────────────────
        mission_state = "climbing"
        print(f"\n⬆️  ④ Climbing back to {TAKEOFF_ALTITUDE} m...")
        if not change_altitude_and_wait(TAKEOFF_ALTITUDE, label=f"climb to {TAKEOFF_ALTITUDE} m"):
            if mission_state != "aborted":
                vehicle.mode  = VehicleMode("LAND")
                mission_state = "landing"
                wait_for_disarm()
                mission_state = "idle"
            return

        if not rc_safe_sleep(2, "hover after climb"):
            return

        # ── 7. ⑤ Return to home at 5 m ─────────────────────────────────
        if is_rc_active():
            abort_to_stabilize("RC override before RTH")
            return

        mission_state = "returning_home"
        print(f"\n🏠 ⑤ Flying to landing pad at {TAKEOFF_ALTITUDE} m...")
        print(f"   Landing pad: {LANDING_LAT:.6f}, {LANDING_LON:.6f}")
        arrived_home = fly_to_and_wait(
            LANDING_LAT, LANDING_LON, TAKEOFF_ALTITUDE,
            label="landing pad", timeout=180
        )
        if not arrived_home:
            if mission_state != "aborted":
                print("⚠️  Could not reach landing pad — landing in place")
                vehicle.mode  = VehicleMode("LAND")
                mission_state = "landing"
                wait_for_disarm()
                mission_state = "idle"
            return

        if not rc_safe_sleep(2, "landing pad hover"):
            return

        # ── 8. ⑥ Land at landing pad ────────────────────────────────────
        if is_rc_active():
            abort_to_stabilize("RC override before landing")
            return

        mission_state = "landing"
        print("\n🛬 ⑥ Landing at landing pad...")
        vehicle.mode = VehicleMode("LAND")
        wait_for_disarm()

        # Servo back ON after landing
        mission_state = "complete"
        vehicle.mode  = VehicleMode("STABILIZE")
        print("   🔧 Servo → back ON (2000 µs)")
        set_servo(5, 2000)
        servo_state = "on"

        print("\n" + "="*55)
        print("  ✅ DELIVERY MISSION COMPLETE")
        print("="*55 + "\n")


# ===============================================================
#  API POLLING
# ===============================================================
def poll_mission_api():
    global mission_state
    print(f"🌐 API polling active — every {POLL_INTERVAL}s")
    print(f"   {MISSION_API_URL}\n")

    while True:
        try:
            resp = requests.get(MISSION_API_URL, timeout=5)
            if resp.status_code == 200:
                data      = resp.json()
                booked    = data.get("booked",    False)
                confirmed = data.get("confirmed", False)

                print(f"[API] booked={booked}  confirmed={confirmed}  mission={mission_state}")

                if booked and confirmed and mission_state in ("idle", "complete", "aborted"):
                    print("[API] 🟢 Order confirmed — launching mission automatically!")
                    mission_state = "starting"
                    threading.Thread(target=run_delivery_mission, daemon=True).start()
            else:
                print(f"[API] Status {resp.status_code}")

        except requests.exceptions.RequestException as e:
            print(f"[API] Request error: {e}")
        except Exception as e:
            print(f"[API] Error: {e}")

        time.sleep(POLL_INTERVAL)


# ===============================================================
#  VIDEO CAPTURE
# ===============================================================
def capture_video(stream_url, camera_id):
    global latest_frame_1, latest_frame_2
    cap = cv2.VideoCapture(stream_url)
    while True:
        if not cap.isOpened():
            print(f"[CAM{camera_id}] Reconnecting...")
            cap.release()
            cap = cv2.VideoCapture(stream_url)
            time.sleep(2)
            continue
        ret, frame = cap.read()
        if not ret or frame is None:
            cap.release()
            cap = cv2.VideoCapture(stream_url)
            time.sleep(2)
            continue
        resized = cv2.resize(frame, (640, 360))
        if camera_id == 1:
            latest_frame_1 = resized
        else:
            latest_frame_2 = resized
        time.sleep(0.02)
    cap.release()


# ===============================================================
#  FLASK ROUTES
# ===============================================================
@app.route('/video_feed')
def video_feed():
    def generate():
        while True:
            if latest_frame_1 is not None:
                ret, buf = cv2.imencode('.jpg', latest_frame_1)
                if ret:
                    yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n'
            else:
                time.sleep(0.02)
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/video_feed2')
def video_feed2():
    def generate():
        while True:
            if latest_frame_2 is not None:
                ret, buf = cv2.imencode('.jpg', latest_frame_2)
                if ret:
                    yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n'
            else:
                time.sleep(0.02)
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/telemetry')
def get_telemetry():
    return jsonify({
        'attitude':  {'pitch': current_pitch, 'roll': current_roll, 'yaw': current_yaw},
        'altitude':  current_altitude,
        'battery':   {'voltage': current_voltage, 'current': current_current, 'level': current_level},
        'gps':       {'latitude': current_latitude,  'longitude': current_longitude},
        'home':      {'latitude': home_lat,           'longitude': home_lon},
        'delivery':  {'latitude': DELIVERY_LAT,       'longitude': DELIVERY_LON},
        'landing':   {'latitude': LANDING_LAT,        'longitude': LANDING_LON},
        'armed':     vehicle.armed,
        'mode':      vehicle.mode.name,
        'servo':     servo_state,
        'mission':   mission_state,
    })


@app.route('/servo', methods=['POST'])
def trigger_servo_route():
    """Manually toggle servo OFF then back ON."""
    def pulse():
        global servo_state
        servo_state = "active"
        set_servo(5, 1000)   # OFF
        time.sleep(1)
        set_servo(5, 2000)   # back ON
        servo_state = "on"
    threading.Thread(target=pulse, daemon=True).start()
    return jsonify({"message": "Servo triggered"})


@app.route('/mission/abort', methods=['POST'])
def abort_mission_route():
    """Emergency abort — switches to STABILIZE immediately."""
    abort_to_stabilize("Manual abort via ground station")
    return jsonify({"message": "Mission aborted — STABILIZE active", "mission": mission_state})


@app.route('/toggle-arm', methods=['PATCH'])
def toggle_arm():
    try:
        if vehicle.armed:
            vehicle.armed = False
            return jsonify({"armed": False, "message": "Disarmed", "mode": vehicle.mode.name})
        else:
            vehicle.armed = True
            t = 10
            while not vehicle.armed and t > 0:
                time.sleep(1); t -= 1
            if vehicle.armed:
                return jsonify({"armed": True,  "message": "Armed", "mode": vehicle.mode.name})
            return jsonify({"armed": False, "message": "Arm failed"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/arm', methods=['POST'])
def arm_drone():
    try:
        vehicle.armed = True
        return jsonify({"armed": vehicle.armed})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/disarm', methods=['POST'])
def disarm_drone():
    try:
        vehicle.armed = False
        return jsonify({"armed": vehicle.armed})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===============================================================
#  MAIN
# ===============================================================
if __name__ == '__main__':
    try:
        threading.Thread(target=capture_video,   args=(stream_url_1, 1), daemon=True).start()
        threading.Thread(target=capture_video,   args=(stream_url_2, 2), daemon=True).start()
        threading.Thread(target=poll_mission_api,                         daemon=True).start()

        print("[INFO] Server    → http://0.0.0.0:5001")
        print("[INFO] Cam 1     → /video_feed")
        print("[INFO] Cam 2     → /video_feed2")
        print("[INFO] Telemetry → /telemetry")
        print("[INFO] Abort     → POST /mission/abort\n")

        app.run(host='0.0.0.0', port=5001)

    except KeyboardInterrupt:
        print("\n🛑 Interrupted → disarming...")
        vehicle.armed = False
        time.sleep(2)
        vehicle.close()
        print("🔒 Disconnected safely")