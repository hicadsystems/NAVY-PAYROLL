const pool = require('../../config/db');
const inputVariable = require('../../services/file-update/inputVariable');

exports.inputVariableChanges = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });

    const { year, month, sun } = bt05Rows[0];
    if (sun < 775) return res.status(400).json({ error: 'Personnel changes must be processed first.' });
    if (sun > 775) return res.status(400).json({ error: 'Input variable report already processed.' });

    const user = req.user_fullname || 'System Auto';
    const result = await inputVariable.getInputVariableChanges(year, month, user);

    await pool.query("UPDATE py_stdrate SET sun = 777, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 3,
      progress: 'Input variable changes processed',
      nextStage: 'Master File Update',
      result,
    });
  } catch (err) {
    console.error('Error in input variable comparison:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
