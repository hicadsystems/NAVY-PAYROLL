const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');
const getDatabaseForIndicator = require('../helpers/mapdbclasses');

exports.runUpdates = async (year, month, indicator, user) => {
  const logId = await startLog('FileUpdate', 'MasterFileUpdates', year, month, user);
  const dbName = getDatabaseForIndicator(indicator);

  try {
    // Switch to target database
    await pool.query(`USE \`${dbName}\``);
    console.log(`Switched to database: ${dbName}`);

    // Step 1: Run extraction
    console.log('Running sp_extractrec_optimized...');
    await pool.query(`CALL sp_extractrec_optimized(?, ?, ?, ?)`, ['NAVY', indicator, 'Yes', user]);

    // Step 2: Run update
    console.log('Running py_update_payrollfiles...');
    await pool.query(`CALL py_update_payrollfiles(?, ?)`, [year, month]);

    await updateLog(logId, 'SUCCESS', `Extraction + Updates completed for ${dbName}`);
    return {
      status: 'OK',
      message: `Extraction + Updates completed successfully for ${dbName}`,
    };

  } catch (err) {
    console.error('❌ Error in runUpdates:', err);
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};