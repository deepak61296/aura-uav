import mongoose from "mongoose";

const DroneStatusSchema = new mongoose.Schema({
  droneId: { type: String, required: true, unique: true },
  booked: { type: Boolean, default: false },
  confirmed: { type: Boolean, default: false },
  deliveryLat: { type: Number, default: null },
  deliveryLng: { type: Number, default: null },
  deliveryAlt: { type: Number, default: null },
  currentLat: { type: Number, default: null },
  currentLng: { type: Number, default: null },
  currentAlt: { type: Number, default: null },
}, { timestamps: true });

export default mongoose.model("DroneStatus", DroneStatusSchema);
