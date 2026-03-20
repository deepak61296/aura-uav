import React, { useEffect, useRef, useState } from "react"
import Map from "../components/Map"
import FloatingInfoCard from "../components/FloatingInfoCard"
import { API_KEY, API_URL, DRONE_ID } from "../config/api"

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

const Home = () => {
  const [userLocation, setUserLocation] = useState(null)
  const [droneLocation, setDroneLocation] = useState(null)
  const [booked, setBooked] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showPath, setShowPath] = useState(false)
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
        setShowPath(Boolean(data.booked))
      }
    } catch (err) {
      console.error("Status fetch error:", err)
    }
  }

  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`${API_URL}/telemetry/latest/${DRONE_ID}`, {
        headers: { "x-api-key": API_KEY }
      })
      const data = await res.json()
      if (data?.lat && data?.lon) {
        setDroneLocation({ lat: data.lat, lng: data.lon })
      }
    } catch (err) {
      console.error("Telemetry fetch error:", err)
    }
  }

  const fetchDashboard = async () => {
    await Promise.all([fetchStatus(), fetchTelemetry()])
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

      if (type === "book") setBooked(true)
      if (type === "confirm") {
        setBooked(true)
        setConfirmed(true)
        setShowPath(true)
      }
      if (type === "reset") {
        setBooked(false)
        setConfirmed(false)
        setShowPath(false)
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
        />
      </div>

      <div className="absolute inset-0 z-[1] map-gradient-overlay" />

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[10000] w-full max-w-lg px-2 sm:px-4">
        <FloatingInfoCard
          loading={loading}
          booked={booked}
          confirmed={confirmed}
          progress={progress}
          onAction={handleAction}
        />
      </div>
    </div>
  )
}

export default Home
