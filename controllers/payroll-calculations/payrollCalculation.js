const pool = require('../../config/db');
const payrollCalculationService = require('../../services/payroll-calculations/payrollCalculation');

exports.calculatePayroll = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query("SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });
    const { year, month, sun } = bt05Rows[0];

    if (sun < 889) return res.status(400).json({ error: 'Backup must be completed first.' });
    if (sun >= 999) return res.status(400).json({ error: 'Calculations already completed.' });

    const user = req.user_fullname || 'System Auto';
    const result = await payrollCalculationService.runCalculations(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 999, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({ status: 'SUCCESS', stage: 6, progress: 'Payroll calculations completed', nextStage: 'Month-End', result });
  } catch (err) {
    console.error('Payroll calculation error:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
