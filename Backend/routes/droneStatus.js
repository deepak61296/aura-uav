import express from "express";
import DroneStatus from "../models/DroneStatus.js";

const router = express.Router();

/* ================= TEST ================= */
router.get("/test", (req,res)=>{
  res.send("DroneStatus routes working ✅");
});

/* ================= BOOK DRONE ================= */
router.post("/book", async (req,res)=>{
  try{
    console.log("BOOK BODY:", req.body);

    const { droneId } = req.body;

    if(!droneId){
      return res.status(400).json({ error:"droneId required" });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      { booked:true },
      { upsert:true, new:true }
    );

    res.json({
      message:"Drone booked ✅",
      data
    });

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ================= CONFIRM ORDER ================= */
router.post("/confirm", async (req,res)=>{
  try{
    console.log("CONFIRM BODY:", req.body);

    const { droneId } = req.body;

    if(!droneId){
      return res.status(400).json({ error:"droneId required" });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      { confirmed:true },
      { upsert:true, new:true }
    );

    res.json({
      message:"Order confirmed 🚀",
      data
    });

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ================= RESET ================= */
router.post("/reset", async (req,res)=>{
  try{
    console.log("RESET BODY:", req.body);

    const { droneId } = req.body;

    if(!droneId){
      return res.status(400).json({ error:"droneId required" });
    }

    const data = await DroneStatus.findOneAndUpdate(
      { droneId },
      { booked:false, confirmed:false },
      { upsert:true, new:true }
    );

    res.json({
      message:"Reset done 🔄",
      data
    });

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET STATUS ================= */
router.get("/:droneId", async (req,res)=>{
  try{
    const data = await DroneStatus.findOne({
      droneId:req.params.droneId
    });

    if(!data){
      return res.json({
        droneId:req.params.droneId,
        booked:false,
        confirmed:false
      });
    }

    res.json(data);

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

export default router;
