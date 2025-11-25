const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const { attachPayrollClass } = require('../../middware/attachPayrollClass');
const pool  = require('../../config/db'); // mysql2 pool

// ==================== DATABASE CONFIGURATION ====================
const DATABASE_MAP = {
  [process.env.DB_OFFICERS || 'hicaddata']: { name: 'OFFICERS', code: '1' },
  [process.env.DB_WOFFICERS || 'hicaddata1']: { name: 'W/OFFICERS', code: '2' },
  [process.env.DB_RATINGS || 'hicaddata2']: { name: 'RATE A', code: '3' },
  [process.env.DB_RATINGS_A || 'hicaddata3']: { name: 'RATE B', code: '4' },
  [process.env.DB_RATINGS_B || 'hicaddata4']: { name: 'RATE C', code: '5' },
  [process.env.DB_JUNIOR_TRAINEE || 'hicaddata5']: { name: 'TRAINEE', code: '6' }
};

const PAYROLL_CLASS_TO_DB_MAP = {
  '1': process.env.DB_OFFICERS || 'hicaddata',
  '2': process.env.DB_WOFFICERS || 'hicaddata1',
  '3': process.env.DB_RATINGS || 'hicaddata2',
  '4': process.env.DB_RATINGS_A || 'hicaddata3',
  '5': process.env.DB_RATINGS_B || 'hicaddata4',
  '6': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
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

// ==================== HELPER FUNCTIONS ====================
function getDbNameFromPayrollClass(payrollClass) {
  if (PAYROLL_CLASS_TO_DB_MAP[payrollClass]) {
    return PAYROLL_CLASS_TO_DB_MAP[payrollClass];
  }
  
  const upperClass = payrollClass.toString().toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.toUpperCase() === upperClass) {
      return value;
    }
  }
  
  const cleanClass = payrollClass.toString().replace(/[\s\/\-_]/g, '').toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.replace(/[\s\/\-_]/g, '').toUpperCase() === cleanClass) {
      return value;
    }
  }
  
  return payrollClass;
}

function getFriendlyDbName(dbId) {
  return DATABASE_MAP[dbId]?.name || dbId;
}

function isValidDatabase(dbId) {
  return Object.keys(DATABASE_MAP).includes(dbId);
}

async function checkDatabaseExists(dbName) {
  let connection = null;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(`SHOW DATABASES LIKE ?`, [dbName]);
    connection.release();
    return rows.length > 0;
  } catch (error) {
    if (connection) connection.release();
    return false;
  }
}

// ==================== GET ALL EMPLOYEES ====================
router.get('/active-employees', verifyToken, attachPayrollClass, async (req, res) => {
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
router.get('/payroll-class-stats', verifyToken, attachPayrollClass, async (req, res) => {
  try {
    const query = `
      SELECT 
        e.payrollclass,
        pc.classname,
        COUNT(*) AS count
      FROM hr_employees e
      LEFT JOIN py_payrollclass pc 
        ON e.payrollclass = pc.classcode
      WHERE 
        (e.DateLeft IS NULL OR e.DateLeft = '')
        AND (e.exittype IS NULL OR e.exittype = '')
        AND e.payrollclass IS NOT NULL
        AND e.payrollclass != ''
      GROUP BY 
        e.payrollclass, pc.classname
      ORDER BY 
        e.payrollclass ASC;
    `;

    const [rows] = await pool.query(query);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        message: 'No payroll class statistics found',
        data: {}
      });
    }

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

// ==================== MANUAL TRIGGER: Fix all unassigned employees ====================
router.post('/fix-unassigned-classes', verifyToken, async (req, res) => {
  try {
    const results = [];
    let totalFixed = 0;

    console.log('🔧 Starting manual fix for all unassigned employees...');

    // Get OFFICERS database name to skip it
    const officersDb = process.env.DB_OFFICERS || 'hicaddata';

    // Process each database
    for (const [dbName, dbInfo] of Object.entries(DATABASE_MAP)) {
      // Skip OFFICERS database
      if (dbName === officersDb) {
        console.log(`\n⏭️ Skipping OFFICERS database: ${dbName} (${dbInfo.name})`);
        results.push({
          database: dbName,
          friendlyName: dbInfo.name,
          payrollClass: dbInfo.code,
          employeesUpdated: 0,
          skipped: true,
          reason: 'OFFICERS database - auto-assignment disabled'
        });
        continue;
      }

      console.log(`\nProcessing database: ${dbName} (${dbInfo.name})...`);
      
      const exists = await checkDatabaseExists(dbName);
      
      if (!exists) {
        console.log(`  ⚠️ Database ${dbName} does not exist, skipping...`);
        results.push({
          database: dbName,
          friendlyName: dbInfo.name,
          payrollClass: dbInfo.code,
          employeesUpdated: 0,
          skipped: true,
          reason: 'Database does not exist'
        });
        continue;
      }

      const result = await autoAssignPayrollClass(dbName);
      
      results.push({
        database: dbName,
        friendlyName: dbInfo.name,
        payrollClass: dbInfo.code,
        employeesUpdated: result.updated,
        error: result.error || null
      });
      
      totalFixed += result.updated;
    }

    console.log(`\n✅ Manual fix completed. Total employees fixed: ${totalFixed}`);

    res.status(200).json({
      success: true,
      message: `Fixed ${totalFixed} unassigned employee(s) across all databases (OFFICERS database skipped)`,
      totalEmployeesFixed: totalFixed,
      databaseResults: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fixing unassigned classes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix unassigned classes',
      details: error.message
    });
  }
});

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
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;
  const officersDb = process.env.DB_OFFICERS || 'hicaddata';

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

  if (!isValidDatabase(sourceDb)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid source database: ${sourceDb}`,
      debug: { sourceDb, validDatabases: Object.keys(DATABASE_MAP) }
    });
  }

  if (!isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid target database: ${targetDb}. Could not map payroll class "${payrollClassInput}" to a database.`,
      debug: {
        payrollClassInput,
        resolvedDb: targetDb,
        availableMappings: Object.keys(PAYROLL_CLASS_TO_DB_MAP).slice(0, 20),
        hint: 'The payroll class code does not match any known database'
      }
    });
  }

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

    // Fetch employee from source database
    const [employeeRows] = await sourceConnection.query(
      `SELECT * FROM hr_employees 
       WHERE Empl_ID = ? 
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      sourceConnection.release();
      targetConnection.release();
      return res.status(404).json({ 
        success: false, 
        error: `Employee not found or inactive in ${sourceName} database` 
      });
    }

    const employee = employeeRows[0];
    const employeeName = `${employee.Surname} ${employee.OtherName || ''}`.trim();
    console.log(`✓ Employee found: ${employeeName}`);

    // Special handling for OFFICERS database
    if (sourceDb === officersDb) {
      const currentPayrollClass = employee.payrollclass;
      
      // If employee has no payroll class assigned, assign '1' and stay in OFFICERS
      if (!currentPayrollClass || currentPayrollClass === '' || currentPayrollClass === '0') {
        console.log(`📝 Employee in OFFICERS database has no payroll class. Assigning class '1'...`);
        
        await sourceConnection.beginTransaction();
        
        // Update employee with payroll class '1'
        await sourceConnection.query(
          `UPDATE hr_employees SET payrollclass = '1' WHERE Empl_ID = ?`,
          [employeeId]
        );
        
        // Ensure payroll class '1' exists in py_payrollclass
        const [payrollClassCheck] = await sourceConnection.query(
          `SELECT classcode FROM py_payrollclass WHERE classcode = '1'`
        );
        
        if (payrollClassCheck.length === 0) {
          await sourceConnection.query(
            `INSERT INTO py_payrollclass (classcode, classname) VALUES ('1', 'OFFICERS')`
          );
          console.log(`✓ Created payroll class '1' in py_payrollclass`);
        }
        
        await sourceConnection.commit();
        sourceConnection.release();
        targetConnection.release();
        
        console.log(`✅ Assigned payroll class '1' to employee ${employeeId}`);
        
        return res.status(200).json({
          success: true,
          message: `Employee assigned to payroll class '1' (OFFICERS)`,
          data: {
            Empl_ID: employeeId,
            Name: employeeName,
            AssignedPayrollClass: '1',
            PayrollClassName: 'OFFICERS',
            Database: sourceDb,
            Action: 'Payroll class assigned (no migration)',
            Timestamp: new Date().toISOString()
          }
        });
      }
      
      // If employee already has the target payroll class, throw error
      if (currentPayrollClass === payrollClassInput) {
        sourceConnection.release();
        targetConnection.release();
        return res.status(400).json({ 
          success: false, 
          error: 'Employee is already in this payroll class' 
        });
      }
    }

    // Normal migration flow for other databases or OFFICERS with assigned class
    if (sourceDb === targetDb) {
      sourceConnection.release();
      targetConnection.release();
      return res.status(400).json({ 
        success: false, 
        error: 'Employee is already in this payroll class database' 
      });
    }

    await sourceConnection.beginTransaction();
    await targetConnection.beginTransaction();

    const relatedTables = ['Children', 'NextOfKin', 'Spouse'];

    const [existingInTarget] = await targetConnection.query(
      `SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?`,
      [employeeId]
    );

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

// ==================== OPTIMIZED BULK MIGRATION ====================
// Bulk Migration - Migrate ALL employees in current class to target class
router.post('/payroll-class/bulk', verifyToken, async (req, res) => {
  const { TargetPayrollClass } = req.body;

  if (!TargetPayrollClass || TargetPayrollClass.trim() === '') {
    return res.status(400).json({ success: false, error: 'Target payroll class is required' });
  }

  const payrollClassInput = TargetPayrollClass.toString().trim();
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;

  console.log(`📋 Bulk Migration Request:`);
  console.log(`   From DB: ${sourceDb} (${getFriendlyDbName(sourceDb)})`);
  console.log(`   To DB: ${targetDb} (${getFriendlyDbName(targetDb)})`);

  if (!sourceDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source payroll class context not found.' 
    });
  }

  if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid source or target payroll class' 
    });
  }

  if (sourceDb === targetDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source and target payroll classes are the same' 
    });
  }

  const targetExists = await checkDatabaseExists(targetDb);
  if (!targetExists) {
    return res.status(400).json({
      success: false,
      error: `Target database "${targetDb}" does not exist.`
    });
  }

  let connection = null;

  try {
    const startTime = Date.now();
    connection = await pool.getConnection();

    // Start a single transaction for the entire operation
    await connection.beginTransaction();

    // Use source database
    await connection.query(`USE \`${sourceDb}\``);

    // Get count of employees to migrate
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as total FROM hr_employees 
       WHERE (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`
    );
    const totalEmployees = countResult[0].total;
    console.log(`📦 Found ${totalEmployees} employees to migrate`);

    // Step 1: Bulk update payrollclass in source database first
    await connection.query(
      `UPDATE hr_employees 
       SET payrollclass = ?
       WHERE (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [payrollClassInput]
    );

    // Step 2: Get employee IDs for related table cleanup
    const [employeeIds] = await connection.query(
      `SELECT Empl_ID FROM hr_employees 
       WHERE (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`
    );
    const emplIdList = employeeIds.map(row => row.Empl_ID);

    // Step 3: Bulk delete existing records in target database
    await connection.query(`USE \`${targetDb}\``);
    
    if (emplIdList.length > 0) {
      // Delete in batches to avoid query length limits
      const batchSize = 1000;
      for (let i = 0; i < emplIdList.length; i += batchSize) {
        const batch = emplIdList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        
        await connection.query(
          `DELETE FROM hr_employees WHERE Empl_ID IN (${placeholders})`,
          batch
        );

        // Delete related records
        const relatedTables = ['Children', 'NextOfKin', 'Spouse'];
        for (const table of relatedTables) {
          try {
            await connection.query(
              `DELETE FROM ${table} WHERE Empl_ID IN (${placeholders})`,
              batch
            );
          } catch (err) {
            console.log(`⚠️ Could not delete from ${table}: ${err.message}`);
          }
        }
      }
      console.log(`✓ Cleaned up existing records in target database`);
    }

    // Step 4: Bulk copy employees from source to target
    await connection.query(
      `INSERT INTO \`${targetDb}\`.hr_employees 
       SELECT * FROM \`${sourceDb}\`.hr_employees 
       WHERE (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`
    );
    console.log(`✓ Copied ${totalEmployees} employees to target database`);

    // Step 5: Bulk copy related records
    const relatedTables = ['Children', 'NextOfKin', 'Spouse'];
    let totalRelatedRecords = 0;

    for (const table of relatedTables) {
      try {
        // Check if table exists in both databases
        const [sourceTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [sourceDb, table]
        );
        
        const [targetTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [targetDb, table]
        );

        if (sourceTableExists[0].count > 0 && targetTableExists[0].count > 0) {
          // Get count first
          const [countRes] = await connection.query(
            `SELECT COUNT(*) as count FROM \`${sourceDb}\`.${table} 
             WHERE Empl_ID IN (SELECT Empl_ID FROM \`${sourceDb}\`.hr_employees 
                               WHERE (DateLeft IS NULL OR DateLeft = '') 
                               AND (exittype IS NULL OR exittype = ''))`
          );
          const recordCount = countRes[0].count;

          if (recordCount > 0) {
            await connection.query(
              `INSERT INTO \`${targetDb}\`.${table} 
               SELECT s.* FROM \`${sourceDb}\`.${table} s
               INNER JOIN \`${sourceDb}\`.hr_employees e ON s.Empl_ID = e.Empl_ID
               WHERE (e.DateLeft IS NULL OR e.DateLeft = '') 
               AND (e.exittype IS NULL OR e.exittype = '')`
            );
            totalRelatedRecords += recordCount;
            console.log(`✓ Copied ${recordCount} records from ${table}`);
          }
        }
      } catch (err) {
        console.log(`⚠️ Could not copy ${table}: ${err.message}`);
      }
    }

    // Step 6: Bulk delete from source database
    await connection.query(`USE \`${sourceDb}\``);
    
    for (const table of relatedTables) {
      try {
        const [result] = await connection.query(
          `DELETE s FROM ${table} s
           INNER JOIN hr_employees e ON s.Empl_ID = e.Empl_ID
           WHERE (e.DateLeft IS NULL OR e.DateLeft = '') 
           AND (e.exittype IS NULL OR e.exittype = '')`
        );
        if (result.affectedRows > 0) {
          console.log(`✓ Deleted ${result.affectedRows} records from ${table}`);
        }
      } catch (err) {
        console.log(`⚠️ Could not delete from ${table}: ${err.message}`);
      }
    }

    const [deleteResult] = await connection.query(
      `DELETE FROM hr_employees 
       WHERE (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`
    );
    console.log(`✓ Deleted ${deleteResult.affectedRows} employees from source database`);

    // Commit the transaction
    await connection.commit();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Migration completed in ${duration} seconds`);

    res.status(200).json({
      success: true,
      message: `Bulk migration completed successfully`,
      data: {
        TotalEmployees: totalEmployees,
        TotalRelatedRecords: totalRelatedRecords,
        TotalRecordsMigrated: totalEmployees + totalRelatedRecords,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: getFriendlyDbName(sourceDb),
        TargetDatabaseName: getFriendlyDbName(targetDb),
        DurationSeconds: duration,
        Timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Bulk migration failed:', error);
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('⚠️ Transaction rolled back');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Bulk migration failed',
      message: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// ==================== OPTIMIZED RANGE MIGRATION ====================
router.post('/payroll-class/range', verifyToken, async (req, res) => {
  const { StartEmpl_ID, EndEmpl_ID, TargetPayrollClass } = req.body;

  if (!StartEmpl_ID || !EndEmpl_ID || !TargetPayrollClass) {
    return res.status(400).json({ 
      success: false, 
      error: 'Start employee ID, end employee ID, and target payroll class are required' 
    });
  }

  const startId = StartEmpl_ID.trim();
  const endId = EndEmpl_ID.trim();
  const payrollClassInput = TargetPayrollClass.toString().trim();
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;

  console.log(`📋 Range Migration Request:`);
  console.log(`   Range: ${startId} to ${endId}`);
  console.log(`   From DB: ${sourceDb} (${getFriendlyDbName(sourceDb)})`);
  console.log(`   To DB: ${targetDb} (${getFriendlyDbName(targetDb)})`);

  if (!sourceDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source payrollclass context not found.' 
    });
  }

  if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid source or target payrollclass' 
    });
  }

  if (sourceDb === targetDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source and target payroll classes are the same' 
    });
  }

  const targetExists = await checkDatabaseExists(targetDb);
  if (!targetExists) {
    return res.status(400).json({
      success: false,
      error: `Target database "${targetDb}" does not exist.`
    });
  }

  let connection = null;

  try {
    const startTime = Date.now();
    connection = await pool.getConnection();

    await connection.beginTransaction();
    await connection.query(`USE \`${sourceDb}\``);

    // Get count of employees in range
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as total FROM hr_employees 
       WHERE Empl_ID BETWEEN ? AND ?
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [startId, endId]
    );
    
    const totalEmployees = countResult[0].total;

    if (totalEmployees === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: `No employees found in range ${startId} to ${endId}`
      });
    }

    console.log(`📦 Found ${totalEmployees} employees in range`);

    // Update payrollclass in source
    await connection.query(
      `UPDATE hr_employees 
       SET payrollclass = ?
       WHERE Empl_ID BETWEEN ? AND ?
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [payrollClassInput, startId, endId]
    );

    // Get employee IDs in range
    const [employeeIds] = await connection.query(
      `SELECT Empl_ID FROM hr_employees 
       WHERE Empl_ID BETWEEN ? AND ?
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [startId, endId]
    );
    const emplIdList = employeeIds.map(row => row.Empl_ID);

    // Delete existing records in target
    await connection.query(`USE \`${targetDb}\``);
    
    if (emplIdList.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < emplIdList.length; i += batchSize) {
        const batch = emplIdList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        
        await connection.query(
          `DELETE FROM hr_employees WHERE Empl_ID IN (${placeholders})`,
          batch
        );

        const relatedTables = ['Children', 'NextOfKin', 'Spouse'];
        for (const table of relatedTables) {
          try {
            await connection.query(
              `DELETE FROM ${table} WHERE Empl_ID IN (${placeholders})`,
              batch
            );
          } catch (err) {
            console.log(`⚠️ Could not delete from ${table}: ${err.message}`);
          }
        }
      }
    }

    // Bulk copy employees
    await connection.query(
      `INSERT INTO \`${targetDb}\`.hr_employees 
       SELECT * FROM \`${sourceDb}\`.hr_employees 
       WHERE Empl_ID BETWEEN ? AND ?
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [startId, endId]
    );
    console.log(`✓ Copied ${totalEmployees} employees`);

    // Bulk copy related records
    const relatedTables = ['Children', 'NextOfKin', 'Spouse'];
    let totalRelatedRecords = 0;

    for (const table of relatedTables) {
      try {
        const [countRes] = await connection.query(
          `SELECT COUNT(*) as count FROM \`${sourceDb}\`.${table} 
           WHERE Empl_ID IN (SELECT Empl_ID FROM \`${sourceDb}\`.hr_employees 
                             WHERE Empl_ID BETWEEN ? AND ?
                             AND (DateLeft IS NULL OR DateLeft = '') 
                             AND (exittype IS NULL OR exittype = ''))`,
          [startId, endId]
        );
        const recordCount = countRes[0].count;

        if (recordCount > 0) {
          await connection.query(
            `INSERT INTO \`${targetDb}\`.${table} 
             SELECT s.* FROM \`${sourceDb}\`.${table} s
             INNER JOIN \`${sourceDb}\`.hr_employees e ON s.Empl_ID = e.Empl_ID
             WHERE e.Empl_ID BETWEEN ? AND ?
             AND (e.DateLeft IS NULL OR e.DateLeft = '') 
             AND (e.exittype IS NULL OR e.exittype = '')`,
            [startId, endId]
          );
          totalRelatedRecords += recordCount;
          console.log(`✓ Copied ${recordCount} records from ${table}`);
        }
      } catch (err) {
        console.log(`⚠️ Could not copy ${table}: ${err.message}`);
      }
    }

    // Bulk delete from source
    await connection.query(`USE \`${sourceDb}\``);
    
    for (const table of relatedTables) {
      try {
        const [result] = await connection.query(
          `DELETE s FROM ${table} s
           INNER JOIN hr_employees e ON s.Empl_ID = e.Empl_ID
           WHERE e.Empl_ID BETWEEN ? AND ?
           AND (e.DateLeft IS NULL OR e.DateLeft = '') 
           AND (e.exittype IS NULL OR e.exittype = '')`,
          [startId, endId]
        );
        if (result.affectedRows > 0) {
          console.log(`✓ Deleted ${result.affectedRows} records from ${table}`);
        }
      } catch (err) {
        console.log(`⚠️ Could not delete from ${table}: ${err.message}`);
      }
    }

    const [deleteResult] = await connection.query(
      `DELETE FROM hr_employees 
       WHERE Empl_ID BETWEEN ? AND ?
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [startId, endId]
    );
    console.log(`✓ Deleted ${deleteResult.affectedRows} employees from source`);

    await connection.commit();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Range migration completed in ${duration} seconds`);

    res.status(200).json({
      success: true,
      message: `Range migration completed successfully`,
      data: {
        Range: `${startId} to ${endId}`,
        TotalEmployees: totalEmployees,
        TotalRelatedRecords: totalRelatedRecords,
        TotalRecordsMigrated: totalEmployees + totalRelatedRecords,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: getFriendlyDbName(sourceDb),
        TargetDatabaseName: getFriendlyDbName(targetDb),
        DurationSeconds: duration,
        Timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Range migration failed:', error);
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('⚠️ Transaction rolled back');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Range migration failed',
      message: error.message
    });
  } finally {
    if (connection) connection.release();
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
    const targetDb = getDbNameFromPayrollClass(PayrollClass);

    if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
      return res.status(400).json({ error: 'Invalid database selection' });
    }

    const connection = await pool.getConnection();
    await connection.query(`USE \`${sourceDb}\``);

    const [employeeRows] = await connection.query(
      `SELECT Empl_ID, Surname, OtherName, payrollclass FROM hr_employees WHERE Empl_ID = ?`,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employee = employeeRows[0];
    const relatedTables = ['Children', 'NextOfKin', 'Spouse'];
    const recordCounts = {};
    let totalRecords = 1;

    for (const table of relatedTables) {
      try {
        const [result] = await connection.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE Empl_ID = ?`,
          [employeeId]
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

    connection.release();

    res.json({
      employee: {
        id: employee.Empl_ID,
        name: `${employee.Surname} ${employee.OtherName || ''}`.trim(),
        currentClass: employee.payrollclass,
        currentClassName: getFriendlyDbName(sourceDb)
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