const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool = require('../../config/db'); // mysql2 pool


// ==================== GET ALL EMPLOYEES ====================
router.get('/employees', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM hr_employees
      WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '');
    `;

    const [rows] = await pool.query(query);

    res.status(200).json({
      message: 'Employees retrieved successfully',
      data: rows,
      count: rows.length
    });

  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ 
      error: 'Failed to fetch employees', 
      details: error.message 
    });
  }
});

// ==================== UPDATE EMPLOYEE REGISTRATION NUMBER ====================
router.put('/update-regno', verifyToken, async (req, res) => {
  const { oldRegNo, newRegNo } = req.body;

  // Validation
  if (!oldRegNo || !newRegNo) {
    return res.status(400).json({
      error: 'Both current and new registration numbers are required.'
    });
  }

  if (oldRegNo.trim() === newRegNo.trim()) {
    return res.status(400).json({
      error: 'New registration number cannot be the same as the old one.'
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check if old reg number exists
    const [oldEmployee] = await conn.query(
      'SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?',
      [oldRegNo]
    );

    if (oldEmployee.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        error: `No employee found with registration number "${oldRegNo}".`
      });
    }

    // Check if new reg number already exists
    const [existing] = await conn.query(
      'SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?',
      [newRegNo]
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        error: `The registration number "${newRegNo}" already exists.`
      });
    }

    // Update ONLY the main table - CASCADE handles the rest
    const [result] = await conn.query(
      'UPDATE hr_employees SET Empl_ID = ? WHERE Empl_ID = ?',
      [newRegNo, oldRegNo]
    );

    // Commit - all related tables updated automatically via CASCADE
    await conn.commit();

    res.status(200).json({
      message: 'Registration number updated successfully. All related records updated automatically via foreign key cascades.',
      data: {
        oldRegNo,
        newRegNo,
        rowsUpdated: result.affectedRows
      }
    });

  } catch (error) {
    console.error(' Error updating registration number:', error);
    await conn.rollback();
    
    // Check for foreign key constraint violations
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({
        error: 'Cannot update due to foreign key constraint violation.',
        details: error.message
      });
    }

    res.status(500).json({
      error: 'Failed to update registration number.',
      details: error.message
    });

  } finally {
    conn.release();
  }
});

module.exports = router;