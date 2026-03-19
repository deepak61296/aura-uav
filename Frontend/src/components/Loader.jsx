import React from "react"

const Loader = () => {
  return (
    <div className="absolute inset-0 bg-white/60 backdrop-blur-md flex items-center justify-center z-50">
      <div className="w-14 h-14 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  )
}

export default Loader
