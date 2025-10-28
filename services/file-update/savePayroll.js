const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.saveFiles = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'SavePayrollFiles', year, month, user);
  try {
    const [rows] = await pool.query('CALL py_save_payrollfiles_optimized(?, ?, ?)', [year, month, user]);
    await updateLog(logId, 'SUCCESS', 'Payroll files saved successfully');
    return rows[0] || { status: 'OK', message: 'Procedure executed successfully' };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
