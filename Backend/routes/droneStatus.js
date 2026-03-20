import express from "express";
import DroneStatus from "../models/DroneStatus.js";

const router = express.Router();

const defaultStatus = (droneId) => ({
  droneId,
  booked: false,
  confirmed: false,
  deliveryLat: null,
  deliveryLng: null,
  deliveryAlt: null,
  currentLat: null,
  currentLng: null,
  currentAlt: null,
});

const parseLocation = (body, prefix) => {
  const lat = Number(body[`${prefix}Lat`]);
  const lng = Number(body[`${prefix}Lng`]);
  const altValue = body[`${prefix}Alt`];
  const alt = altValue == null ? null : Number(altValue);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: `${prefix}Lat and ${prefix}Lng are required` };
  }

  if (altValue != null && !Number.isFinite(alt)) {
    return { error: `${prefix}Alt must be a number when provided` };
  }

  return { lat, lng, alt };
};

router.get("/test", (req, res) => {
  res.send("DroneStatus routes working ✅");
});

router.post("/location", async (req, res) => {
  try {
    const { droneId } = req.body;

    if (!droneId) {
      return res.status(400).json({ error: "droneId required" });
    }

    const location = parseLocation(req.body, "current");
    if (location.error) {
      return res.status(400).json({ error: location.error });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      {
        currentLat: location.lat,
        currentLng: location.lng,
        currentAlt: location.alt,
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json({ message: "Current location updated", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/book", async (req, res) => {
  try {
    const { droneId } = req.body;

    if (!droneId) {
      return res.status(400).json({ error: "droneId required" });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      {
        booked: true,
        confirmed: false,
        deliveryLat: null,
        deliveryLng: null,
        deliveryAlt: null,
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json({ message: "Drone booked ✅", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/confirm", async (req, res) => {
  try {
    const { droneId } = req.body;

    if (!droneId) {
      return res.status(400).json({ error: "droneId required" });
    }

    const location = parseLocation(req.body, "delivery");
    if (location.error) {
      return res.status(400).json({ error: location.error });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      {
        confirmed: true,
        booked: true,
        deliveryLat: location.lat,
        deliveryLng: location.lng,
        deliveryAlt: location.alt,
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json({ message: "Order confirmed 🚀", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reset", async (req, res) => {
  try {
    const { droneId } = req.body;

    if (!droneId) {
      return res.status(400).json({ error: "droneId required" });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      {
        booked: false,
        confirmed: false,
        deliveryLat: null,
        deliveryLng: null,
        deliveryAlt: null,
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json({ message: "Reset done 🔄", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:droneId", async (req, res) => {
  try {
    const data = await DroneStatus.findOne({ droneId: req.params.droneId }).lean();

    if (!data) {
      return res.json(defaultStatus(req.params.droneId));
    }

    res.json({ ...defaultStatus(req.params.droneId), ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
