const pool = require('../../config/db');
const masterFileUpdate = require('../../services/file-update/masterFileUpdate');

exports.masterFileUpdate = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });

    const { year, month, sun } = bt05Rows[0];
    if (sun < 777) return res.status(400).json({ error: 'Input variable report must be processed first.' });
    if (sun > 777) return res.status(400).json({ error: 'Master update already completed.' });

    const user = req.user_fullname || 'System Update';
    const result = await masterFileUpdate.runUpdates(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 888, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 4,
      progress: 'Master file updates completed',
      nextStage: 'Calculation',
      logId: result.logId || result.insertId || null,
      result
    });
  } catch (err) {
    console.error('Error running master file update:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
