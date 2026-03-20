import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import DroneIcon from "../assets/icons/Drone_Icon.png"
import { useEffect, useRef } from "react"

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

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

const dronePin = new L.Icon({
  iconUrl: DroneIcon,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
})

const positionsDiffer = (a, b) => {
  if (!a || !b) return true
  return Math.abs(a[0] - b[0]) > 0.0001 || Math.abs(a[1] - b[1]) > 0.0001
}

const RecenterMap = ({ dronePos, userPos, active }) => {
  const map = useMap()
  const followRef = useRef(true)
  const timerRef = useRef(null)
  const lastCenteredUserRef = useRef(null)
  const lastBoundsKeyRef = useRef(null)

  useEffect(() => {
    const invalidate = () => map.invalidateSize({ pan: false })

    const frame = window.requestAnimationFrame(invalidate)
    window.addEventListener("resize", invalidate)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", invalidate)
    }
  }, [map])

  useEffect(() => {
    const pauseFollow = () => {
      followRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        followRef.current = true
      }, 4000)
    }

    map.on("dragstart zoomstart", pauseFollow)
    return () => map.off("dragstart zoomstart", pauseFollow)
  }, [map])

  useEffect(() => {
    if (!followRef.current) return

    if (active && dronePos && userPos) {
      const key = `${dronePos[0].toFixed(4)}:${dronePos[1].toFixed(4)}:${userPos[0].toFixed(4)}:${userPos[1].toFixed(4)}`
      if (lastBoundsKeyRef.current !== key) {
        lastBoundsKeyRef.current = key
        map.fitBounds(L.latLngBounds([dronePos, userPos]), {
          padding: [80, 80],
          maxZoom: 17,
          animate: false,
        })
      }
      return
    }

    if (userPos && positionsDiffer(lastCenteredUserRef.current, userPos)) {
      lastCenteredUserRef.current = userPos
      map.setView(userPos, 16, { animate: false })
    }
  }, [active, dronePos, userPos, map])

  return null
}

const AnimatedPath = ({ from, to }) => (
  <>
    <Polyline
      positions={[from, to]}
      pathOptions={{
        color: "#f8fafc",
        weight: 7,
        opacity: 0.35,
      }}
    />
    <Polyline
      positions={[from, to]}
      pathOptions={{
        color: "#ffffff",
        weight: 3,
        dashArray: "10 14",
        lineCap: "round",
      }}
    />
  </>
)

const Map = ({ droneLocation, userLocation, showPath }) => {
  const dronePos = droneLocation ? [droneLocation.lat, droneLocation.lng] : null
  const userPos = userLocation ? [userLocation.lat, userLocation.lng] : null
  const initialCenter = userPos || dronePos || [28.49505278, 77.05681893]

  return (
    <MapContainer
      center={initialCenter}
      zoom={16}
      className="h-full w-full"
      scrollWheelZoom
      dragging
      zoomControl={false}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution='Tiles &copy; Esri'
      />
      <TileLayer
        url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        attribution='Labels &copy; Esri'
      />

      {userPos && <Marker position={userPos} icon={userDot} />}
      {dronePos && <Marker position={dronePos} icon={dronePin} />}

      <RecenterMap dronePos={dronePos} userPos={userPos} active={showPath} />

      {showPath && dronePos && userPos && <AnimatedPath from={dronePos} to={userPos} />}
    </MapContainer>
  )
}

export default Map
