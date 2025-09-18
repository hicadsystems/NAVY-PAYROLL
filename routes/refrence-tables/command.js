const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// Get all
router.get("/command", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_navalcommand");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get one
router.get("/:navalcmd", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_navalcommand WHERE navalcmd = ?", [req.params.navalcmd]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create
router.post("/post-command", verifyToken, async (req, res) => {
  const { navalcmd, name } = req.body;
  try {
    await pool.query("INSERT INTO py_navalcommand (navalcmd, name) VALUES (?, ?)", [navalcmd, name]);
    res.json({ message: "Naval Command created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update
router.put("/:navalcmd", verifyToken, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("UPDATE py_navalcommand SET name = ? WHERE navalcmd = ?", [name, req.params.navalcmd]);
    res.json({ message: "Naval Command updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete("/:navalcmd", verifyToken, async (req, res) => {
  try {
    await pool.query("DELETE FROM py_navalcommand WHERE navalcmd = ?", [req.params.navalcmd]);
    res.json({ message: "Naval Command deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;