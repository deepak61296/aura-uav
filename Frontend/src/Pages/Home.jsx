import React, { useEffect, useRef, useState } from "react"
import Map from "../components/Map"
import FloatingInfoCard from "../components/FloatingInfoCard"
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

const getBrowserLocation = () => new Promise((resolve, reject) => {
  if (!("geolocation" in navigator)) {
    reject(new Error("Geolocation is not supported in this browser."))
    return
  }

  navigator.geolocation.getCurrentPosition(
    (position) => resolve(normalizeBrowserLocation(position)),
    (error) => reject(error),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  )
})

const distanceMeters = (a, b) => {
  if (!a || !b) return null
  const earthRadius = 6371000
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const dLat = lat2 - lat1
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

const hasValidDroneFix = (telemetry) =>
  Boolean(
    telemetry?.gpsFixType >= 3
      && telemetry?.gps?.latitude
      && telemetry?.gps?.longitude
  )

const computeProgress = (telemetry) => {
  const mission = telemetry?.mission
  const gps = telemetry?.gps?.latitude != null && telemetry?.gps?.longitude != null
    ? { lat: telemetry.gps.latitude, lng: telemetry.gps.longitude }
    : null
  const home = telemetry?.home?.latitude != null && telemetry?.home?.longitude != null
    ? { lat: telemetry.home.latitude, lng: telemetry.home.longitude }
    : null
  const delivery = telemetry?.delivery?.lat != null && telemetry?.delivery?.lng != null
    ? { lat: telemetry.delivery.lat, lng: telemetry.delivery.lng }
    : null

  if (mission === "taking_off") return 8
  if (mission === "flying_to_delivery" && gps && home && delivery) {
    const total = distanceMeters(home, delivery)
    const remaining = distanceMeters(gps, delivery)
    if (total && remaining != null) {
      return Math.max(12, Math.min(74, Math.round(12 + (1 - remaining / total) * 62)))
    }
    return 35
  }
  if (mission === "descending") return 78
  if (mission === "holding_over_delivery") return 82
  if (mission === "dropping_parcel") return 86
  if (mission === "climbing") return 88
  if (mission === "returning_home" && gps && home && delivery) {
    const total = distanceMeters(delivery, home)
    const remaining = distanceMeters(gps, home)
    if (total && remaining != null) {
      return Math.max(90, Math.min(99, Math.round(90 + (1 - remaining / total) * 9)))
    }
    return 94
  }
  if (mission === "complete") return 100
  if (mission === "reset_failed") return 100
  return 0
}

const Home = () => {
  const [userLocation, setUserLocation] = useState(null)
  const [droneLocation, setDroneLocation] = useState(null)
  const [booked, setBooked] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showPath, setShowPath] = useState(false)
  const [missionState, setMissionState] = useState("idle")
  const [mapStyle, setMapStyle] = useState("satellite")
  const [simStatus, setSimStatus] = useState(null)
  const syncLockRef = useRef(null)
  const lastLocationKeyRef = useRef(null)

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return undefined
    }

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
      const res = await fetch(`${API_URL}/drone/${DRONE_ID}`, {
        headers: { "x-api-key": API_KEY }
      })
      const data = await res.json()
      if (data) {
        setBooked(Boolean(data.booked))
        setConfirmed(Boolean(data.confirmed))
        setShowPath(Boolean(data.booked || data.confirmed))
      }
    } catch (err) {
      console.error("Status fetch error:", err)
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
      setProgress(computeProgress(data))
    } catch (err) {
      console.error("Controller telemetry error:", err)
    }
  }

  const fetchSimStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/sim/status`, {
        headers: { "x-api-key": API_KEY }
      })
      if (!res.ok) return
      const data = await res.json()
      setSimStatus(data)
    } catch (err) {
      console.error("Sim status error:", err)
    }
  }

  const fetchDashboard = async () => {
    await Promise.all([fetchStatus(), fetchControllerTelemetry(), fetchSimStatus()])
  }

  const handleAction = async (type) => {
    let payload = { droneId: DRONE_ID }

    if (type === "confirm") {
      try {
        const latestLocation = userLocation || await getBrowserLocation()
        setUserLocation(latestLocation)
        await pushLocation(latestLocation)
        payload = {
          ...payload,
          deliveryLat: latestLocation.lat,
          deliveryLng: latestLocation.lng,
          deliveryAlt: latestLocation.altitude,
        }
      } catch (err) {
        console.error("Confirm location error:", err)
        window.alert("Location access is required before you confirm the delivery.")
        return
      }
    }

    setLoading(true)
    const safetyTimer = setTimeout(() => setLoading(false), 6000)

    if (syncLockRef.current) clearTimeout(syncLockRef.current)
    syncLockRef.current = setTimeout(() => {
      syncLockRef.current = null
    }, 3000)

    let endpoint = ""
    if (type === "book") endpoint = "/drone/book"
    if (type === "confirm") endpoint = "/drone/confirm"
    if (type === "reset") endpoint = "/drone/reset"

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `${type} request failed`)
      }

      if (type === "book") {
        setBooked(true)
        setProgress(0)
      }
      if (type === "confirm") {
        setBooked(true)
        setConfirmed(true)
        setShowPath(true)
      }
      if (type === "reset") {
        setBooked(false)
        setConfirmed(false)
        setShowPath(false)
        setProgress(0)
        setMissionState("idle")
      }

      await fetchDashboard()
    } catch (err) {
      console.error(`${type} action failed:`, err)
      window.alert(err.message || "Action failed")
    } finally {
      clearTimeout(safetyTimer)
      setLoading(false)
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

      <div className="absolute top-5 left-5 z-[10001] flex flex-wrap gap-2">
        <StatusPill
          label="SITL"
          value={simStatus?.sitl?.running ? "Running" : "Stopped"}
          tone={simStatus?.sitl?.running ? "good" : "bad"}
        />
        <StatusPill
          label="Controller"
          value={simStatus?.controllerReady ? "Ready" : "Starting"}
          tone={simStatus?.controllerReady ? "good" : "warn"}
        />
        <StatusPill
          label="GPS"
          value={simStatus?.gpsReady ? "Locked" : "Warming"}
          tone={simStatus?.gpsReady ? "good" : "warn"}
        />
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[10000] w-full max-w-lg px-2 sm:px-4">
        <FloatingInfoCard
          loading={loading}
          booked={booked}
          confirmed={confirmed}
          progress={progress}
          missionState={missionState}
          onAction={handleAction}
        />
      </div>
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

export default Home
