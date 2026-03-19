import React from "react"
import { motion } from "framer-motion"

const Navbar = () => {
  return (
    <motion.nav 
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-[9999] px-5 pt-4 pointer-events-none"
    >
      <div className="flex items-center justify-between">
        {/* Logo */}
        <div className="pointer-events-auto bg-white/70 backdrop-blur-xl rounded-2xl px-5 py-2.5 shadow-card border border-white/50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-slate-900 rounded-lg flex items-center justify-center">
              <span className="text-white text-[11px] font-bold tracking-tight">A</span>
            </div>
            <div>
              <h1 className="text-[13px] font-semibold text-slate-900 tracking-tight leading-none">AURA</h1>
              <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.3em] leading-none mt-0.5">Delivery</p>
            </div>
          </div>
        </div>

        {/* Status pill */}
        <div className="pointer-events-auto bg-white/70 backdrop-blur-xl rounded-full px-4 py-2.5 shadow-card border border-white/50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Online</span>
          </div>
        </div>
      </div>
    </motion.nav>
  )
}

export default Navbar
