const pool = require('../../config/db');
const personnelData = require('../../services/file-update/personnelData');

exports.personnelChanges = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });

    const { year, month, sun } = bt05Rows[0];
    if (sun < 666) return res.status(400).json({ error: 'Save payroll files first.' });
    if (sun > 666) return res.status(400).json({ error: 'Personnel changes already processed.' });

    const user = req.user_fullname || 'System Auto';
    const result = await personnelData.getPersonnelChanges(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 775, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 2,
      progress: 'Personnel changes processed',
      nextStage: 'Input Variable Comparison',
      result,
    });
  } catch (err) {
    console.error('Error getting personnel changes:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
