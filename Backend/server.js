import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import telemetryRoutes from "./routes/telemetry.js";
import droneStatusRoutes from "./routes/droneStatus.js";
import simRoutes from "./routes/sim.js";
import DroneStatus from "./models/DroneStatus.js";
import { startSimStack } from "./lib/simManager.js";


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB connect
await mongoose.connect(process.env.MONGO_URI);
console.log("MongoDB Connected ✅");

// Root
app.get("/", (req, res) => {
  res.send("Drone Telemetry API UPDATED");
});

// Telemetry routes
app.use("/telemetry", telemetryRoutes);

app.use("/drone", droneStatusRoutes);
app.use("/sim", simRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (process.env.AURA_AUTO_START_SIM !== "1") return;

  try {
    const status = await DroneStatus.findOne({ droneId: process.env.AURA_DRONE_ID || "DRONE001" }).lean();
    const lat = status?.currentLat ?? status?.deliveryLat;
    const lng = status?.currentLng ?? status?.deliveryLng;
    const alt = status?.currentAlt ?? status?.deliveryAlt;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const simStatus = await startSimStack({ lat, lng, alt });
      console.log("SITL stack started", simStatus);
    } else {
      console.log("SITL auto-start skipped: no stored browser location yet");
    }
  } catch (error) {
    console.error("SITL auto-start failed:", error.message);
  }
});
