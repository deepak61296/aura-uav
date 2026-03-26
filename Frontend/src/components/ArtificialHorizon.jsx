import React from "react"

/**
 * ArtificialHorizon — A CSS-only attitude indicator.
 * Renders pitch and roll from MAVLink ATTITUDE messages.
 */
const ArtificialHorizon = ({ pitch = 0, roll = 0 }) => {
  const pitchOffset = Math.max(-30, Math.min(30, pitch)) * 2 // px per degree
  
  return (
    <div className="w-full aspect-square max-w-[200px] rounded-full overflow-hidden border-4 border-slate-700 bg-slate-900 relative shadow-xl mx-auto">
      {/* Sky + Ground */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%]"
        style={{
          transform: `rotate(${-roll}deg) translateY(${pitchOffset}px)`,
          transformOrigin: "center center",
        }}
      >
        {/* Sky */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-sky-400 to-sky-300" />
        {/* Ground */}
        <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-b from-amber-700 to-amber-900" />
        {/* Horizon line */}
        <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-white/80 -translate-y-1/2" />
        
        {/* Pitch ladder marks */}
        {[-20, -10, 10, 20].map(deg => (
          <div
            key={deg}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1"
            style={{ top: `calc(50% - ${deg * 2}px)` }}
          >
            <div className="w-6 h-[1px] bg-white/50" />
            <span className="text-[7px] text-white/60 font-mono">{Math.abs(deg)}</span>
            <div className="w-6 h-[1px] bg-white/50" />
          </div>
        ))}
      </div>

      {/* Fixed aircraft reference */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-0">
          <div className="w-8 h-[3px] bg-amber-400 rounded-l-full" />
          <div className="w-3 h-3 border-2 border-amber-400 rounded-full" />
          <div className="w-8 h-[3px] bg-amber-400 rounded-r-full" />
        </div>
      </div>

      {/* Heading tick at top */}
      <div className="absolute top-1 left-1/2 -translate-x-1/2 w-[2px] h-3 bg-white/60" />
    </div>
  )
}

export default ArtificialHorizon
