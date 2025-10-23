const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');



//------------ API LOGICS -----------------//
//GET
router.get('/', verifyToken, async(req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_cumulated");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//GET SINGLE CUMMULATIVE
router.get('/:Empl_ID', verifyToken, async(req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM py_cumulated WHERE Empl_ID = ?", [req.params.Empl_ID]);
    if (rows.length === 0) 
        return 
        res.status(404).json({ 
            error: "Not found" 
        });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ 
        error: err.message 
    });
  }
});

//POST
router.post('/create', verifyToken, async(req, res) => {
  let {
    Empl_ID,
    taxabletodate,
    taxtodate,
    nettodate,
    grosstodate,
  } = req.body;

  const now = new Date();

  const createdby = req.user_fullname || "Admin User";
  const datecreated = now;
  const procmth = now.getMonth() + 1;

  try{
    // Validate required fields
    if (!Empl_ID) {
      return res.status(400).json({ error: 'Service No is required' });
    }

    const [result] = await pool.query(`
      INSERT INTO py_cumulated
        (Empl_ID,
        procmth,
        taxabletodate,
        taxtodate,
        nettodate,
        grosstodate,
        createdby, 
        datecreated)
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)`
        ,
      [Empl_ID, procmth, taxabletodate, taxtodate, nettodate, grosstodate, createdby, datecreated]
    );

    res.status(201).json({
        message: 'Cummulative created sucessfully',
        Empl_ID
    });
  } catch (err) {
    console.error('Error creating cummulative:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//UPDATE
router.put('/:Empl_ID', verifyToken, async(req, res) => {
    const {Empl_ID} = req.params;
    const {
    taxabletodate,
    taxtodate,
    nettodate,
    grosstodate,
  } = req.body;

  try{
    // Check if SErvice No. exists
    const [existingRows] = await pool.query('SELECT Empl_ID FROM py_cummulative WHERE Empl_ID = ?', [Empl_ID]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Service No. not found' });
    }
    
    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof Empl_ID !== 'undefined' && Empl_ID !== null) {
      sets.push('Empl_ID = ?'); params.push(Empl_ID);
    }
    if (typeof taxabletodate !== 'undefined' && taxabletodate !== null) {
      sets.push('taxabletodate = ?'); params.push(taxabletodate);
    }
    if (typeof taxtodate !== 'undefined' && taxtodate !== null) {
      sets.push('taxtodate = ?'); params.push(taxtodate);
    }
    if (typeof nettodate !== 'undefined' && nettodate !== null) {
      sets.push('nettodate = ?'); params.push(nettodate);
    }
    if (typeof grosstodate !== 'undefined' && grosstodate !== null) {
      sets.push('grosstodate = ?'); params.push(grosstodate);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add PaymentType for WHERE clause
    params.push(Empl_ID);

    const sql = `UPDATE py_cumulated SET ${sets.join(', ')} WHERE Empl_ID = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_cumulated WHERE Empl_ID = ?', [Empl_ID]);
    res.json({
      message: 'Cummulative updated successfully',
      cummulative: updatedRows[0]
    });

  } catch (err) {
    console.error('Error updating cummulative:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//DELETE
router.delete('/:Empl_ID', verifyToken, async(req, res) => {
  const { Empl_ID } = req.params;
  
  try {
    const [result] = await pool.query('DELETE FROM py_cumulated WHERE Empl_ID = ?', [Empl_ID]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'SErvice No. not found' });
    }

    res.json({ 
      message: 'Cummulative deleted successfully',
      Empl_ID: Empl_ID 
    });
    
  } catch{
    console.error('Error deleting cummulative:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;