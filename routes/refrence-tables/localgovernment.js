const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// CREATE - Add new LGA
router.post("/postlga", verifyToken, async (req, res) => {
  try {
    const { Lgcode, Lgname, Lghqs, Statecode} = req.body;
    const createdby = req.user_fullname || "Admin User";
    const [result] = await pool.query(
      "INSERT INTO py_tblLGA (Lgcode, Lgname, Lghqs, Statecode, createdby, datecreated) VALUES (?, ?, ?, ?, ?, NOW())",
      [Lgcode, Lgname, Lghqs, Statecode, createdby]
    );
    res.status(201).json({ message: "LGA created", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ - Get all LGAs
router.get("/lga", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblLGA");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ - Get one LGA by Lgcode
router.get("/:Lgcode", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblLGA WHERE Lgcode = ?", [
      req.params.Lgcode,
    ]);
    if (rows.length === 0) return res.status(404).json({ message: "LGA not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE - Modify LGA
router.put("/:Lgcode", verifyToken, async (req, res) => {
  try {
    const { Lgname, Lghqs, Statecode } = req.body;
    const [result] = await pool.query(
      "UPDATE py_tblLGA SET Lgname = ?, Lghqs = ?, Statecode = ? WHERE Lgcode = ?",
      [Lgname, Lghqs, Statecode, req.params.Lgcode]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "LGA not found" });
    res.json({ message: "LGA updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Remove LGA
router.delete("/:Lgcode", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM py_tblLGA WHERE Lgcode = ?", [
      req.params.Lgcode,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "LGA not found" });
    res.json({ message: "LGA deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;