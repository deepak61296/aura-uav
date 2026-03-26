import React, { useEffect, useRef, useState } from "react"
import Map from "../components/Map"
import { API_KEY, API_URL, CONTROLLER_URL, DRONE_ID } from "../config/api"

const pushLocation = async (location) => {
  try {
    await fetch(`${API_URL}/drone/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        droneId: DRONE_ID,
        currentLat: location.lat,
        currentLng: location.lng,
        currentAlt: location.altitude,
      }),
    })
  } catch (error) {
    console.error("Location sync error:", error)
  }
}

const normalizeBrowserLocation = (position) => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  altitude: position.coords.altitude,
})

const hasValidDroneFix = (telemetry) =>
  Boolean(
    telemetry?.gpsFixType >= 3
      && telemetry?.gps?.latitude
      && telemetry?.gps?.longitude
  )

const missionBadgeLabel = (mission) => {
  if (!mission || mission === "idle") return "Idle"
  return mission.replaceAll("_", " ")
}

const Admin = () => {
  const [userLocation, setUserLocation] = useState(null)
  const [droneLocation, setDroneLocation] = useState(null)
  const [showPath, setShowPath] = useState(false)
  const [missionState, setMissionState] = useState("idle")
  const [mapStyle, setMapStyle] = useState("standard")
  const [simStatus, setSimStatus] = useState(null)
  const [toast, setToast] = useState(null)
  const [opsLoading, setOpsLoading] = useState(false)
  const [backendOnline, setBackendOnline] = useState(true)
  const lastLocationKeyRef = useRef(null)
  const syncLockRef = useRef(null)

  const showToast = (msg, type = "error") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) return undefined

    const onPosition = (position) => {
      const location = normalizeBrowserLocation(position)
      const key = `${location.lat.toFixed(6)}:${location.lng.toFixed(6)}`
      setUserLocation(location)
      if (lastLocationKeyRef.current !== key) {
        lastLocationKeyRef.current = key
        void pushLocation(location)
      }
    }

    const onError = (error) => console.error("Location Error:", error)
    navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
    const watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 })
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const fetchStatus = async () => {
    if (syncLockRef.current) return
    try {
      const res = await fetch(`${API_URL}/drone/${DRONE_ID}`, { headers: { "x-api-key": API_KEY } })
      const data = await res.json()
      setBackendOnline(true)
      if (data) setShowPath(Boolean(data.booked || data.confirmed))
    } catch {
      setBackendOnline(false)
    }
  }

  const fetchControllerTelemetry = async () => {
    try {
      const res = await fetch(`${CONTROLLER_URL}/telemetry`)
      if (!res.ok) return
      const data = await res.json()
      if (hasValidDroneFix(data)) {
        setDroneLocation({ lat: data.gps.latitude, lng: data.gps.longitude })
      }
      setMissionState(data?.mission || "idle")
    } catch {
      /* silent — controller may not be running yet */
    }
  }

  const fetchSimStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/sim/status`, { headers: { "x-api-key": API_KEY } })
      if (!res.ok) return
      const data = await res.json()
      setSimStatus(data)
    } catch {
      /* silent */
    }
  }

  const fetchDashboard = async () => {
    await Promise.all([fetchStatus(), fetchControllerTelemetry(), fetchSimStatus()])
  }

  const handleSimulationReset = async () => {
    if (!backendOnline) { showToast("Server is offline."); return }
    setOpsLoading(true)
    try {
      const res = await fetch(`${API_URL}/sim/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({
          droneId: DRONE_ID,
          lat: userLocation?.lat || 0,
          lng: userLocation?.lng || 0,
          alt: userLocation?.altitude || 0,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Simulation reset failed")
      }
      setShowPath(false)
      setMissionState("idle")
      setDroneLocation(null)
      showToast("Simulation restarting…", "info")
      await fetchDashboard()
    } catch (err) {
      console.error("Simulation reset failed:", err)
      showToast(err.message || "Simulation reset failed")
    } finally {
      setOpsLoading(false)
    }
  }

  const handleSimulationStart = async () => {
    if (!backendOnline) { showToast("Server is offline."); return }
    setOpsLoading(true)
    try {
      const res = await fetch(`${API_URL}/sim/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ droneId: DRONE_ID }),
      })
      if (!res.ok) throw new Error("Simulation start failed")
      showToast("Simulation starting…", "info")
      await fetchDashboard()
    } catch (err) {
      console.error(err)
      showToast(err.message || "Failed to start simulation")
    } finally {
      setOpsLoading(false)
    }
  }

  const handleSimulationStop = async () => {
    if (!backendOnline) { showToast("Server is offline."); return }
    setOpsLoading(true)
    try {
      const res = await fetch(`${API_URL}/sim/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      })
      if (!res.ok) throw new Error("Simulation stop failed")
      showToast("Simulation stopped", "info")
      await fetchDashboard()
    } catch (err) {
      console.error(err)
      showToast(err.message || "Failed to stop simulation")
    } finally {
      setOpsLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative h-screen w-full bg-[#f8fafc] overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Map
          droneLocation={droneLocation}
          userLocation={userLocation}
          showPath={showPath}
          mapStyle={mapStyle}
          homeLocation={simStatus?.telemetry?.home?.latitude ? { lat: simStatus.telemetry.home.latitude, lng: simStatus.telemetry.home.longitude } : null}
          deliveryLocation={simStatus?.telemetry?.delivery?.lat ? { lat: simStatus.telemetry.delivery.lat, lng: simStatus.telemetry.delivery.lng } : null}
          missionState={missionState}
        />
      </div>

      <div className="absolute top-5 right-5 z-[10001]">
        <div className="inline-flex rounded-full border border-white/70 bg-white/90 p-1 shadow-card backdrop-blur">
          <button
            type="button"
            onClick={() => setMapStyle("standard")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              mapStyle === "standard" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Map
          </button>
          <button
            type="button"
            onClick={() => setMapStyle("satellite")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              mapStyle === "satellite" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Satellite
          </button>
        </div>
      </div>

      {/* Offline Banner */}
      {!backendOnline && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-[10002] bg-rose-600 text-white px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider">Server Offline</span>
        </div>
      )}

      <div className="absolute top-5 left-5 z-[10001] flex flex-wrap gap-2 max-w-[60vw]">
        <StatusPill
          label="Drone Link"
          value={simStatus?.sitl?.running ? "Running" : "Offline"}
          tone={simStatus?.sitl?.running ? "good" : "bad"}
        />
        <StatusPill
          label="Controller"
          value={simStatus?.controllerReady ? "Ready" : "Starting"}
          tone={simStatus?.controllerReady ? "good" : (simStatus?.warmupTimedOut ? "bad" : "warn")}
        />
        <StatusPill
          label="GPS"
          value={simStatus?.gpsReady ? "Locked" : (simStatus?.warmupTimedOut ? "Timeout" : "Warming")}
          tone={simStatus?.gpsReady ? "good" : (simStatus?.warmupTimedOut ? "bad" : "warn")}
        />
        <StatusPill
          label="Mission"
          value={missionBadgeLabel(simStatus?.telemetry?.mission)}
          tone={simStatus?.telemetry?.mission && simStatus.telemetry.mission !== "idle" ? "warn" : "good"}
        />
        <StatusPill
          label="Battery"
          value={simStatus?.telemetry?.battery?.level != null ? `${simStatus.telemetry.battery.level}%` : "--"}
          tone={simStatus?.telemetry?.battery?.level > 20 ? "good" : (simStatus?.telemetry?.battery?.level > 0 ? "bad" : "warn")}
        />
        <StatusPill
          label="Flight Mode"
          value={simStatus?.telemetry?.mode || "UNKNOWN"}
          tone={simStatus?.telemetry?.mode && simStatus.telemetry.mode !== "UNKNOWN" ? "good" : "warn"}
        />
      </div>

      <div className="absolute bottom-5 right-5 z-[10001] flex flex-col gap-2 p-3 bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-card">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 ml-1">Ops Panel</div>
        <button
          type="button"
          onClick={handleSimulationStart}
          disabled={opsLoading}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 text-left disabled:opacity-50"
        >
          Start Sim
        </button>
        <button
          type="button"
          onClick={handleSimulationReset}
          disabled={opsLoading}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 text-left disabled:opacity-50"
        >
          Restart Drone Simulation
        </button>
        <button
          type="button"
          onClick={handleSimulationStop}
          disabled={opsLoading}
          className="rounded-full border border-rose-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 text-left disabled:opacity-50"
        >
          Stop Sim
        </button>
      </div>

      {missionState && missionState !== "idle" && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[10001] bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center justify-between min-w-[300px]">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Mission Status</div>
          <div className="text-sm font-bold uppercase tracking-wider">{missionBadgeLabel(missionState)}</div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[20000] px-5 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all ${
          toast.type === "info" ? "bg-slate-900 text-white" : "bg-rose-600 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

const toneClasses = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-rose-50 text-rose-700 border-rose-200",
}

const StatusPill = ({ label, value, tone }) => (
  <div className={`rounded-full border px-3 py-2 shadow-card backdrop-blur ${toneClasses[tone]}`}>
    <div className="text-[9px] font-bold uppercase tracking-[0.22em] opacity-70">{label}</div>
    <div className="text-xs font-semibold">{value}</div>
  </div>
)

export default Admin
