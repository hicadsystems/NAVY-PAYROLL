const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');


exports.runCalculations = async (year, month, user) => {
  const logId = await startLog('PayrollCalc', 'RunCalculations', year, month, user);
  try {
    // sequential SP calls
    const procedures = [
      'sp_calculate_01_optimized',
      'sp_calculate_02_optimized',
      'py_calculate_tax_optimized'
    ];
    for (const sp of procedures) {
      await pool.query(`CALL ${sp}(?, ?, ?)`, [year, month, user]);
    }

    await updateLog(logId, 'SUCCESS', 'All payroll calculations executed successfully.');
    return { message: 'Payroll calculations completed successfully.' };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
