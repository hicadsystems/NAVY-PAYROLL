const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool = require('../../config/db'); // mysql2 pool

// ==================== CREATE ====================
router.post('/create', verifyToken, async (req, res) => {
  const { classcode, classname, year, month } = req.body;

  // Validation
  if (!classcode || classcode.trim() === '') {
    return res.status(400).json({ error: 'Class code is required' });
  }

  if (classcode.length > 5) {
    return res.status(400).json({ error: 'Class code must not exceed 5 characters' });
  }

  if (classname && classname.length > 30) {
    return res.status(400).json({ error: 'Class name must not exceed 30 characters' });
  }

  if (!year || !month) {
    return res.status(400).json({ error: 'Year and month are required' });
  }

  // Validate year (4 digits)
  if (!/^\d{4}$/.test(year.toString())) {
    return res.status(400).json({ error: 'Year must be a 4-digit number' });
  }

  // Validate month (1-12)
  const monthNum = parseInt(month);
  if (monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ error: 'Month must be between 1 and 12' });
  }

  try {
    const query = `
      INSERT INTO py_payrollclass (classcode, classname, year, month)
      VALUES (?, ?, ?, ?)
    `;

    await pool.query(query, [
      classcode.trim(),
      classname ? classname.trim() : null,
      parseInt(year),
      monthNum
    ]);

    res.status(201).json({
      message: 'New Payroll class created successfully',
      data: {
        classcode: classcode.trim(),
        classname: classname ? classname.trim() : null,
        year: parseInt(year),
        month: monthNum
      }
    });

  } catch (error) {
    console.error('Error creating payroll class:', error);

    // Handle duplicate key error
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Payroll class with this code, year, and month already exists'
      });
    }

    res.status(500).json({ error: 'Failed to create payroll class' });
  }
});

// ==================== READ ====================
router.get('/', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT classcode, classname, year, month,
      LOWER(COALESCE(status, 'inactive')) AS status
      FROM py_payrollclass
      ORDER BY classcode ASC
    `;

    const [rows] = await pool.query(query);

    res.status(200).json({
      message: 'Payroll classes retrieved successfully',
      data: rows,
      count: rows.length
    });

  } catch (error) {
    console.error('Error fetching payroll classes:', error);
    res.status(500).json({ error: 'Failed to fetch payroll classes' });
  }
});

// Get single payroll class by code
router.get('/:classcode', verifyToken, async (req, res) => {
  const { classcode } = req.params;

  try {
    const query = `
      SELECT classcode, classname, year, month, 
      LOWER(COALESCE(status, 'inactive')) AS status
      FROM py_payrollclass
      WHERE classcode = ?
    `;

    const [rows] = await pool.query(query, [classcode]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    res.status(200).json({
      message: 'Payroll class retrieved successfully',
      data: rows[0]
    });

  } catch (error) {
    console.error('Error fetching payroll class:', error);
    res.status(500).json({ error: 'Failed to fetch payroll class' });
  }
});

// ==================== UPDATE ==================== 
router.put('/:classcode', verifyToken, async (req, res) => {
  const { classcode } = req.params;
  const { newClasscode, classname, year, month, status } = req.body;

  // Validation
  if (classname && classname.length > 30) {
    return res.status(400).json({ error: 'Class name must not exceed 30 characters' });
  }

  if (status && !['active', 'inactive'].includes(status.toLowerCase())) {
    return res.status(400).json({ error: 'Status must be either "active" or "inactive"' });
  }

  try {
    // Check if record exists
    const [existing] = await pool.query(
      `SELECT * FROM py_payrollclass WHERE classcode = ?`,
      [classcode]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    // Check if new classcode already exists (when changing classcode)
    if (newClasscode && newClasscode !== classcode) {
      const [duplicate] = await pool.query(
        `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
        [newClasscode]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ error: 'New class code already exists' });
      }
    }

    // Build dynamic query
    const fields = [];
    const values = [];

    if (newClasscode) {
      fields.push('classcode = ?');
      values.push(newClasscode.trim());
    }

    if (classname) {
      fields.push('classname = ?');
      values.push(classname.trim());
    }

    if (year) {
      fields.push('year = ?');
      values.push(year);
    }

    if (month) {
      fields.push('month = ?');
      values.push(month);
    }

    if (status) {
      fields.push('status = ?');
      values.push(status.toLowerCase());
    }

    // Always update timestamp
    fields.push('dateupdated = NOW()');

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    values.push(classcode); // for WHERE clause

    const updateQuery = `
      UPDATE py_payrollclass
      SET ${fields.join(', ')}
      WHERE classcode = ?
    `;

    await pool.query(updateQuery, values);

    res.status(200).json({
      message: 'Payroll class updated successfully',
      data: {
        classcode: newClasscode || classcode,
        classname,
        year,
        month,
        status,
        dateupdated: new Date().toISOString().slice(0, 19).replace('T', ' ')
      }
    });

  } catch (error) {
    console.error('Error updating payroll class:', error);
    res.status(500).json({ error: 'Failed to update payroll class' });
  }
});

// ==================== DELETE ====================
router.delete('/:classcode', verifyToken, async (req, res) => {
  const { classcode } = req.params;

  try {
    // Check if record exists
    const [existing] = await pool.query(
      `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
      [classcode]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    // Delete record
    await pool.query(`DELETE FROM py_payrollclass WHERE classcode = ?`, [classcode]);

    res.status(200).json({
      message: 'Payroll class deleted successfully',
      data: { classcode }
    });

  } catch (error) {
    console.error('Error deleting payroll class:', error);

    // Handle foreign key constraint error
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
      return res.status(409).json({
        error: 'Cannot delete payroll class. It is being referenced by other records.'
      });
    }

    res.status(500).json({ error: 'Failed to delete payroll class' });
  }
});

module.exports = router;
