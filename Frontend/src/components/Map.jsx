import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import DroneIcon from "../assets/icons/Drone_Icon.png"
import { useEffect, useRef, useCallback } from "react"

/* ================= ICON FIX ================= */
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

/* ================= ICONS ================= */

// 🖤 User dot — black circle with pulsing ring
const userDot = L.divIcon({
  className: "leaflet-user-icon",
  html: `
    <div class="user-dot-wrapper">
      <div class="user-dot-pulse"></div>
      <div class="user-dot"></div>
    </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

// 🚁 Drone icon (same as original working version)
const dronePin = new L.Icon({
  iconUrl: DroneIcon,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
})

/* ================= SMART RECENTER (Rapido-style) ================= */
const RecenterMap = ({ dronePos, userPos, active }) => {
  const map = useMap()
  const followRef = useRef(true)
  const timerRef = useRef(null)
  const prevActiveRef = useRef(active)

  const reframe = useCallback(() => {
    if (active && dronePos && userPos) {
      // Drone is in transit → fit both markers on screen
      // As drone gets closer, bounds shrink → map auto-zooms in tighter
      const bounds = L.latLngBounds([dronePos, userPos])
      map.flyToBounds(bounds, {
        padding: [80, 80],   // generous padding so markers aren't at the edge
        maxZoom: 18,         // zoom tighter as drone gets closer
        duration: 1.2,
      })
    } else if (userPos) {
      // No active delivery → center on user location
      map.flyTo(userPos, 18, { duration: 1 })
    }
  }, [map, dronePos, userPos, active])

  // When delivery is cancelled (active goes true→false), snap to user
  useEffect(() => {
    if (prevActiveRef.current && !active && userPos) {
      followRef.current = true
      map.flyTo(userPos, 16, { duration: 1 })
    }
    prevActiveRef.current = active
  }, [active, userPos, map])

  // Pause auto-follow when user manually drags/zooms
  useEffect(() => {
    const pauseFollow = () => {
      followRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        followRef.current = true
        reframe()
      }, 2000)
    }


    map.on("dragstart zoomstart", pauseFollow)
    return () => map.off("dragstart zoomstart", pauseFollow)
  }, [map, reframe])

  // Re-fit whenever positions update (drone moving closer = tighter zoom)
  useEffect(() => {
    if (followRef.current) {
      reframe()
    }
  }, [dronePos, userPos, reframe])

  return null
}

/* ================= ANIMATED PATH (ref-based) ================= */
const AnimatedPath = ({ from, to }) => {
  // Callback ref: as soon as Leaflet mounts the Polyline, grab its
  // underlying SVG <path> element and add our CSS animation class.
  const dashRef = useCallback((node) => {
    if (node) {
      const el = node.getElement()
      if (el) {
        el.classList.add("animated-path")
      }
    }
  }, [])

  return (
    <>
      {/* Glow backdrop */}
      <Polyline
        positions={[from, to]}
        pathOptions={{
          color: "#000",
          weight: 6,
          opacity: 0.1,
        }}
      />
      {/* Animated dashes */}
      <Polyline
        ref={dashRef}
        positions={[from, to]}
        pathOptions={{
          color: "#111",
          weight: 2.5,
          dashArray: "10 14",
          lineCap: "round",
        }}
      />
    </>
  )
}

/* ================= MAIN MAP ================= */
const Map = ({ droneLocation, userLocation, showPath }) => {
  const dronePos = droneLocation
    ? [droneLocation.lat, droneLocation.lng]
    : null

  const userPos = userLocation
    ? [userLocation.lat, userLocation.lng]
    : null

  return (
    <MapContainer
      center={[30.7695, 76.577523]}
      zoom={16}
      className="h-full w-full"
      scrollWheelZoom={true}
      dragging={true}
      zoomControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />

      {/* 🖤 User location — black dot with pulse */}
      {userPos && <Marker position={userPos} icon={userDot} />}

      {/* 🚁 Drone */}
      {dronePos && <Marker position={dronePos} icon={dronePin} />}

      {/* Auto-fit: both markers when active, user only on cancel */}
      <RecenterMap dronePos={dronePos} userPos={userPos} active={showPath} />

      {/* ✈ Animated path drone → user */}
      {showPath && dronePos && userPos && (
        <AnimatedPath from={dronePos} to={userPos} />
      )}
    </MapContainer>
  )
}

export default Map