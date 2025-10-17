const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// =============================================================================
// HR_EMPLOYEES CRUD OPERATIONS
// =============================================================================

// GET all current employees
router.get('/employees-current', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id);
    console.log('🔍 Current database for query:', currentDb);
    console.log('🔍 User ID:', req.user_id);

    // Get employees first
    const [rows] = await pool.query(`
      SELECT * 
      FROM hr_employees 
      WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
      ORDER BY Empl_ID ASC
    `);

    // Add counts to each employee
    for (let employee of rows) {
      const [children] = await pool.query(
        'SELECT COUNT(*) as count FROM Children WHERE Empl_ID = ? AND chactive = 1',
        [employee.Empl_ID]
      );
      const [nok] = await pool.query(
        'SELECT COUNT(*) as count FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1',
        [employee.Empl_ID]
      );
      const [spouse] = await pool.query(
        'SELECT COUNT(*) as count FROM Spouse WHERE Empl_ID = ? AND spactive = 1',
        [employee.Empl_ID]
      );

      employee.children_count = children[0].count;
      employee.nok_count = nok[0].count;
      employee.spouse_count = spouse[0].count;
    }

    console.log('🔍 Query returned:', rows.length, 'records');
    //console.log('🔍 Employee IDs:', rows.map(r => r.Empl_ID).join(', '));

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET all current employees with pagination
router.get('/employees-current-pages', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id);
    console.log('🔍 Current database for query:', currentDb);
    console.log('🔍 User ID:', req.user_id);
    
    // Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    console.log('Pagination - Page:', page, 'Limit:', limit, 'Offset:', offset);
    
    // Get total count first
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM hr_employees 
      WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
    `);
    
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);
    
    // Get paginated employees
    const [rows] = await pool.query(`
      SELECT * 
      FROM hr_employees 
      WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
      ORDER BY Empl_ID ASC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Add counts to each employee
    for (let employee of rows) {
      const [children] = await pool.query(
        'SELECT COUNT(*) as count FROM Children WHERE Empl_ID = ? AND chactive = 1',
        [employee.Empl_ID]
      );
      const [nok] = await pool.query(
        'SELECT COUNT(*) as count FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1',
        [employee.Empl_ID]
      );
      const [spouse] = await pool.query(
        'SELECT COUNT(*) as count FROM Spouse WHERE Empl_ID = ? AND spactive = 1',
        [employee.Empl_ID]
      );
      
      employee.children_count = children[0].count;
      employee.nok_count = nok[0].count;
      employee.spouse_count = spouse[0].count;
    }
    
    console.log('🔍 Query returned:', rows.length, 'records');
    
    res.json({ 
      success: true, 
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error('❌ Query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

//Old Employees endpoint
router.get('/employees-old', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id);
    console.log('🔍 Current database for query:', currentDb);
    console.log('🔍 User ID:', req.user_id);
    
    // Get employees first
    const [rows] = await pool.query(`
      SELECT * 
      FROM hr_employees 
      WHERE DateLeft IS NOT NULL
        OR exittype IS NOT NULL
      ORDER BY Empl_ID ASC;
    `);

    // Add counts to each employee
    for (let employee of rows) {
      const [children] = await pool.query(
        'SELECT COUNT(*) as count FROM Children WHERE Empl_ID = ? AND chactive = 1',
        [employee.Empl_ID]
      );
      const [nok] = await pool.query(
        'SELECT COUNT(*) as count FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1',
        [employee.Empl_ID]
      );
      const [spouse] = await pool.query(
        'SELECT COUNT(*) as count FROM Spouse WHERE Empl_ID = ? AND spactive = 1',
        [employee.Empl_ID]
      );
      
      employee.children_count = children[0].count;
      employee.nok_count = nok[0].count;
      employee.spouse_count = spouse[0].count;
    }
    
    console.log('🔍 Query returned:', rows.length, 'records');
    //console.log('🔍 Employee IDs:', rows.map(r => r.Empl_ID).join(', '));
    
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single employee with all related data
router.get('/employees/:id', verifyToken, async (req, res) => {
  try {
    const [employee] = await pool.query(
      'SELECT * FROM hr_employees WHERE Empl_ID = ?', 
      [req.params.id]
    );
    
    if (employee.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const [children] = await pool.query(
      'SELECT * FROM Children WHERE Empl_ID = ? AND chactive = 1 ORDER BY dateofbirth', 
      [req.params.id]
    );

    const [nextOfKin] = await pool.query(
      'SELECT * FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1 ORDER BY NextofkinType DESC, FirstName', 
      [req.params.id]
    );

    const [spouse] = await pool.query(
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

//validation
router.get('/employees/check/:field/:value', verifyToken, async (req, res) => {
  const { field, value } = req.params;
  const { exclude } = req.query;

  // Only allow specific fields to prevent SQL injection
  const allowedFields = ["Empl_ID"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }

  try {
    let query = `SELECT ${field} FROM hr_employees WHERE ${field} = ?`;
    let params = [value];

    // If exclude Empl_ID is provided, exclude that record from the check
    if (exclude) {
      query += ' AND Empl_ID != ?';
      params.push(exclude);
    }

    const [existing] = await pool.query(query, params);

    res.json({ exists: existing.length > 0 });
  } catch (err) {
    console.error(`Error checking ${field}:`, err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST create employee
router.post('/employees', verifyToken, async (req, res) => {
  try {
    console.log('=== CREATE EMPLOYEE ===');
    console.log('Received fields:', Object.keys(req.body));
    console.log('Passport present?', !!req.body.passport);

    if (req.body.passport) {
      console.log('Passport length:', req.body.passport.length);
    }

    // Add created_by automatically
    const createdBy = req.user_fullname || 'System';
    req.body.createdby = createdBy;

    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const placeholders = fields.map(() => '?').join(', ');

    const query = `INSERT INTO hr_employees (${fields.join(', ')}) VALUES (${placeholders})`;
    console.log('Executing query with', fields.length, 'fields');

    const [result] = await pool.query(query, values);

    console.log('Insert successful, ID:', req.body.Empl_ID);

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employeeId: req.body.Empl_ID,
      created_by: createdBy
    });

  } catch (error) {
    console.error('CREATE ERROR:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update employee
router.put('/employees/:id', verifyToken, async (req, res) => {
  try {
    console.log('=== UPDATE EMPLOYEE ===');
    console.log('Employee ID:', req.params.id);
    console.log('Received fields:', Object.keys(req.body));
    console.log('Passport present?', !!req.body.passport);
    if (req.body.passport) {
      console.log('Passport length:', req.body.passport.length);
    }
    
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const query = `UPDATE hr_employees SET ${setClause} WHERE Empl_ID = ?`;
    const [result] = await pool.query(query, [...values, req.params.id]);
    
    console.log('Affected rows:', result.affectedRows);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (error) {
    console.error('UPDATE ERROR:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE employee (cascades to related tables)
router.delete('/employees/:id', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
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
    const [rows] = await pool.query(
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
    const [result] = await pool.query(query, values);
    
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
    const [result] = await pool.query(query, [...values, req.params.childId]);
    
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
    const [result] = await pool.query(
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
    const [rows] = await pool.query(
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
    const [result] = await pool.query(query, values);
    
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
    const [result] = await pool.query(query, [...values, req.params.nokId]);
    
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
    const [result] = await pool.query(
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
    const [rows] = await pool.query(
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
    const [result] = await pool.query(query, values);
    
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
    const [result] = await pool.query(query, [...values, req.params.spouseId]);
    
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
    const [result] = await pool.query(
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
    const [employee] = await pool.query(
      'SELECT * FROM hr_employees WHERE Empl_ID = ?', 
      [req.params.id]
    );
    
    if (employee.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const [children] = await pool.query(
      `SELECT *, YEAR(CURDATE()) - YEAR(dateofbirth) as age 
       FROM Children WHERE Empl_ID = ? AND chactive = 1 
       ORDER BY dateofbirth`, 
      [req.params.id]
    );

    const [nextOfKin] = await pool.query(
      `SELECT * FROM NextOfKin WHERE Empl_ID = ? AND IsActive = 1 
       ORDER BY NextofkinType DESC, FirstName`, 
      [req.params.id]
    );

    const [spouse] = await pool.query(
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
    await pool.query('UPDATE Children SET chactive = 0 WHERE Empl_ID = ?', [req.params.id]);
    await pool.query('UPDATE NextOfKin SET IsActive = 0 WHERE Empl_ID = ?', [req.params.id]);
    await pool.query('UPDATE Spouse SET spactive = 0 WHERE Empl_ID = ?', [req.params.id]);
    
    res.json({ success: true, message: 'All family records deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;