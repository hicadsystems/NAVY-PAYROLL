const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

// CREATE
router.post("/post-department", verifyToken, async (req, res) => {
  try {
    const {
      factcode, deptcode, factname, deptname,
      coordcode, manager, hod, acct,
      misc1, misc2, misc3, AddressCode
    } = req.body;

    const createdby = req.user_fullname || "Admin User";

    await pool.query(
      `INSERT INTO py_department 
      (factcode, deptcode, factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode, createdby, datecreated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [factcode, deptcode, factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode, createdby]
    );

    res.status(201).json({ message: "Department created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ALL
router.get("/department", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_department");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ ONE
router.get("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM py_department WHERE factcode = ? AND deptcode = ?",
      [req.params.factcode, req.params.deptcode]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Department not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const { factname, deptname, coordcode, manager, hod, acct,
            misc1, misc2, misc3, AddressCode } = req.body;

    const [result] = await pool.query(
      `UPDATE py_department SET 
       factname=?, deptname=?, coordcode=?, manager=?, hod=?, acct=?, 
       misc1=?, misc2=?, misc3=?, AddressCode=?
       WHERE factcode=? AND deptcode=?`,
      [factname, deptname, coordcode, manager, hod, acct,
       misc1, misc2, misc3, AddressCode,
       req.params.factcode, req.params.deptcode]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Department updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:factcode/:deptcode", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM py_department WHERE factcode = ? AND deptcode = ?",
      [req.params.factcode, req.params.deptcode]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Department deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
