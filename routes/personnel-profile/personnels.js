const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// =============================================================================
// HR_EMPLOYEES CRUD OPERATIONS
// =============================================================================

// GET all employees
router.get('/employees', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT e.*, 
             COUNT(DISTINCT c.child_id) as children_count,
             COUNT(DISTINCT n.nok_id) as nok_count,
             COUNT(DISTINCT s.spouse_id) as spouse_count
      FROM hr_employees e
      LEFT JOIN Children c ON e.Empl_ID = c.Empl_ID AND c.chactive = 1
      LEFT JOIN NextOfKin n ON e.Empl_ID = n.Empl_ID AND n.IsActive = 1
      LEFT JOIN Spouse s ON e.Empl_ID = s.Empl_ID AND s.spactive = 1
      GROUP BY e.Empl_ID
      ORDER BY e.Surname, e.OtherName
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single employee with all related data
router.get('/employees/:id', verifyToken, async (req, res) => {
  try {
    const [employee] = await pool.execute(
      'SELECT * FROM hr_employees WHERE Empl_ID = ?', 
      [req.params.id]
    );
    
    if (employee.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const [children] = await pool.execute(
      'SELECT * FROM Children WHERE Empl_ID = ? AND chactive = 1 ORDER BY dateofbirth', 
      [req.params.id]
    );

    const [nextOfKin] = await pool.execute(
      'SELECT * FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1 ORDER BY NextofkinType DESC, FirstName', 
      [req.params.id]
    );

    const [spouse] = await pool.execute(
      'SELECT * FROM Spouse WHERE Empl_ID = ? AND spactive = 1 ORDER BY marrieddate DESC', 
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        employee: employee[0],
        children: children,
        nextOfKin: nextOfKin,
        spouse: spouse
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST create new employee
router.post('/employees', verifyToken, async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const placeholders = fields.map(() => '?').join(', ');
    
    const query = `INSERT INTO hr_employees (${fields.join(', ')}) VALUES (${placeholders})`;
    const [result] = await pool.execute(query, values);
    
    res.status(201).json({ 
      success: true, 
      message: 'Employee created successfully',
      employeeId: req.body.Empl_ID 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update employee
router.put('/employees/:id', verifyToken, async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const query = `UPDATE hr_employees SET ${setClause} WHERE Empl_ID = ?`;
    const [result] = await pool.execute(query, [...values, req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE employee (cascades to related tables)
router.delete('/employees/:id', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM hr_employees WHERE Empl_ID = ?', 
      [req.params.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    res.json({ success: true, message: 'Employee and all related records deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// CHILDREN CRUD OPERATIONS
// =============================================================================

// GET all children for an employee
router.get('/employees/:id/children', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM Children WHERE Empl_ID = ? AND chactive = 1 ORDER BY dateofbirth', 
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST create new child
router.post('/employees/:id/children', verifyToken, async (req, res) => {
  try {
    const childData = { ...req.body, Empl_ID: req.params.id };
    const fields = Object.keys(childData);
    const values = Object.values(childData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const query = `INSERT INTO Children (${fields.join(', ')}) VALUES (${placeholders})`;
    const [result] = await pool.execute(query, values);
    
    res.status(201).json({ 
      success: true, 
      message: 'Child record created successfully',
      childId: result.insertId 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update child
router.put('/children/:childId', verifyToken, async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const query = `UPDATE Children SET ${setClause} WHERE child_id = ?`;
    const [result] = await pool.execute(query, [...values, req.params.childId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Child record not found' });
    }
    
    res.json({ success: true, message: 'Child record updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE child (soft delete by setting chactive = 0)
router.delete('/children/:childId', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE Children SET chactive = 0 WHERE child_id = ?', 
      [req.params.childId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Child record not found' });
    }
    
    res.json({ success: true, message: 'Child record deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// NEXT OF KIN CRUD OPERATIONS
// =============================================================================

// GET all next of kin for an employee
router.get('/employees/:id/nextofkin', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1 ORDER BY NextofkinType DESC, FirstName', 
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST create new next of kin
router.post('/employees/:id/nextofkin', verifyToken, async (req, res) => {
  try {
    const nokData = { ...req.body, Empl_ID: req.params.id };
    const fields = Object.keys(nokData);
    const values = Object.values(nokData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const query = `INSERT INTO NextOfKin (${fields.join(', ')}) VALUES (${placeholders})`;
    const [result] = await pool.execute(query, values);
    
    res.status(201).json({ 
      success: true, 
      message: 'Next of kin record created successfully',
      nokId: result.insertId 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update next of kin
router.put('/nextofkin/:nokId', verifyToken, async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const query = `UPDATE NextOfKin SET ${setClause} WHERE nok_id = ?`;
    const [result] = await pool.execute(query, [...values, req.params.nokId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Next of kin record not found' });
    }
    
    res.json({ success: true, message: 'Next of kin record updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE next of kin (soft delete by setting IsActive = 0)
router.delete('/nextofkin/:nokId', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE NextOfKin SET IsActive = 0 WHERE nok_id = ?', 
      [req.params.nokId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Next of kin record not found' });
    }
    
    res.json({ success: true, message: 'Next of kin record deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// SPOUSE CRUD OPERATIONS
// =============================================================================

// GET all spouse records for an employee
router.get('/employees/:id/spouse', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM Spouse WHERE Empl_ID = ? AND spactive = 1 ORDER BY marrieddate DESC', 
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST create new spouse record
router.post('/employees/:id/spouse', verifyToken, async (req, res) => {
  try {
    const spouseData = { ...req.body, Empl_ID: req.params.id };
    const fields = Object.keys(spouseData);
    const values = Object.values(spouseData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const query = `INSERT INTO Spouse (${fields.join(', ')}) VALUES (${placeholders})`;
    const [result] = await pool.execute(query, values);
    
    res.status(201).json({ 
      success: true, 
      message: 'Spouse record created successfully',
      spouseId: result.insertId 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update spouse
router.put('/spouse/:spouseId', verifyToken, async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const query = `UPDATE Spouse SET ${setClause} WHERE spouse_id = ?`;
    const [result] = await pool.execute(query, [...values, req.params.spouseId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Spouse record not found' });
    }
    
    res.json({ success: true, message: 'Spouse record updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE spouse (soft delete by setting spactive = 0)
router.delete('/spouse/:spouseId', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE Spouse SET spactive = 0 WHERE spouse_id = ?', 
      [req.params.spouseId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Spouse record not found' });
    }
    
    res.json({ success: true, message: 'Spouse record deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// BULK OPERATIONS
// =============================================================================

// GET complete family profile (employee + all related records)
router.get('/employees/:id/profile', verifyToken, async (req, res) => {
  try {
    const [employee] = await pool.execute(
      'SELECT * FROM hr_employees WHERE Empl_ID = ?', 
      [req.params.id]
    );
    
    if (employee.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const [children] = await pool.execute(
      `SELECT *, YEAR(CURDATE()) - YEAR(dateofbirth) as age 
       FROM Children WHERE Empl_ID = ? AND chactive = 1 
       ORDER BY dateofbirth`, 
      [req.params.id]
    );

    const [nextOfKin] = await pool.execute(
      `SELECT * FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1 
       ORDER BY NextofkinType DESC, FirstName`, 
      [req.params.id]
    );

    const [spouse] = await pool.execute(
      `SELECT * FROM Spouse WHERE Empl_ID = ? AND spactive = 1 
       ORDER BY marrieddate DESC`, 
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        employee: employee[0],
        family: {
          children: children,
          nextOfKin: nextOfKin,
          spouse: spouse,
          summary: {
            totalChildren: children.length,
            totalNOK: nextOfKin.length,
            totalSpouse: spouse.length
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE all family records for an employee (soft delete)
router.delete('/employees/:id/family', verifyToken, async (req, res) => {
  try {
    await pool.execute('UPDATE Children SET chactive = 0 WHERE Empl_ID = ?', [req.params.id]);
    await pool.execute('UPDATE NextOfKin SET IsActive = 0 WHERE Empl_ID = ?', [req.params.id]);
    await pool.execute('UPDATE Spouse SET spactive = 0 WHERE Empl_ID = ?', [req.params.id]);
    
    res.json({ success: true, message: 'All family records deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;