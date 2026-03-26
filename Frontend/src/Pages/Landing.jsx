import React from "react"
import { useNavigate } from "react-router-dom"
import { FaUserInjured, FaUserCog } from "react-icons/fa"

const Landing = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Aura Delivery</h1>
          <p className="text-sm text-slate-500 mt-2 font-medium">Select your portal to continue</p>
        </div>

        <div className="grid gap-4">
          <button
            onClick={() => navigate("/user")}
            className="flex items-center gap-4 bg-emerald-50 hover:bg-emerald-100 p-4 rounded-2xl border border-emerald-100 transition-colors group text-left"
          >
            <div className="bg-emerald-500 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
              <FaUserInjured size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition">User App</h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">Order medical supplies & track delivery</p>
            </div>
          </button>

          <button
            onClick={() => navigate("/admin")}
            className="flex items-center gap-4 bg-slate-100 hover:bg-slate-200 p-4 rounded-2xl border border-slate-200 transition-colors group text-left"
          >
            <div className="bg-slate-800 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
              <FaUserCog size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 group-hover:text-slate-800 transition">Admin Dashboard</h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">Manage drone ops, health & simulation</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

export default Landing
