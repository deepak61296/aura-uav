import express from "express";
import DroneStatus from "../models/DroneStatus.js";
import { getSimStatus, startSimStack, stopSimStack } from "../lib/simManager.js";

const router = express.Router();

router.use((req, res, next) => {
  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

const resolveTarget = async (body) => {
  if (body.lat != null && body.lng != null) {
    return {
      lat: Number(body.lat),
      lng: Number(body.lng),
      alt: body.alt != null ? Number(body.alt) : undefined,
    };
  }

  const droneId = body.droneId || "DRONE001";
  const status = await DroneStatus.findOne({ droneId }).lean();
  const lat = status?.currentLat ?? status?.deliveryLat;
  const lng = status?.currentLng ?? status?.deliveryLng;
  const alt = status?.currentAlt ?? status?.deliveryAlt;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("No stored browser location found. Open the site and allow location first.");
  }

  return { lat, lng, alt };
};

router.get("/status", (req, res) => {
  res.json(getSimStatus());
});

router.post("/start", async (req, res) => {
  try {
    const target = await resolveTarget(req.body || {});
    const status = await startSimStack({
      ...target,
      heading: req.body?.heading,
      offsetMeters: req.body?.offsetMeters,
      droneId: req.body?.droneId,
    });
    res.json({ message: "SITL stack started", ...status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/stop", async (req, res) => {
  try {
    await stopSimStack();
    res.json({ message: "SITL stack stopped", ...getSimStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
