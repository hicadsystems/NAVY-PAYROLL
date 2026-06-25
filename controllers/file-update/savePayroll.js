const pool = require("../../config/db");
const savePayrollService = require("../../services/file-update/savePayroll");

exports.savePayrollFiles = async (req, res) => {
  try {
    // Get current payroll period from BT05
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sat FROM py_stdrate WHERE type='BT05' LIMIT 1",
    );
    if (bt05Rows.length === 0)
      return res.status(404).json({ error: "BT05 not found" });

    const { year, month, sat } = bt05Rows[0];

    // Gate: payroll files can only be saved once validation is fully
    // complete (BT05.sat = 600 — every py_payded row has been verified).
    if (sat !== 600) {
      return res.status(409).json({
        status: "FAILED",
        message:
          "Cannot save payroll files: Payment/Deductions Validation is not complete (BT05.sat must be 600).",
        sat,
      });
    }

    const user = req.user_fullname || "System Auto";

    // Call service
    const result = await savePayrollService.saveFiles(year, month, user);

    // Move BT05 to next stage (Data Entry Closed) and lock validation as saved.
    // sat -> 700 disables/removes the Unlock button on the Validation screen.
    await pool.query(
      "UPDATE py_stdrate SET sun = 666, sat = 700, createdby = ? WHERE type = 'BT05'",
      [user],
    );

    res.json({
      status: "SUCCESS",
      stage: 1,
      progress: "Data Entry Closed",
      message: "Payroll files saved successfully",
      logId: result.logId || result.insertId || null,
      sat: 700,
      result,
    });
  } catch (err) {
    console.error("Error saving payroll files:", err);
    res.status(500).json({ status: "FAILED", message: err.message });
  }
};
