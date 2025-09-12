// Element Type CRUD Routes
const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
//const {verifyToken} = require('../middleware.js');

// POST - Create new element type
router.post('/elementtypes', async (req, res) => {
  const {
    PaymentType,
    elmDesc,
    Ledger,
    perc,
    std,
    maxi,
    bpay,
    yearend,
    Status,
    dependence,
    payfreq,
    pmonth,
    freetax,
    ipis
  } = req.body;

  const createdby = req.body.createdby || req.body.user_fullname || "Admin User";
  const datecreated = new Date();

  try {
    // Validate required fields
    if (!PaymentType || !bpay || !yearend) {
      return res.status(400).json({ error: 'PaymentType, bpay, and yearend are required fields' });
    }

    // Check if PaymentType already exists
    const [existing] = await pool.query('SELECT PaymentType FROM py_elementType WHERE PaymentType = ?', [PaymentType]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Payment type already exists' });
    }

    const [result] = await pool.query(
      `INSERT INTO py_elementType 
       (PaymentType, elmDesc, Ledger, perc, std, maxi, bpay, yearend, Status, dependence, payfreq, pmonth, freetax, createdby, datecreated, ipis) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [PaymentType, elmDesc, Ledger, perc, std, maxi, bpay, yearend, Status, dependence, payfreq, pmonth, freetax, createdby, datecreated, ipis]
    );

    res.status(201).json({
      message: 'Element type created successfully',
      PaymentType,
      elmDesc,
      Status: Status || 'Active'
    });

  } catch (err) {
    console.error('Error creating element type:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Payment type already exists' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// GET - Get all element types
router.get('/elementtypes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT PaymentType, elmDesc, Ledger, perc, std, maxi, bpay, yearend, 
             Status, dependence, payfreq, pmonth, freetax, createdby, datecreated, ipis
      FROM py_elementType 
      ORDER BY PaymentType
    `);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching element types:', err);
    res.status(500).json({ error: 'Failed to fetch element types' });
  }
});

// GET - Get individual element type by PaymentType
router.get('/elementtypes/:PaymentType', async (req, res) => {
  try {
    const { PaymentType } = req.params;
    const [rows] = await pool.query('SELECT * FROM py_elementType WHERE PaymentType = ?', [PaymentType]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Element type not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching element type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT - Update element type
router.put('/elementtypes/:PaymentType', async (req, res) => {
  const { PaymentType } = req.params;
  const {
    elmDesc,
    Ledger,
    perc,
    std,
    maxi,
    bpay,
    yearend,
    Status,
    dependence,
    payfreq,
    pmonth,
    freetax,
    ipis
  } = req.body;

  try {
    // Check if element type exists
    const [existingRows] = await pool.query('SELECT PaymentType FROM py_elementType WHERE PaymentType = ?', [PaymentType]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Element type not found' });
    }

    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof elmDesc !== 'undefined' && elmDesc !== null) {
      sets.push('elmDesc = ?'); params.push(elmDesc);
    }
    if (typeof Ledger !== 'undefined' && Ledger !== null) {
      sets.push('Ledger = ?'); params.push(Ledger);
    }
    if (typeof perc !== 'undefined' && perc !== null) {
      sets.push('perc = ?'); params.push(perc);
    }
    if (typeof std !== 'undefined' && std !== null) {
      sets.push('std = ?'); params.push(std);
    }
    if (typeof maxi !== 'undefined' && maxi !== null) {
      sets.push('maxi = ?'); params.push(maxi);
    }
    if (typeof bpay !== 'undefined' && bpay !== null) {
      sets.push('bpay = ?'); params.push(bpay);
    }
    if (typeof yearend !== 'undefined' && yearend !== null) {
      sets.push('yearend = ?'); params.push(yearend);
    }
    if (typeof Status !== 'undefined' && Status !== null) {
      sets.push('Status = ?'); params.push(Status);
    }
    if (typeof dependence !== 'undefined' && dependence !== null) {
      sets.push('dependence = ?'); params.push(dependence);
    }
    if (typeof payfreq !== 'undefined' && payfreq !== null) {
      sets.push('payfreq = ?'); params.push(payfreq);
    }
    if (typeof pmonth !== 'undefined' && pmonth !== null) {
      sets.push('pmonth = ?'); params.push(pmonth);
    }
    if (typeof freetax !== 'undefined' && freetax !== null) {
      sets.push('freetax = ?'); params.push(freetax);
    }
    if (typeof ipis !== 'undefined' && ipis !== null) {
      sets.push('ipis = ?'); params.push(ipis);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add PaymentType for WHERE clause
    params.push(PaymentType);

    const sql = `UPDATE py_elementType SET ${sets.join(', ')} WHERE PaymentType = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_elementType WHERE PaymentType = ?', [PaymentType]);
    
    res.json({
      message: 'Element type updated successfully',
      elementType: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating element type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE - Delete element type
router.delete('/elementtypes/:PaymentType', async (req, res) => {
  const { PaymentType } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_elementType WHERE PaymentType = ?', [PaymentType]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Element type not found' });
    }

    res.json({ 
      message: 'Element type deleted successfully',
      PaymentType: PaymentType 
    });
    
  } catch (err) {
    console.error('Error deleting element type:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET - Get active element types only
router.get('/elementtypes/active/list', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT PaymentType, elmDesc, Status 
      FROM py_elementType 
      WHERE Status = 'Active' 
      ORDER BY elmDesc
    `);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching active element types:', err);
    res.status(500).json({ error: 'Failed to fetch active element types' });
  }
});

// GET - Get element types by dependency
router.get('/elementtypes/dependency/:dependence', async (req, res) => {
  try {
    const { dependence } = req.params;
    const [rows] = await pool.query(`
      SELECT PaymentType, elmDesc, Status 
      FROM py_elementType 
      WHERE dependence = ? 
      ORDER BY elmDesc
    `, [dependence]);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching dependent element types:', err);
    res.status(500).json({ error: 'Failed to fetch dependent element types' });
  }
});

module.exports = router;