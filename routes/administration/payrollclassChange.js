const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool  = require('../../config/db'); // mysql2 pool

// ==================== GET ALL EMPLOYEES ====================
// GET /api/personnel/employees - Get all active employees with payroll class
router.get('/active-employees', verifyToken, async (req, res) => {
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
        ON e.payrollclass
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
// Database mapping configuration (BACKEND ONLY)
const DATABASE_MAP = {
  [process.env.DB_OFFICERS || 'hicaddata']: { name: 'OFFICERS', code: '1' },
  [process.env.DB_WOFFICERS || 'hicaddata1']: { name: 'W/OFFICERS', code: '2' },
  [process.env.DB_RATINGS || 'hicaddata2']: { name: 'RATE A', code: '3' },
  [process.env.DB_RATINGS_A || 'hicaddata3']: { name: 'RATE B', code: '4' },
  [process.env.DB_RATINGS_B || 'hicaddata4']: { name: 'RATE C', code: '5' },
  [process.env.DB_JUNIOR_TRAINEE || 'hicaddata5']: { name: 'TRAINEE', code: '6' }
};

// Payroll Class Code to Database Name Mapping
const PAYROLL_CLASS_TO_DB_MAP = {
  // Numeric codes from table
  '1': process.env.DB_OFFICERS || 'hicaddata',
  '2': process.env.DB_WOFFICERS || 'hicaddata1',
  '3': process.env.DB_RATINGS || 'hicaddata2',
  '4': process.env.DB_RATINGS_A || 'hicaddata3',
  '5': process.env.DB_RATINGS_B || 'hicaddata4',
  '6': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  
  // Description names from table
  'OFFICERS': process.env.DB_OFFICERS || 'hicaddata',
  'W/OFFICERS': process.env.DB_WOFFICERS || 'hicaddata1',
  'W.OFFICERS': process.env.DB_WOFFICERS || 'hicaddata1',
  'RATE A': process.env.DB_RATINGS || 'hicaddata2',
  'RATEA': process.env.DB_RATINGS || 'hicaddata2',
  'RATE B': process.env.DB_RATINGS_A || 'hicaddata3',
  'RATEB': process.env.DB_RATINGS_A || 'hicaddata3',
  'RATE C': process.env.DB_RATINGS_B || 'hicaddata4',
  'RATEC': process.env.DB_RATINGS_B || 'hicaddata4',
  'JUNIOR/TRAINEE': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  'JUNIORTRAINEE': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  
  // Also support database names directly
  'hicaddata': process.env.DB_OFFICERS || 'hicaddata',
  'hicaddata1': process.env.DB_WOFFICERS || 'hicaddata1',
  'hicaddata2': process.env.DB_RATINGS || 'hicaddata2',
  'hicaddata3': process.env.DB_RATINGS_A || 'hicaddata3',
  'hicaddata4': process.env.DB_RATINGS_B || 'hicaddata4',
  'hicaddata5': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  
  [process.env.DB_OFFICERS || 'hicaddata']: process.env.DB_OFFICERS || 'hicaddata',
  [process.env.DB_WOFFICERS || 'hicaddata1']: process.env.DB_WOFFICERS || 'hicaddata1',
  [process.env.DB_RATINGS || 'hicaddata2']: process.env.DB_RATINGS || 'hicaddata2',
  [process.env.DB_RATINGS_A || 'hicaddata3']: process.env.DB_RATINGS_A || 'hicaddata3',
  [process.env.DB_RATINGS_B || 'hicaddata4']: process.env.DB_RATINGS_B || 'hicaddata4',
  [process.env.DB_JUNIOR_TRAINEE || 'hicaddata5']: process.env.DB_JUNIOR_TRAINEE || 'hicaddata5'
};

// Helper function to convert payroll class code to database name
function getDbNameFromPayrollClass(payrollClass) {
  // Try exact match first
  if (PAYROLL_CLASS_TO_DB_MAP[payrollClass]) {
    return PAYROLL_CLASS_TO_DB_MAP[payrollClass];
  }
  
  // Try case-insensitive match
  const upperClass = payrollClass.toString().toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.toUpperCase() === upperClass) {
      return value;
    }
  }
  
  // Try removing spaces and special characters
  const cleanClass = payrollClass.toString().replace(/[\s\/\-_]/g, '').toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.replace(/[\s\/\-_]/g, '').toUpperCase() === cleanClass) {
      return value;
    }
  }
  
  // If no match found, return as-is (might already be a database name)
  return payrollClass;
}

// Helper function to get friendly database name
function getFriendlyDbName(dbId) {
  return DATABASE_MAP[dbId]?.name || dbId;
}

// Helper function to validate database exists
function isValidDatabase(dbId) {
  return Object.keys(DATABASE_MAP).includes(dbId);
}

// ==================== CRITICAL: Check if database physically exists ====================
async function checkDatabaseExists(dbName) {
  let connection = null;
  try {
    connection = await pool.getConnection();
    await connection.query(`SHOW DATABASES LIKE '${dbName}'`);
    const [rows] = await connection.query(`SHOW DATABASES LIKE '${dbName}'`);
    connection.release();
    return rows.length > 0;
  } catch (error) {
    if (connection) connection.release();
    return false;
  }
}

// ==================== UPDATE EMPLOYEE PAYROLL CLASS WITH DATABASE MIGRATION ====================
router.post('/payroll-class', verifyToken, async (req, res) => {
  const { Empl_ID, PayrollClass } = req.body;

  if (!Empl_ID || Empl_ID.trim() === '') {
    return res.status(400).json({ success: false, error: 'Employee ID is required' });
  }

  if (!PayrollClass || PayrollClass.trim() === '') {
    return res.status(400).json({ success: false, error: 'Payroll class is required' });
  }

  const employeeId = Empl_ID.trim();
  const payrollClassInput = PayrollClass.toString().trim();

  // Convert payroll class code to database name
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;

  console.log(`📋 Payroll class mapping:`);
  console.log(`   Input: ${payrollClassInput}`);
  console.log(`   Resolved to DB: ${targetDb}`);
  console.log(`   Source DB: ${sourceDb}`);

  if (!sourceDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source database context not found. Please ensure you are logged in.' 
    });
  }

  // Validate both databases exist in our mapping
  if (!isValidDatabase(sourceDb)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid source database: ${sourceDb}`,
      debug: {
        sourceDb,
        validDatabases: Object.keys(DATABASE_MAP)
      }
    });
  }

  if (!isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid target database: ${targetDb}. Could not map payroll class "${payrollClassInput}" to a database.`,
      debug: {
        payrollClassInput,
        resolvedDb: targetDb,
        availableMappings: Object.keys(PAYROLL_CLASS_TO_DB_MAP).slice(0, 20), // Show first 20 for debugging
        hint: 'The payroll class code does not match any known database'
      }
    });
  }

  // CRITICAL: Check if target database physically exists
  const targetExists = await checkDatabaseExists(targetDb);
  if (!targetExists) {
    return res.status(400).json({
      success: false,
      error: `Target database "${targetDb}" does not exist on the server.`,
      details: `The payroll class "${payrollClassInput}" maps to database "${targetDb}", but this database has not been created yet.`,
      action: 'Please create the database or update your payroll class configuration.',
      debug: {
        payrollClass: payrollClassInput,
        expectedDatabase: targetDb,
        friendlyName: getFriendlyDbName(targetDb)
      }
    });
  }

  if (sourceDb === targetDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Employee is already in this payroll class database' 
    });
  }

  let sourceConnection = null;
  let targetConnection = null;

  try {
    const sourceName = getFriendlyDbName(sourceDb);
    const targetName = getFriendlyDbName(targetDb);
    
    console.log(`🔄 Starting migration for ${employeeId}`);
    console.log(`   From: ${sourceName} (${sourceDb})`);
    console.log(`   To: ${targetName} (${targetDb})`);

    sourceConnection = await pool.getConnection();
    targetConnection = await pool.getConnection();

    // Try to switch to databases - this will fail if database doesn't exist
    try {
      await sourceConnection.query(`USE \`${sourceDb}\``);
    } catch (err) {
      throw new Error(`Source database "${sourceDb}" does not exist or is not accessible.`);
    }

    try {
      await targetConnection.query(`USE \`${targetDb}\``);
    } catch (err) {
      throw new Error(`Target database "${targetDb}" (${targetName}) does not exist. Please create it first.`);
    }

    await sourceConnection.beginTransaction();
    await targetConnection.beginTransaction();

    // STEP 1: Verify employee exists in source database
    const [employeeRows] = await sourceConnection.query(
      `SELECT * FROM hr_employees 
       WHERE Empl_ID = ? 
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      await sourceConnection.rollback();
      await targetConnection.rollback();
      return res.status(404).json({ 
        success: false, 
        error: `Employee not found or inactive in ${sourceName} database` 
      });
    }

    const employee = employeeRows[0];
    const employeeName = `${employee.Surname} ${employee.OtherName || ''}`.trim();
    console.log(`✓ Employee found: ${employeeName}`);

    // STEP 2: Check and clear existing records in target database
    const [existingInTarget] = await targetConnection.query(
      `SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?`,
      [employeeId]
    );

    const relatedTables = [
      'Children', 'NextOfKin', 'Spouse'
    ];

    if (existingInTarget.length > 0) {
      console.log(`⚠️ Employee exists in ${targetName}. Clearing old records...`);
      
      for (const table of relatedTables) {
        try {
          const [result] = await targetConnection.query(
            `DELETE FROM ${table} WHERE Empl_ID = ?`,
            [employeeId]
          );
          if (result.affectedRows > 0) {
            console.log(`  ✓ Deleted ${result.affectedRows} record(s) from ${table}`);
          }
        } catch (tableError) {
          console.log(`  ⚠️ Could not delete from ${table}: ${tableError.message}`);
        }
      }

      await targetConnection.query(`DELETE FROM hr_employees WHERE Empl_ID = ?`, [employeeId]);
      console.log(`  ✓ Deleted employee record from ${targetName}`);
    }

    // STEP 3: Copy employee record
    console.log(`📋 Copying employee record to ${targetName}...`);
    employee.payrollclass = payrollClassInput;

    const columns = Object.keys(employee);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(employee);

    await targetConnection.query(
      `INSERT INTO hr_employees (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
    console.log(`  ✓ Employee record copied successfully`);

    // STEP 4: Copy related records
    console.log(`📦 Copying related records to ${targetName}...`);
    let copiedRecords = 1;

    for (const table of relatedTables) {
      try {
        const [records] = await sourceConnection.query(
          `SELECT * FROM ${table} WHERE Empl_ID = ?`,
          [employeeId]
        );

        if (records.length > 0) {
          for (const record of records) {
            const cols = Object.keys(record);
            const vals = Object.values(record);
            const placeholders = cols.map(() => '?').join(', ');

            await targetConnection.query(
              `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
              vals
            );
          }
          copiedRecords += records.length;
          console.log(`  ✓ Copied ${records.length} record(s) from ${table}`);
        }
      } catch (tableError) {
        console.log(`  ⚠️ Could not copy from ${table}: ${tableError.message}`);
      }
    }

    // STEP 5: Delete from source
    console.log(`🗑️ Removing records from ${sourceName}...`);

    for (const table of relatedTables) {
      try {
        const [result] = await sourceConnection.query(
          `DELETE FROM ${table} WHERE Empl_ID = ?`,
          [employeeId]
        );
        if (result.affectedRows > 0) {
          console.log(`  ✓ Deleted ${result.affectedRows} record(s) from ${table}`);
        }
      } catch (tableError) {
        console.log(`  ⚠️ Could not delete from ${table}: ${tableError.message}`);
      }
    }

    await sourceConnection.query(`DELETE FROM hr_employees WHERE Empl_ID = ?`, [employeeId]);
    console.log(`  ✓ Deleted employee record from ${sourceName}`);

    // STEP 6: Commit
    await targetConnection.commit();
    await sourceConnection.commit();

    console.log(`✅ Migration completed successfully`);

    res.status(200).json({
      success: true,
      message: `Employee successfully migrated from ${sourceName} to ${targetName}`,
      data: {
        Empl_ID: employeeId,
        Name: employeeName,
        OldPayrollClass: sourceDb,
        NewPayrollClass: payrollClassInput,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: sourceName,
        TargetDatabaseName: targetName,
        RecordsCopied: copiedRecords,
        MigrationTimestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);

    try {
      if (sourceConnection) await sourceConnection.rollback();
      if (targetConnection) await targetConnection.rollback();
      console.log('⚠️ Transactions rolled back');
    } catch (rollbackError) {
      console.error('❌ Rollback error:', rollbackError);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to migrate employee',
      message: error.message,
      Empl_ID: employeeId
    });

  } finally {
    if (sourceConnection) sourceConnection.release();
    if (targetConnection) targetConnection.release();
    console.log('🔓 Database connections released');
  }
});

// ==================== HELPER ENDPOINT: Get migration preview ====================
router.get('/payroll-class/preview/:Empl_ID', verifyToken, async (req, res) => {
  const { Empl_ID } = req.params;
  const { PayrollClass } = req.query;

  if (!PayrollClass) {
    return res.status(400).json({ error: 'PayrollClass query parameter required' });
  }

  try {
    const employeeId = Empl_ID.trim();
    const sourceDb = req.current_class;
    const targetDb = PayrollClass;

    // Validate databases
    if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
      return res.status(400).json({ error: 'Invalid database selection' });
    }

    // Get employee info
    const [employeeRows] = await pool.query(
      `SELECT Empl_ID, Surname, OtherName, payrollclass FROM hr_employees WHERE Empl_ID = ?`,
      [employeeId],
      req.requestId
    );

    if (employeeRows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employee = employeeRows[0];

    // Count related records
    const relatedTables = [
      'Children', 'NextOfKin', 'Spouse'
    ];

    const recordCounts = {};
    let totalRecords = 1; // Employee record

    for (const table of relatedTables) {
      try {
        const [result] = await pool.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE Empl_ID = ?`,
          [employeeId],
          req.requestId
        );
        const count = result[0].count;
        if (count > 0) {
          recordCounts[table] = count;
          totalRecords += count;
        }
      } catch (err) {
        // Table might not exist
      }
    }

    res.json({
      employee: {
        id: employee.Empl_ID,
        name: `${employee.Surname} ${employee.OtherName || ''}`.trim(),
        currentClass: employee.payrollclass,
        currentClassName: getFriendlyDbName(employee.payrollclass)
      },
      migration: {
        targetClass: PayrollClass,
        targetClassName: getFriendlyDbName(targetDb),
        sourceDatabase: sourceDb,
        sourceDatabaseName: getFriendlyDbName(sourceDb),
        targetDatabase: targetDb,
        targetDatabaseName: getFriendlyDbName(targetDb),
        totalRecords: totalRecords,
        relatedRecords: recordCounts
      },
      warning: 'This operation will move all employee data to the new database and delete from current database. This cannot be undone.'
    });

  } catch (error) {
    console.error('❌ Preview error:', error);
    res.status(500).json({ error: 'Failed to generate preview', details: error.message });
  }
});


module.exports = router;