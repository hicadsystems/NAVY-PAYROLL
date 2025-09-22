const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// CREATE overtime record (limit to 1 row only)
router.post('/overtime', verifyToken, async (req, res) => {
  try {
    // Check if a row already exists
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM py_stdrate");
    if (rows[0].count > 0) {
      return res.status(400).json({ error: "Only one overtime record is allowed" });
    }

    const data = { ...req.body };
    //data.datecreated = new Date();
    data.createdby = req.user_fullname || "Admin User";

    await pool.query("INSERT INTO py_stdrate SET ?", data);
    res.status(201).json({ message: "Overtime record created successfully" });
  } catch (err) {
    console.error("Error creating overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET the only overtime row
router.get('/overtime', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_stdrate LIMIT 1");
    res.json(rows[0] || {});
  } catch (err) {
    console.error("Error fetching overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// UPDATE the only overtime row (overwrite first row)
router.put('/overtime', verifyToken, async (req, res) => {
  try {
    const data = req.body;
    const [rows] = await pool.query("SELECT type FROM py_stdrate LIMIT 1");

    if (rows.length === 0) {
      return res.status(404).json({ error: "No overtime record exists" });
    }

    const {type } = rows[0];
    await pool.query("UPDATE py_stdrate SET ? WHERE type = ?", [data, type]);

    res.json({ message: "Overtime record updated successfully" });
  } catch (err) {
    console.error("Error updating overtime:", err);
    res.status(500).json({ error: "Database error" });
  }
});


module.exports = router;
