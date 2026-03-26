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

const homePin = L.divIcon({
  className: "leaflet-home-icon",
  html: `<div style="background-color: #1e293b; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">H</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const deliveryPin = L.divIcon({
  className: "leaflet-delivery-icon",
  html: `<div style="background-color: #f97316; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">D</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
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

const AnimatedPath = ({ from, to, colorType = "outbound" }) => {
  const pathColor = colorType === "return" ? "#3b82f6" : "#f97316"; // Blue for return, Orange for outbound
  
  return (
    <>
      <Polyline
        positions={[from, to]}
        pathOptions={{
          color: pathColor,
          weight: 4,
          opacity: 0.8,
          dashArray: "8 8",
          lineCap: "round",
        }}
      />
    </>
  )
}

const BaseLayer = ({ mapStyle }) => {
  if (mapStyle === "standard") {
    return (
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
    )
  }

  return (
    <>
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution='Tiles &copy; Esri'
      />
      <TileLayer
        url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        attribution='Labels &copy; Esri'
      />
    </>
  )
}

const Map = ({ droneLocation, userLocation, showPath, mapStyle, homeLocation, deliveryLocation, missionState }) => {
  const dronePos = droneLocation ? [droneLocation.lat, droneLocation.lng] : null
  const userPos = userLocation ? [userLocation.lat, userLocation.lng] : null
  const homePos = homeLocation ? [homeLocation.lat, homeLocation.lng] : null
  const deliveryPos = deliveryLocation ? [deliveryLocation.lat, deliveryLocation.lng] : null

  const initialCenter = userPos || dronePos || [28.49505278, 77.05681893]
  
  // Decide which path to show and with what color
  const isReturning = missionState === "climbing" || missionState === "returning_home"
  const targetPos = isReturning ? homePos : deliveryPos
  const pathColorType = isReturning ? "return" : "outbound"

  return (
    <MapContainer
      center={initialCenter}
      zoom={16}
      className="h-full w-full z-0"
      scrollWheelZoom
      dragging
      zoomControl={false}
    >
      <BaseLayer mapStyle={mapStyle} />

      {userPos && <Marker position={userPos} icon={userDot} />}
      {homePos && <Marker position={homePos} icon={homePin} />}
      {deliveryPos && <Marker position={deliveryPos} icon={deliveryPin} />}
      
      {dronePos && <Marker position={dronePos} icon={dronePin} zIndexOffset={100} />}

      <RecenterMap dronePos={dronePos} userPos={targetPos || userPos} active={showPath} />

      {showPath && dronePos && targetPos && <AnimatedPath from={dronePos} to={targetPos} colorType={pathColorType} />}
    </MapContainer>
  )
}

export default Map
