import React from "react"

/**
 * TelemetryPanel — Shows key flight data readouts.
 */
const TelemetryPanel = ({ telemetry }) => {
  const t = telemetry || {}
  const attitude = t.attitude || {}
  const battery = t.battery || {}
  const gps = t.gps || {}

  const rows = [
    { label: "Altitude", value: t.altitude != null ? `${t.altitude.toFixed(1)} m` : "--", icon: "↕" },
    { label: "Pitch", value: attitude.pitch != null ? `${attitude.pitch.toFixed(1)}°` : "--", icon: "⤵" },
    { label: "Roll", value: attitude.roll != null ? `${attitude.roll.toFixed(1)}°` : "--", icon: "↻" },
    { label: "Yaw / Heading", value: attitude.yaw != null ? `${((attitude.yaw % 360) + 360) % 360 | 0}°` : "--", icon: "🧭" },
    { label: "GPS Fix", value: t.gpsFixType != null ? fixLabel(t.gpsFixType) : "--", icon: "📡" },
    { label: "Lat", value: gps.latitude != null ? gps.latitude.toFixed(7) : "--", icon: "🌐" },
    { label: "Lon", value: gps.longitude != null ? gps.longitude.toFixed(7) : "--", icon: "🌐" },
    { label: "Battery V", value: battery.voltage != null ? `${battery.voltage} V` : "--", icon: "🔋" },
    { label: "Battery A", value: battery.current != null ? `${battery.current} A` : "--", icon: "⚡" },
    { label: "Battery %", value: battery.level != null ? `${battery.level}%` : "--", icon: "🪫" },
    { label: "Armed", value: t.armed != null ? (t.armed ? "YES" : "NO") : "--", icon: t.armed ? "🔴" : "🟢" },
    { label: "Mode", value: t.mode || "--", icon: "✈" },
    { label: "Servo", value: t.servo || "--", icon: "⚙" },
    { label: "Takeoff Alt", value: "5.0 m", icon: "🛫" },
  ]

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2 py-1 border-b border-slate-100/60 last:border-0">
          <span className="text-xs">{r.icon}</span>
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex-1">{r.label}</span>
          <span className="text-[11px] text-slate-900 font-bold tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

const fixLabel = (type) => {
  if (type >= 6) return `RTK (${type})`
  if (type >= 3) return `3D Fix (${type})`
  if (type >= 2) return `2D Fix (${type})`
  return `No Fix (${type})`
}

export default TelemetryPanel
