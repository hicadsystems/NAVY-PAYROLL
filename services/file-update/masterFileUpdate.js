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

    // Step 1: Capture timestamp BEFORE running procedures
    const executionStartTime = new Date();
    
    // Step 2: Run extraction to populate py_wkemployees and input tables
    console.log('Running sp_extractrec_optimized...');
    const [extractResult] = await connection.query(
      `CALL sp_extractrec_optimized(?, ?, ?, ?)`, 
      ['NAVY', indicator, 'Yes', user]
    );
    console.log(`Extraction completed`);

    // Step 3: Check working employees count (info only, not an error)
    const [wkempCount] = await connection.query(
      `SELECT COUNT(*) as count FROM py_wkemployees`
    );
    console.log(`Working employees: ${wkempCount[0].count}`);

    // Step 4: Run master file updates (calls all 6 sub-procedures)
    console.log('Running py_update_payrollfiles...');
    const [updateResult] = await connection.query(
      `CALL py_update_payrollfiles(?, ?)`, 
      ['NAVY', 'Yes']
    );
    console.log(`Master file updates completed`);

    // Step 5: Check performance log for FAILED procedures from THIS execution only
    const [perfLog] = await connection.query(`
      SELECT procedure_name, status, records_processed, execution_time_ms, error_details
      FROM py_performance_log 
      WHERE started_at >= ?
        AND status = 'FAILED'
      ORDER BY started_at DESC
    `, [executionStartTime]);

    if (perfLog.length > 0) {
      console.warn('⚠️  Some procedures reported failures:', perfLog);
      const failureDetails = perfLog.map(p => 
        `${p.procedure_name}: ${p.error_details || 'Unknown error'}`
      ).join('; ');
      throw new Error(`Master file update failed. ${failureDetails}`);
    }

    // Step 6: Get summary stats
    const [summary] = await connection.query(`
      SELECT 
        COUNT(DISTINCT his_empno) as employees_processed,
        COUNT(*) as total_records,
        COALESCE(SUM(amtthismth), 0) as total_amount
      FROM py_masterpayded
      WHERE amtthismth != 0
    `);

    const summaryMsg = `Master file update completed successfully for ${dbName}. ` +
      `Employees: ${summary[0].employees_processed || 0}, ` +
      `Records: ${summary[0].total_records || 0}, ` +
      `Total Amount: ₦${parseFloat(summary[0].total_amount || 0).toFixed(2)}`;

    await updateLog(logId, 'SUCCESS', summaryMsg);
    
    return {
      status: 'SUCCESS',
      message: summaryMsg,
      data: {
        database: dbName,
        year,
        month,
        employeesProcessed: summary[0].employees_processed || 0,
        totalRecords: summary[0].total_records || 0,
        totalAmount: parseFloat(summary[0].total_amount || 0).toFixed(2)
      }
    };

  } catch (err) {
    console.error('❌ Error in runUpdates:', err);
    
    // Get most recent error details from performance log if available
    try {
      const [errorLog] = await connection.query(`
        SELECT procedure_name, error_details 
        FROM py_performance_log 
        WHERE status = 'FAILED' 
          AND started_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        ORDER BY started_at DESC 
        LIMIT 1
      `);
      
      if (errorLog.length > 0 && errorLog[0].error_details) {
        // Only append if we don't already have this info in the error message
        if (!err.message.includes(errorLog[0].error_details)) {
          err.message = `${errorLog[0].procedure_name}: ${errorLog[0].error_details}`;
        }
      }
    } catch (logErr) {
      // Ignore error log retrieval errors
      console.error('Could not fetch error log details:', logErr);
    }

    await updateLog(logId, 'FAILED', err.message);
    throw err;

  } finally {
    // Always release the connection back to the pool
    connection.release();
    console.log('Database connection released');
  }
};