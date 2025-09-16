// routes/roles.js
const express = require("express");
const pool = require('../../config/db');
const router = express.Router();

// Get all roles
router.get("/roles", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT name FROM roles ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch roles:", err.message);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

router.get("/classes", (req, res) => {
  const classes = [
    { id: "hicaddata", name: "OFFICERS" },
    { id: "hicaddata1", name: "W/OFFICERS" },
    { id: "hicaddata2", name: "RATINGS" },
    { id: "hicaddata3", name: "RATINGS A" },
    { id: "hicaddata4", name: "RATINGS B" },
    { id: "hicaddata5", name: "JUNIOR/TRAINEE" }
  ];
  res.json(classes);
});

// Get all dbs
router.get("/db_classes", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT db_name FROM db_classes ORDER BY db_name ASC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch db_classes:", err.message);
    res.status(500).json({ error: "Failed to fetch db_classes" });
  }
});

module.exports = router;
