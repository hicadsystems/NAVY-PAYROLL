const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// GET all taxes
router.get("/", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tax");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single tax by INTER
router.get("/:INTER", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tax WHERE INTER = ?", [req.params.INTER]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE
router.post("/create", verifyToken, async (req, res) => {
  const { INTER, val, perc, cumval, lowbound } = req.body;
  const createdby = req.user_fullname || "Admin User";
  try {
    await pool.query(
      "INSERT INTO py_tax (INTER, val, perc, createdby, cumval, lowbound) VALUES (?, ?, ?, ?, ?, ?)",
      [INTER, val, perc, createdby, cumval, lowbound]
    );
    res.status(201).json({ message: "Tax record created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:INTER", verifyToken, async (req, res) => {
  const { val, perc, cumval, lowbound } = req.body;
  try {
    const [result] = await pool.query(
      "UPDATE py_tax SET val=?, perc=?, cumval=?, lowbound=? WHERE INTER=?",
      [val, perc, cumval, lowbound, req.params.INTER]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Tax record updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:INTER", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM py_tax WHERE INTER=?", [req.params.INTER]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Tax record deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
