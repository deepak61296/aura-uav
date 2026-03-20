import React, { useRef, useState } from "react"
import { FaCheck, FaWarehouse } from "react-icons/fa"
import { HiHome } from "react-icons/hi2"
import { IoClose } from "react-icons/io5"
import { motion, AnimatePresence } from "framer-motion"
import DroneIcon from "../assets/icons/Drone_Icon.png"

const FloatingInfoCard = ({ loading, booked, confirmed, progress, missionState, onAction }) => {
  const [open, setOpen] = useState(true)

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: open ? 0 : "calc(100% - 72px)" }}
      transition={{ type: "spring", damping: 32, stiffness: 300 }}
      className="bg-white/80 backdrop-blur-2xl rounded-t-[2rem] shadow-card border-t border-white/60 overflow-hidden"
    >
      {/* PULL HANDLE */}
      <div 
        onClick={() => setOpen(!open)} 
        className="flex flex-col items-center pt-3 pb-3 cursor-pointer active:bg-slate-50/50 transition-colors"
      >
        <div className="w-9 h-1 bg-slate-300/60 rounded-full" />
        
        {/* Mini status when collapsed */}
        {!open && booked && (
          <div className="w-full px-8 mt-2">
            {confirmed ? (
              /* Tracking progress bar with icons */
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FaWarehouse size={10} className="text-slate-400" />
                </div>
                <div className="flex-1 relative">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-slate-900 rounded-full" 
                      initial={{ width: 0 }} 
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                  {/* Mini drone riding the bar */}
                  <motion.div
                    className="absolute -top-2.5"
                    initial={{ left: "0%" }}
                    animate={{ left: `${Math.min(progress, 95)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    style={{ transform: "translateX(-50%)" }}
                  >
                    <div className="w-4 h-4 bg-white rounded shadow-sm border border-slate-100 flex items-center justify-center">
                      <img src={DroneIcon} alt="" className="w-2.5 h-2.5 object-contain" />
                    </div>
                  </motion.div>
                </div>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                  progress > 95 ? 'bg-slate-900' : 'bg-slate-100'
                }`}>
                  <HiHome size={12} className={progress > 95 ? 'text-white' : 'text-slate-400'} />
                </div>
                <span className="text-[10px] font-bold text-slate-900 tabular-nums w-7 text-right">{progress}%</span>
              </div>
            ) : (
              /* Awaiting confirmation status */
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                <span className="text-[11px] font-semibold text-slate-500">Drone assigned — waiting for launch</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* DYNAMIC CONTENT */}
      <div className="px-6 pb-10 flex flex-col min-h-[140px]">
        <AnimatePresence mode="wait">
          {loading ? (
            <LoadingState key="loading" />
          ) : !booked ? (
            <BookingState key="booking" onBook={() => onAction("book")} />
          ) : !confirmed ? (
            <ConfirmState key="confirm" onConfirm={() => onAction("confirm")} onCancel={() => onAction("reset")} />
          ) : (
            <TrackingState key="tracking" progress={progress} missionState={missionState} onCancel={() => onAction("reset")} />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/* ===== LOADING STATE ===== */
const LoadingState = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    className="py-10 flex flex-col items-center gap-5"
  >
    {/* Drone with pulsing rings */}
    <div className="relative w-16 h-16 flex items-center justify-center">
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-slate-200"
        animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <motion.div
        className="absolute inset-2 rounded-full border-2 border-slate-300"
        animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
      />
      <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 shadow-sm">
        <img src={DroneIcon} alt="" className="w-6 h-6 object-contain" style={{ animation: "drone-hover 2s ease-in-out infinite" }} />
      </div>
    </div>
    <div className="flex items-center gap-1">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.2em]">Connecting</span>
      <motion.span
        className="text-[11px] font-semibold text-slate-400"
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >...</motion.span>
    </div>
  </motion.div>
)

/* ===== BOOKING STATE — Slide to Book ===== */
const BookingState = ({ onBook }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    className="flex flex-col gap-5"
  >
    {/* Header */}
    <div className="pt-1">
      <h2 className="text-[17px] font-semibold text-slate-900 tracking-tight">Schedule Delivery</h2>
      <p className="text-[11px] text-slate-400 font-medium mt-0.5">Choose your dispatch method</p>
    </div>

    {/* Service card */}
    <div className="flex items-center gap-4 p-4 bg-slate-50/80 rounded-2xl border border-slate-100/60 group hover:bg-slate-50 transition-colors">
      <div className="w-13 h-13 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100/50 p-2.5">
        <img src={DroneIcon} className="w-8 h-8 object-contain" alt="Drone" style={{ animation: "drone-hover 3s ease-in-out infinite" }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">Aura Express</h3>
        <div className="flex items-center gap-2 mt-1">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 rounded-full">
            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            <span className="text-[9px] font-semibold text-emerald-600 uppercase tracking-wider">~5 min</span>
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-lg font-bold text-slate-900">₹0</p>
        <p className="text-[10px] text-slate-400 font-medium">Free</p>
      </div>
    </div>

    {/* Slide to Book */}
    <SlideToAction
      label="Slide to Book"
      onComplete={onBook}
      variant="dark"
    />
  </motion.div>
)

/* ===== CONFIRM STATE — Slide to Authorize ===== */
const ConfirmState = ({ onConfirm, onCancel }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    className="flex flex-col gap-5"
  >
    {/* Status badge */}
    <div className="flex items-center gap-2 pt-1">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Drone Assigned</span>
      </div>
    </div>

    {/* Route Indicator — Pickup → Dropoff */}
    <div className="flex gap-4">
      {/* Dots & Line */}
      <div className="flex flex-col items-center pt-1.5">
        <div className="w-3 h-3 rounded-full border-[3px] border-orange-500 bg-white" />
        <div className="w-[2px] flex-1 border-l-[2px] border-dashed border-slate-200 my-1" />
        <div className="w-3 h-3 rounded-full bg-slate-900" />
      </div>
      {/* Addresses */}
      <div className="flex-1 flex flex-col justify-between py-0.5">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-medium text-slate-900">Warehouse Hub</p>
          <span className="text-[11px] font-medium text-slate-400 flex-shrink-0 ml-3">Now</span>
        </div>
        <div className="pt-3">
          <p className="text-[14px] font-medium text-slate-900">Your Location</p>
        </div>
      </div>
    </div>

    <SlideToAction
      label="Slide to Confirm"
      onComplete={onConfirm}
      variant="dark"
    />

    <button
      onClick={onCancel}
      className="flex items-center justify-center gap-2 self-center px-5 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 active:scale-[0.97] transition-all group"
    >
      <IoClose size={14} className="text-red-400 group-hover:text-red-500 transition-colors" />
      <span className="text-[11px] font-semibold text-red-400 group-hover:text-red-500 uppercase tracking-wider transition-colors">Cancel Order</span>
    </button>
  </motion.div>
)

/* ===== TRACKING STATE — Progress bar with drone icon ===== */
const missionLabels = {
  idle: "Waiting",
  taking_off: "Taking off",
  flying_to_delivery: "Flying to destination",
  descending: "Descending to drop point",
  holding_over_delivery: "Holding over delivery point",
  dropping_parcel: "Dropping parcel",
  climbing: "Climbing out",
  returning_home: "Returning to base",
  complete: "Delivered",
  reset_failed: "Delivered, waiting for reset",
}

const TrackingState = ({ progress, missionState, onCancel }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    className="flex flex-col gap-6"
  >
    {/* Status badge */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg">
          <FaCheck size={14} className="text-white" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight leading-tight">In Transit</h3>
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">{missionLabels[missionState] || "Live Tracking"}</p>
        </div>
      </div>
      <span className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{progress}%</span>
    </div>

    {/* Progress bar with drone icon */}
    <div className="px-1">
      {/* Labels */}
      <div className="flex justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center">
            <FaWarehouse size={12} className="text-slate-400" />
          </div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Origin</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${progress > 95 ? 'text-slate-900' : 'text-slate-400'}`}>Dest</span>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-500 ${
            progress > 95 ? 'bg-slate-900 shadow-lg' : 'bg-slate-100'
          }`}>
            <HiHome size={14} className={progress > 95 ? 'text-white' : 'text-slate-400'} />
          </div>
        </div>
      </div>

      {/* Track */}
      <div className="relative h-2 bg-slate-100 rounded-full overflow-visible">
        {/* Filled bar */}
        <motion.div
          className="absolute top-0 left-0 h-full bg-slate-900 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />

        {/* Drone icon riding the bar */}
        <motion.div
          className="absolute -top-4"
          initial={{ left: "0%" }}
          animate={{ left: `${Math.min(progress, 97)}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{ transform: "translateX(-50%)" }}
        >
          <div className="w-6 h-6 bg-white rounded-lg shadow-md border border-slate-100 flex items-center justify-center"
               style={{ animation: "drone-hover 2s ease-in-out infinite" }}>
            <img src={DroneIcon} alt="" className="w-4 h-4 object-contain" />
          </div>
        </motion.div>
      </div>
    </div>

    <button
      onClick={onCancel}
      className="flex items-center justify-center gap-2 self-center px-5 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 active:scale-[0.97] transition-all group"
    >
      <IoClose size={14} className="text-red-400 group-hover:text-red-500 transition-colors" />
      <span className="text-[11px] font-semibold text-red-400 group-hover:text-red-500 uppercase tracking-wider transition-colors">Cancel Delivery</span>
    </button>
  </motion.div>
)

/* ===== SLIDE-TO-ACTION COMPONENT ===== */
const SlideToAction = ({ label, onComplete, variant = "dark" }) => {
  const [complete, setComplete] = useState(false)
  const [dragX, setDragX] = useState(0)
  const containerRef = useRef(null)

  const handleDrag = (_, info) => {
    const maxX = containerRef.current ? containerRef.current.offsetWidth - 60 : 280
    const curX = Math.max(0, Math.min(info.offset.x, maxX))
    setDragX(curX)
    if (curX >= maxX * 0.9 && !complete) {
      setComplete(true)
      onComplete()
    }
  }

  const thumbBg = variant === "dark" ? "bg-slate-900" : "bg-white"
  const thumbText = variant === "dark" ? "text-white" : "text-slate-900"
  const trackBg = variant === "dark" ? "bg-slate-100" : "bg-slate-200"

  return (
    <div
      ref={containerRef}
      className={`relative h-14 ${trackBg} rounded-2xl flex items-center overflow-hidden slider-shimmer`}
      style={{ padding: "6px" }}
    >
      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.span
          className="text-slate-400/70 font-semibold text-[11px] uppercase tracking-[0.25em]"
          animate={{ opacity: complete ? 0 : 1 - dragX / 200 }}
        >
          {complete ? "Done" : label}
        </motion.span>
      </div>

      {/* Drag thumb */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 300 }}
        dragElastic={0.02}
        onDrag={handleDrag}
        onDragEnd={() => {
          if (!complete) {
            setDragX(0)
          }
        }}
        animate={{ 
          x: complete ? (containerRef.current ? containerRef.current.offsetWidth - 60 : 300) : dragX,
          scale: complete ? 1.1 : 1
        }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={`z-10 w-[46px] h-[46px] ${thumbBg} rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing ${thumbText} shadow-lg`}
        style={{ touchAction: "none" }}
      >
        {complete ? (
          <motion.div
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 12 }}
          >
            <FaCheck size={16} />
          </motion.div>
        ) : (
          <motion.span 
            className="text-lg font-light"
            animate={{ x: [0, 4, 0] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          >
            →
          </motion.span>
        )}
      </motion.div>

      {/* Trail fill */}
      <motion.div
        className={`absolute left-0 top-0 bottom-0 ${variant === "dark" ? 'bg-slate-900/5' : 'bg-white/20'} rounded-2xl`}
        animate={{ width: complete ? "100%" : dragX + 24 }}
        transition={{ duration: 0.1 }}
      />
    </div>
  )
}

export default FloatingInfoCard
