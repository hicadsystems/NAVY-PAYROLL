const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.runUpdates = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'MasterFileUpdates', year, month, user);
  const updates = [
    'py_updatepayroll_00_optimized',
    'py_updatepayroll_01_optimized',
    'py_updatepayroll_02_optimized',
    'py_updatepayroll_03_optimized',
    'py_updatepayroll_04_optimized',
    'py_updatepayroll_05_optimized',
    'py_updatepayroll_06_optimized',
    'sp_extractrec_optimized'
  ];
  try {
    for (const proc of updates) await pool.query(`CALL ${proc}(?, ?)`, [year, month]);
    await updateLog(logId, 'SUCCESS', 'Master file updates completed');
    return { status: 'OK', message: 'All master updates completed successfully' };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
