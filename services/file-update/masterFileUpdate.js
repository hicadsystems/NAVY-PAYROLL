const pool = require('../../config/db');
const { startLog, updateLog } = require('../../services/logService');

exports.runUpdates = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'MasterFileUpdates', year, month, user);

  // Ordered procedure flow
  const updates = [
    'py_updatepayroll_00_optimized',
    'py_updatepayroll_01_optimized',
    'py_updatepayroll_02_optimized',
    'py_updatepayroll_03_optimized',
    'py_updatepayroll_04_optimized',
    'py_updatepayroll_05_optimized',
    'py_updatepayroll_06_optimized',
  ];

  try {
    // Run all payroll update phases sequentially
    for (const proc of updates) {
      console.log(`🚀 Running ${proc} for ${year}-${month}`);
      const [rows] = await pool.query(`CALL ${proc}(?, ?)`, [year, month]);
    }

    // Now run extract step — note different parameters
    console.log('📤 Running sp_extractrec_optimized');
    const [rows] = await pool.query(`CALL sp_extractrec_optimized(?, ?, ?, ?)`, ['NAVY', 'O', 'Yes', user]);

    await updateLog(logId, 'SUCCESS', 'Master file updates completed');
    return { 
      logId,
      status: 'OK', 
      message: 'All master updates and extraction completed successfully', 
      rows: rows[0] || []
    };
  } catch (err) {
    console.error('❌ Error in runUpdates:', err);
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};