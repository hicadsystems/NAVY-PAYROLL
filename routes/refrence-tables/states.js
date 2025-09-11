const express = require('express');
const pool = require('../../db.js'); // mysql2 pool
const router = express.Router();
//const {verifyToken} = require('../middleware.js');

// POST - Create new state
router.post('/states', async (req, res) => {
  // Accept both formats (camelCase from frontend, PascalCase from DB)
  const Statecode = req.body.Statecode || req.body.stateCode;
  const Statename = req.body.Statename || req.body.stateName;
  const Statecapital = req.body.Statecapital || req.body.stateCapital;
  const createdby = req.body.user_fullname || "Admin User"; // fallback if not sent
  const datecreated = new Date();

  try {
    if (!Statecode || !Statename || !Statecapital) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const [result] = await pool.query(
      `INSERT INTO py_tblstates 
       (Statecode, Statename, Statecapital, createdby, datecreated) 
       VALUES (?, ?, ?, ?, ?)`,
      [Statecode, Statename, Statecapital, createdby, datecreated]
    );

    res.status(201).json({
      message: 'State created',
      id: result.insertId,
      Statecode,
      Statename,
      Statecapital,
      createdby
    });

  } catch (err) {
    console.error('Error creating state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET - Get all states
router.get("/states", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_tblstates");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching states:", err);
    res.status(500).json({ error: "Failed to fetch states" });
  }
});

// GET - Get individual state by Statecode
router.get('/states/:Statecode', async (req, res) => {
  try {
    const { Statecode } = req.params;
    const [rows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update state
router.put('/states/:Statecode', async (req, res) => {
  const { Statecode } = req.params;
  // Accept both formats from frontend
  const Statename = req.body.Statename || req.body.stateName;
  const Statecapital = req.body.Statecapital || req.body.stateCapital;
  const createdby = req.body.createdby || req.body.user_fullname || "Admin User";

  try {
    // Check if state exists first
    const [existingRows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof Statename !== 'undefined' && Statename !== null) {
      sets.push('Statename = ?');
      params.push(Statename);
    }
    if (typeof Statecapital !== 'undefined' && Statecapital !== null) {
      sets.push('Statecapital = ?');
      params.push(Statecapital);
    }
    if (typeof createdby !== 'undefined' && createdby !== null) {
      sets.push('createdby = ?');
      params.push(createdby);
    }

    // If no fields to update
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add Statecode for WHERE clause
    params.push(Statecode);

    const sql = `UPDATE py_tblstates SET ${sets.join(', ')} WHERE Statecode = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_tblstates WHERE Statecode = ?', [Statecode]);
    
    res.json({
      message: 'State updated successfully',
      state: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Delete state
router.delete('/states/:Statecode', async (req, res) => {
  const { Statecode } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_tblstates WHERE Statecode = ?', [Statecode]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    res.json({ 
      message: 'State deleted successfully',
      Statecode: Statecode 
    });
    
  } catch (err) {
    console.error('Error deleting state:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;