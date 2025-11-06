const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');
const getDatabaseForIndicator = require('../helpers/mapdbclasses');

exports.runUpdates = async (year, month, indicator, user) => {
  const logId = await startLog('FileUpdate', 'MasterFileUpdates', year, month, user);
  const dbName = getDatabaseForIndicator(indicator);
  
  // Get a connection from the pool to maintain session context
  const connection = await pool.getConnection();

  try {
    // Switch to target database on this specific connection
    await connection.query(`USE \`${dbName}\``);
    console.log(`Switched to database: ${dbName}`);

    // Step 0: Set the payroll period in py_stdrate (BT05)
    console.log(`Setting payroll period: ${year}-${month}...`);
    await connection.query(
      `UPDATE py_stdrate SET mth = ?, ord = ? WHERE type = 'BT05'`,
      [month, year]
    );

    // Step 1: Run extraction to populate py_wkemployees and input tables
    console.log('Running sp_extractrec_optimized...');
    const [extractResult] = await connection.query(
      `CALL sp_extractrec_optimized(?, ?, ?, ?)`, 
      ['NAVY', indicator, 'Yes', user]
    );
    console.log(`Extraction completed`);

    // Step 2: Verify working employees were populated
    const [wkempCount] = await connection.query(
      `SELECT COUNT(*) as count FROM py_wkemployees`
    );
    console.log(`Working employees: ${wkempCount[0].count}`);
    
    if (wkempCount[0].count === 0) {
      throw new Error('No employees extracted to py_wkemployees. Check extraction procedure.');
    }

    // Step 3: Run master file updates (calls all 6 sub-procedures)
    console.log('Running py_update_payrollfiles...');
    const [updateResult] = await connection.query(
      `CALL py_update_payrollfiles(?, ?)`, 
      ['NAVY', 'Yes']
    );
    console.log(`Master file updates completed`);

    // Step 4: Check performance log for any failures
    const [perfLog] = await connection.query(`
      SELECT procedure_name, status, records_processed, execution_time_ms, error_details
      FROM py_performance_log 
      WHERE DATE(started_at) = CURDATE()
        AND status = 'FAILED'
      ORDER BY started_at DESC
      LIMIT 5
    `);

    if (perfLog.length > 0) {
      console.warn('⚠️  Some procedures reported failures:', perfLog);
      const failedProcs = perfLog.map(p => p.procedure_name).join(', ');
      throw new Error(`Procedure failures: ${failedProcs}`);
    }

    // Step 5: Get summary stats
    const [summary] = await connection.query(`
      SELECT 
        COUNT(DISTINCT his_empno) as employees_processed,
        COUNT(*) as total_records,
        SUM(amtthismth) as total_amount
      FROM py_masterpayded
      WHERE amtthismth != 0
    `);

    const summaryMsg = `Extraction + Updates completed for ${dbName}. ` +
      `Employees: ${summary[0].employees_processed}, ` +
      `Records: ${summary[0].total_records}, ` +
      `Total Amount: ${summary[0].total_amount}`;

    await updateLog(logId, 'SUCCESS', summaryMsg);
    
    return {
      status: 'OK',
      message: summaryMsg,
      data: {
        database: dbName,
        year,
        month,
        employeesProcessed: summary[0].employees_processed,
        totalRecords: summary[0].total_records,
        totalAmount: parseFloat(summary[0].total_amount || 0).toFixed(2)
      }
    };

  } catch (err) {
    console.error('❌ Error in runUpdates:', err);
    
    // Get detailed error from performance log if available
    try {
      const [errorLog] = await connection.query(`
        SELECT procedure_name, error_details 
        FROM py_performance_log 
        WHERE status = 'FAILED' 
          AND started_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        ORDER BY started_at DESC 
        LIMIT 1
      `);
      
      if (errorLog.length > 0) {
        err.message += ` | DB Error: ${errorLog[0].procedure_name} - ${errorLog[0].error_details}`;
      }
    } catch (logErr) {
      // Ignore error log retrieval errors
    }

    await updateLog(logId, 'FAILED', err.message);
    throw err;

  } finally {
    // Always release the connection back to the pool
    connection.release();
    console.log('Database connection released');
  }
};

// Optional: Add a status check function
/*exports.checkPayrollStatus = async (indicator) => {
  const dbName = getDatabaseForIndicator(indicator);
  const connection = await pool.getConnection();

  try {
    await connection.query(`USE \`${dbName}\``);

    const [results] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM py_wkemployees) as active_employees,
        (SELECT COUNT(DISTINCT his_empno) FROM py_masterpayded) as employees_in_master,
        (SELECT mth FROM py_stdrate WHERE type='BT05') as current_month,
        (SELECT ord FROM py_stdrate WHERE type='BT05') as current_year,
        (SELECT COUNT(*) FROM py_performance_log 
         WHERE DATE(started_at) = CURDATE() AND status='SUCCESS') as successful_runs,
        (SELECT COUNT(*) FROM py_performance_log 
         WHERE DATE(started_at) = CURDATE() AND status='FAILED') as failed_runs
    `);

    return {
      status: 'OK',
      data: results[0]
    };

  } catch (err) {
    console.error('❌ Error checking payroll status:', err);
    throw err;
  } finally {
    connection.release();
  }
};

// Optional: Add a validation function
exports.validatePayrollData = async (indicator, year, month) => {
  const dbName = getDatabaseForIndicator(indicator);
  const connection = await pool.getConnection();

  try {
    await connection.query(`USE \`${dbName}\``);

    // Check for common issues
    const validations = [];

    // 1. Check if working employees exist
    const [wkemp] = await connection.query(`SELECT COUNT(*) as count FROM py_wkemployees`);
    validations.push({
      check: 'Working Employees',
      status: wkemp[0].count > 0 ? 'PASS' : 'FAIL',
      value: wkemp[0].count
    });

    // 2. Check if masterpayded has data
    const [master] = await connection.query(
      `SELECT COUNT(DISTINCT his_empno) as count FROM py_masterpayded WHERE amtthismth != 0`
    );
    validations.push({
      check: 'Master Payded Records',
      status: master[0].count > 0 ? 'PASS' : 'FAIL',
      value: master[0].count
    });

    // 3. Check for negative amounts (potential errors)
    const [negatives] = await connection.query(`
      SELECT COUNT(*) as count 
      FROM py_masterpayded 
      WHERE amtthismth < 0 
        AND his_type NOT LIKE 'DT%'
    `);
    validations.push({
      check: 'Negative Amounts (Non-Deductions)',
      status: negatives[0].count === 0 ? 'PASS' : 'WARN',
      value: negatives[0].count
    });

    // 4. Check if period matches
    const [period] = await connection.query(
      `SELECT mth, ord FROM py_stdrate WHERE type='BT05'`
    );
    validations.push({
      check: 'Period Match',
      status: (period[0].mth == month && period[0].ord == year) ? 'PASS' : 'FAIL',
      value: `${period[0].ord}-${period[0].mth}`
    });

    const hasFailures = validations.some(v => v.status === 'FAIL');

    return {
      status: hasFailures ? 'VALIDATION_FAILED' : 'OK',
      validations
    };

  } catch (err) {
    console.error('❌ Error validating payroll data:', err);
    throw err;
  } finally {
    connection.release();
  }
};*/