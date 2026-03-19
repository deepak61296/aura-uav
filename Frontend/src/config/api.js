const required = (value, name) => {
  if (!value) {
    throw new Error(`Missing required Vite env: ${name}`)
  }

  return value
}

export const API_URL = required(import.meta.env.VITE_API_URL, "VITE_API_URL")
export const API_KEY = required(import.meta.env.VITE_API_KEY, "VITE_API_KEY")
export const DRONE_ID = import.meta.env.VITE_DRONE_ID || "DRONE001"
