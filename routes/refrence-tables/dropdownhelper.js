const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const tables = {
  salarygroup: "py_salarygroup",
  salarygrade: "py_gradelevel",   
  bankbranch: "py_bank",
  bankcode: "py_bank",
  command: "py_navalcommand",   
  sex: "py_sex",
  relationship: "py_relationship",
  status: "py_status",
  country: "py_country",
  marital: "py_maritalstatus",
  title: "py_title",
  specialisation: "py_specialisationarea",
  state: "py_tblstates",
  lga: "py_tbllga",
  pfa: "py_pfa",
  religion: "py_religion",
  exittype: "py_exittype"
};


// Generic GET for dropdowns
router.get("/:table", verifyToken, async (req, res) => {
  const table = req.params.table.toLowerCase();
  if (!tables[table]) return res.status(400).json({ error: "Invalid table" });

  try {
    const [rows] = await pool.query(`SELECT * FROM ${tables[table]}`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
