const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');



router.get('/:year/:month/:payrollclass', verifyToken, async (req, res) => {
  try {
    const { year, month, payrollclass } = req.params;

    // Get approval_id first
    const [approvalResult] = await pool.query(
      'SELECT approval_id FROM py_approval_workflow WHERE process_year = ? AND process_month = ? AND payrollclass = ?',
      [year, month, payrollclass]
    );

    if (approvalResult.length === 0) {
      return res.json({ success: true, anomalies: [] });
    }

    const approvalId = approvalResult[0].approval_id;

    // Get comments
    const [result] = await pool.query(
      'CALL sp_get_review_comments(?, ?)',
      [approvalId, false] // Don't include resolved
    );

    res.json({
      success: true,
      anomalies: result[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;