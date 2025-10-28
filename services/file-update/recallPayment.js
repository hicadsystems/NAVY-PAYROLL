const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.recallFiles = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'RecallPayrollFiles', year, month, user);
  try {
    const [rows] = await pool.query('CALL py_recall_payrollfiles_optimized(?, ?, ?)', [year, month, user]);
    await updateLog(logId, 'SUCCESS', 'Payroll files recalled successfully');
    return rows[0] || { status: 'OK', message: 'Payroll recalled' };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};