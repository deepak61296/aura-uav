import React, { useEffect, useState, useRef } from "react"
import Map from "../components/Map"
import FloatingInfoCard from "../components/FloatingInfoCard"
import { API_KEY, API_URL, DRONE_ID } from "../config/api"

const Home = () => {
  const [userLocation, setUserLocation] = useState(null)
  const [droneLocation, setDroneLocation] = useState(null)
  const [booked, setBooked] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showPath, setShowPath] = useState(false)

  // syncLockRef prevents polling from resetting optimistic state during action transitions
  const syncLockRef = useRef(null)

  /* GET USER GEOLOCATION */
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        },
        (error) => console.error("Location Error:", error),
        { enableHighAccuracy: true }
      )
    }
  }, [])

  /* FETCH DRONE STATUS */
  const fetchStatus = async () => {
    if (syncLockRef.current) return
    try {
      const res = await fetch(`${API_URL}/drone/${DRONE_ID}`, {
        headers: { "x-api-key": API_KEY }
      })
      const data = await res.json()
      if (data) {
        setBooked(data.booked)
        setConfirmed(data.confirmed)
        if (data.booked) setShowPath(true)
      }
    } catch (err) {
      console.error("Status fetch error:", err)
    }
  }

  /* FETCH DRONE TELEMETRY (separate endpoint) */
  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`${API_URL}/telemetry/latest/${DRONE_ID}`, {
        headers: { "x-api-key": API_KEY }
      })
      const data = await res.json()
      if (data?.lat && data?.lon) {
        setDroneLocation({ lat: data.lat, lng: data.lon })
      } else if (!droneLocation) {
        // Fallback: place drone near default map center so it's always visible
        setDroneLocation({ lat: 30.7700, lng: 76.5780 })
      }
    } catch (err) {
      console.error("Telemetry fetch error:", err)
      if (!droneLocation) {
        setDroneLocation({ lat: 30.7700, lng: 76.5780 })
      }
    }
  }

  /* COMBINED DASHBOARD FETCH */
  const fetchDashboard = async () => {
    await Promise.all([fetchStatus(), fetchTelemetry()])
  }

  /* UNIFIED ACTION HANDLER (Book, Confirm, Reset) */
  const handleAction = async (type) => {
    setLoading(true)
    
    // Safety timeout to clear loader if network stalls
    const safetyTimer = setTimeout(() => setLoading(false), 6000)

    // Set a 3-second sync lock to allow server to process and stabilize
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
        body: JSON.stringify({ droneId: DRONE_ID })
      })

      if (res.ok) {
        // Optimistic State Update for Instant Feedback
        if (type === "book") setBooked(true)
        if (type === "confirm") setConfirmed(true)
        if (type === "reset") { setBooked(false); setConfirmed(false); setShowPath(false); }
        
        // Immediate refresh to sync all telemetry
        await fetchDashboard()
      }
    } catch (err) {
      console.error(`${type} action failed:`, err)
    } finally {
      clearTimeout(safetyTimer)
      setLoading(false)
    }
  }

  /* START POLLING ENGINE */
  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative h-screen w-full bg-[#f8fafc] overflow-hidden">
      {/* BACKGROUND MAP */}
      <div className="absolute inset-0 z-0">
        <Map
          droneLocation={droneLocation}
          userLocation={userLocation}
          showPath={showPath}
        />
      </div>

      {/* GRADIENT OVERLAY for depth */}
      <div className="absolute inset-0 z-[1] map-gradient-overlay" />

      {/* FLOATING CARD */}
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
