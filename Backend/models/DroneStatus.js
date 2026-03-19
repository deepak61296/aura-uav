import mongoose from "mongoose";

const DroneStatusSchema = new mongoose.Schema({
  droneId:{ type:String, required:true, unique:true },
  booked:{ type:Boolean, default:false },
  confirmed:{ type:Boolean, default:false },
},{ timestamps:true });

export default mongoose.model("DroneStatus", DroneStatusSchema);
