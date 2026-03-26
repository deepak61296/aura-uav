import React, { useEffect, useRef, useState } from "react"
import Map from "../components/Map"
import ArtificialHorizon from "../components/ArtificialHorizon"
import TelemetryPanel from "../components/TelemetryPanel"
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
  } catch { /* silent */ }
}

const normalizeBrowserLocation = (position) => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  altitude: position.coords.altitude,
})

const hasValidDroneFix = (telemetry) =>
  Boolean(telemetry?.gpsFixType >= 3 && telemetry?.gps?.latitude && telemetry?.gps?.longitude)

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
  const [telemetry, setTelemetry] = useState(null)
  const [toast, setToast] = useState(null)
  const [opsLoading, setOpsLoading] = useState(false)
  const [backendOnline, setBackendOnline] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const lastLocationKeyRef = useRef(null)
  const syncLockRef = useRef(null)

  const showToast = (msg, type = "error") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  /* ── Geolocation ── */
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

  /* ── Polling ── */
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
      setTelemetry(data)
      if (hasValidDroneFix(data)) {
        setDroneLocation({ lat: data.gps.latitude, lng: data.gps.longitude })
      }
      setMissionState(data?.mission || "idle")
    } catch { /* silent */ }
  }

  const fetchSimStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/sim/status`, { headers: { "x-api-key": API_KEY } })
      if (!res.ok) return
      const data = await res.json()
      setSimStatus(data)
    } catch { /* silent */ }
  }

  const fetchDashboard = async () => {
    await Promise.all([fetchStatus(), fetchControllerTelemetry(), fetchSimStatus()])
  }

  /* ── Sim Controls ── */
  const handleSimulationReset = async () => {
    if (!backendOnline) { showToast("Server is offline."); return }
    setOpsLoading(true)
    try {
      const res = await fetch(`${API_URL}/sim/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ droneId: DRONE_ID, lat: userLocation?.lat || 0, lng: userLocation?.lng || 0, alt: userLocation?.altitude || 0 }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Reset failed") }
      setShowPath(false); setMissionState("idle"); setDroneLocation(null)
      showToast("Simulation restarting…", "info")
      await fetchDashboard()
    } catch (err) { showToast(err.message || "Reset failed") }
    finally { setOpsLoading(false) }
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
      if (!res.ok) throw new Error("Start failed")
      showToast("Simulation starting…", "info")
      await fetchDashboard()
    } catch (err) { showToast(err.message || "Start failed") }
    finally { setOpsLoading(false) }
  }

  const handleSimulationStop = async () => {
    if (!backendOnline) { showToast("Server is offline."); return }
    setOpsLoading(true)
    try {
      const res = await fetch(`${API_URL}/sim/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      })
      if (!res.ok) throw new Error("Stop failed")
      showToast("Simulation stopped", "info")
      await fetchDashboard()
    } catch (err) { showToast(err.message || "Stop failed") }
    finally { setOpsLoading(false) }
  }

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 1500)
    return () => clearInterval(interval)
  }, [])

  const att = telemetry?.attitude || {}

  return (
    <div className="relative h-screen w-full bg-[#0f1117] overflow-hidden flex">
      {/* ════════ Left: Instruments Sidebar ════════ */}
      <div
        className={`flex-shrink-0 transition-all duration-300 bg-[#161922] border-r border-white/5 flex flex-col overflow-y-auto ${
          sidebarOpen ? "w-[310px]" : "w-0"
        }`}
      >
        {sidebarOpen && (
          <div className="p-4 flex flex-col gap-5 min-w-[310px]">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h1 className="text-sm font-bold text-white tracking-wider uppercase">Admin Dashboard</h1>
              <div className={`w-2 h-2 rounded-full ${backendOnline ? "bg-emerald-400" : "bg-rose-500"} animate-pulse`} />
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <div className={`w-2 h-2 rounded-full ${backendOnline ? "bg-emerald-400" : "bg-rose-500"}`} />
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                {backendOnline ? "Connected to Backend" : "Server Offline"}
              </span>
            </div>

            {/* Artificial Horizon */}
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2 ml-1">Attitude Indicator</div>
              <ArtificialHorizon pitch={att.pitch || 0} roll={att.roll || 0} />
              <div className="flex justify-between mt-2 px-2">
                <span className="text-[9px] text-slate-500 font-mono">P {(att.pitch || 0).toFixed(1)}°</span>
                <span className="text-[9px] text-slate-500 font-mono">R {(att.roll || 0).toFixed(1)}°</span>
                <span className="text-[9px] text-slate-500 font-mono">Y {(((att.yaw || 0) % 360 + 360) % 360).toFixed(0)}°</span>
              </div>
            </div>

            {/* Telemetry */}
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2 ml-1">Flight Data</div>
              <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                <TelemetryPanel telemetry={telemetry} />
              </div>
            </div>

            {/* Health Badges */}
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2 ml-1">System Health</div>
              <div className="grid grid-cols-2 gap-2">
                <HealthBadge label="SITL" ok={simStatus?.sitl?.running} />
                <HealthBadge label="Controller" ok={simStatus?.controllerReady} />
                <HealthBadge label="GPS Lock" ok={simStatus?.gpsReady} />
                <HealthBadge label="Armed" ok={telemetry?.armed} color="rose" />
              </div>
            </div>

            {/* Mission State */}
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800 border border-slate-700">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Mission</span>
              <span className="text-xs text-white font-bold uppercase tracking-wider ml-auto">
                {missionBadgeLabel(missionState)}
              </span>
            </div>

            {/* Ops Panel */}
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2 ml-1">Operations</div>
              <div className="flex flex-col gap-2">
                <button onClick={handleSimulationStart} disabled={opsLoading}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-xs font-bold text-white transition">
                  ▶ Start Simulation
                </button>
                <button onClick={handleSimulationReset} disabled={opsLoading}
                  className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2.5 text-xs font-bold text-white transition">
                  ↻ Restart Drone
                </button>
                <button onClick={handleSimulationStop} disabled={opsLoading}
                  className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-4 py-2.5 text-xs font-bold text-white transition">
                  ■ Stop Simulation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════ Sidebar Toggle ════════ */}
      <button
        onClick={() => setSidebarOpen(s => !s)}
        className="absolute top-3 z-[10002] bg-slate-800 text-white w-7 h-7 rounded-full flex items-center justify-center border border-slate-600 hover:bg-slate-700 transition shadow-lg text-xs"
        style={{ left: sidebarOpen ? 296 : 8 }}
      >
        {sidebarOpen ? "◀" : "▶"}
      </button>

      {/* ════════ Right: Map ════════ */}
      <div className="flex-1 relative">
        <Map
          droneLocation={droneLocation}
          userLocation={userLocation}
          showPath={showPath}
          mapStyle={mapStyle}
          homeLocation={simStatus?.telemetry?.home?.latitude ? { lat: simStatus.telemetry.home.latitude, lng: simStatus.telemetry.home.longitude } : null}
          deliveryLocation={simStatus?.telemetry?.delivery?.lat ? { lat: simStatus.telemetry.delivery.lat, lng: simStatus.telemetry.delivery.lng } : null}
          missionState={missionState}
        />

        {/* Map style toggle */}
        <div className="absolute top-5 right-5 z-[10001]">
          <div className="inline-flex rounded-full border border-white/20 bg-slate-900/80 p-1 shadow-card backdrop-blur">
            <button type="button" onClick={() => setMapStyle("standard")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${mapStyle === "standard" ? "bg-white text-slate-900" : "text-slate-300"}`}>
              Map
            </button>
            <button type="button" onClick={() => setMapStyle("satellite")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${mapStyle === "satellite" ? "bg-white text-slate-900" : "text-slate-300"}`}>
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
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[20000] px-5 py-3 rounded-xl shadow-xl text-sm font-semibold ${
          toast.type === "info" ? "bg-slate-900 text-white" : "bg-rose-600 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

const HealthBadge = ({ label, ok, color = "emerald" }) => (
  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
    ok
      ? `bg-${color}-500/10 border-${color}-500/20`
      : "bg-slate-800 border-slate-700"
  }`}>
    <div className={`w-1.5 h-1.5 rounded-full ${ok ? `bg-${color}-400` : "bg-slate-600"}`} />
    <span className={`text-[10px] font-bold uppercase tracking-wider ${ok ? `text-${color}-400` : "text-slate-500"}`}>
      {label}
    </span>
  </div>
)

export default Admin
