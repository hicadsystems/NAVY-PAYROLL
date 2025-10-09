const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool  = require('../../config/db'); // mysql2 pool

// ==================== GET ALL EMPLOYEES ====================
// GET /api/personnel/employees - Get all active employees with payroll class
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

// ==================== GET PAYROLL CLASS STATISTICS ====================
// GET /api/personnel/payroll-class-stats - Get count of personnel per payroll class
router.get('/payroll-class-stats', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        e.payrollclass,
        pc.classname,
        COUNT(*) AS count
      FROM hr_employees e
      LEFT JOIN py_payrollclass pc 
        ON e.payrollclass COLLATE utf8mb3_general_ci = pc.classcode COLLATE utf8mb3_general_ci
      WHERE 
        (e.DateLeft IS NULL OR e.DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
        AND e.payrollclass IS NOT NULL
        AND e.payrollclass != ''
      GROUP BY 
        e.payrollclass, pc.classname
      ORDER BY 
        e.payrollclass ASC;
    `;

    const [rows] = await pool.query(query);

    // Handle no data
    if (!rows || rows.length === 0) {
      return res.status(200).json({
        message: 'No payroll class statistics found',
        data: {}
      });
    }

    // Transform to object format
    const stats = {};
    rows.forEach(row => {
      stats[row.payrollclass] = {
        classname: row.classname || '',
        count: row.count
      };
    });

    res.status(200).json({
      message: 'Payroll class statistics retrieved successfully',
      data: stats
    });

  } catch (error) {
    console.error('Error fetching payroll class statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ==================== UPDATE EMPLOYEE PAYROLL CLASS ====================
// POST /api/personnel/payroll-class - Change employee payroll class
router.post('/payroll-class', verifyToken, async (req, res) => {
  const { Empl_ID, PayrollClass } = req.body;

  // Basic validation
  if (!Empl_ID || Empl_ID.trim() === '') {
    return res.status(400).json({ error: 'Employee ID is required' });
  }

  if (!PayrollClass || PayrollClass.trim() === '') {
    return res.status(400).json({ error: 'Payroll class is required' });
  }

  try {
    const employeeId = Empl_ID.trim();
    const payrollClass = PayrollClass.trim();

    // 1. Check if employee exists and is active
    const [employeeRows] = await pool.query(
      `
      SELECT Empl_ID, payrollclass, Surname, OtherName
      FROM hr_employees
      WHERE Empl_ID = ?
        AND (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
      `,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      return res.status(404).json({ error: 'Employee not found or inactive' });
    }

    const employee = employeeRows[0];
    const oldPayrollClass = employee.payrollclass;

    // 2. Check if payroll class exists
    const [classRows] = await pool.query(
      `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
      [payrollClass]
    );

    if (classRows.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    // 3. Prevent duplicate assignment
    if (oldPayrollClass === payrollClass) {
      return res.status(400).json({ error: 'Employee is already in this payroll class' });
    }

    //4. Update employee payroll class
    await pool.query(
      `
      UPDATE hr_employees
      SET payrollclass = ?
      WHERE Empl_ID = ?
      `,
      [payrollClass, employeeId]
    );

    // 5. Respond success
    res.status(200).json({
      message: 'Payroll class updated successfully',
      data: {
        Empl_ID: employeeId,
        Name: `${employee.Surname} ${employee.OtherName || ''}`.trim(),
        OldPayrollClass: oldPayrollClass,
        NewPayrollClass: payrollClass
      }
    });

  } catch (error) {
    console.error('❌ Error updating payroll class:', error);
    res.status(500).json({ error: 'Failed to update payroll class', details: error.message });
  }
});

module.exports = router;