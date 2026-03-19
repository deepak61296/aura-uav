import express from "express";
import Telemetry from "../models/Telemetry.js";

const router = express.Router();

// 🔐 API KEY MIDDLEWARE
router.use((req, res, next) => {
  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});


// 📡 POST TELEMETRY (Pi sends)
router.post("/", async (req, res) => {
  try {
    const { droneId, lat, lon, alt } = req.body;

    if (!droneId) {
      return res.status(400).json({ error: "droneId missing" });
    }

    await Telemetry.findOneAndUpdate(
      { droneId },
      {
        droneId,
        lat,
        lon,
        alt,
        timestamp: new Date()
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    );

    res.json({ status: "updated" });

  } catch (err) {
    console.error("POST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});




// 🛰️ GET FULL ROUTE
router.get("/route/:droneId", async (req, res) => {
  const data = await Telemetry
    .find({ droneId: req.params.droneId })
    .sort({ timestamp: 1 });

  res.json(data);
});


// 📍 GET LATEST LOCATION
router.get("/latest/:droneId", async (req, res) => {
  const data = await Telemetry
    .findOne({ droneId: req.params.droneId })
    .sort({ timestamp: -1 });

  res.json(data);
});

export default router;
