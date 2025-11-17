// routes/roles.js
const express = require("express");
const path = require('path');
const pool = require('../../config/db');
const verifyToken = require('../../middware/authentication');
const dotenv = require('dotenv');
const envFile = 'production' ? '.env.production' : '.env.local';
dotenv.config({ path: path.resolve(__dirname, envFile) });
const router = express.Router();

// Get all roles
router.get("/roles", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT name, description FROM roles ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch roles:", err.message);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

//classes for user login
router.get("/classes", (req, res) => {
  const classes = [
    { id: process.env.DB_OFFICERS, name: "OFFICERS" },
    { id: process.env.DB_WOFFICERS, name: "W/OFFICERS" },
    { id: process.env.DB_RATINGS, name: "RATE A" },
    { id: process.env.DB_RATINGS_A, name: "RATE B" },
    { id: process.env.DB_RATINGS_B, name: "RATE C" },
    { id: process.env.DB_JUNIOR_TRAINEE, name: "TRAINEE" }
  ];
  res.json(classes);
});

// Get all dbs
router.get("/db_classes", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT db_name, classname FROM py_payrollclass WHERE status = 'active' ORDER BY db_name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch classname:", err.message);
    res.status(500).json({ error: "Failed to fetch db_classes" });
  }
});

module.exports = router;