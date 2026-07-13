const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const verifyToken = require("../../middware/authentication");
const pool = require("../../config/db");
const { assertHierarchyAccess } = require("../../middware/hierarchyGuard");

const SECRET = process.env.JWT_SECRET;

const getDISPLAY_MAPPING = async () => {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();

  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      "SELECT db_name, classname FROM py_payrollclass",
    );

    const DISPLAY_MAPPING = {};
    rows.forEach(({ db_name, classname }) => {
      DISPLAY_MAPPING[db_name] = classname;
    });

    return DISPLAY_MAPPING;
  } finally {
    connection.release();
  }
};

// Get available database classes filtered by hierarchy.
// Only returns classes at the user's level or below (classcode >= user's classcode).
router.get("/dbclasses", verifyToken, async (req, res) => {
  try {
    const { resolveClass } = require("../../middware/hierarchyGuard");

    // Resolve the user's own class to get their classcode
    const userClass = await resolveClass(req.primary_class);
    const userClasscode = userClass ? parseInt(userClass.classcode, 10) : null;

    // Fetch all active classes; filter by hierarchy if we resolved the user's class
    const [rows] = await pool.query(`
      SELECT classcode, classname, db_name
      FROM py_payrollclass
      ORDER BY CAST(classcode AS UNSIGNED) ASC
    `);

    const filtered = rows.filter(
      (row) =>
        userClasscode === null || parseInt(row.classcode, 10) >= userClasscode,
    );

    const classes = filtered.map((row) => ({
      id: row.db_name,
      display: row.classname,
      dbName: row.db_name,
      classcode: row.classcode,
      isPrimary: row.db_name === req.primary_class,
      isActive: row.db_name === req.current_class,
      hasAccess: true,
    }));

    res.json({
      classes,
      currentClass: req.current_class,
      primaryClass: req.primary_class,
      userId: req.user_id,
    });
  } catch (err) {
    console.error("❌ Error loading db_classes:", err);
    res.status(500).json({ error: "Failed to load classes" });
  }
});

// Switch payroll class — enforces hierarchy before switching.
router.post("/switch-class", verifyToken, async (req, res) => {
  try {
    const { targetClass } = req.body;
    const userId = req.user_id;

    console.log(`\n🔄 User ${userId} attempting to switch to: ${targetClass}`);

    // Resolve targetClass to a full class row
    let [classRows] = await pool.query(
      `
      SELECT classcode, classname, db_name, status
      FROM py_payrollclass
      WHERE classname = ? AND status = 'active'
    `,
      [targetClass],
    );

    if (classRows.length === 0) {
      [classRows] = await pool.query(
        `
        SELECT classcode, classname, db_name, status
        FROM py_payrollclass
        WHERE db_name = ? AND status = 'active'
      `,
        [targetClass],
      );
    }

    if (classRows.length === 0) {
      return res.status(400).json({ error: "Invalid class selected" });
    }

    const selectedClass = classRows[0];
    const targetDbName = selectedClass.db_name;

    // ── Hierarchy check ──────────────────────────────────────────────────────
    // User may only switch to their own class or one ranked below (higher code).
    if (!(await assertHierarchyAccess(req, res, targetDbName))) return;
    // ────────────────────────────────────────────────────────────────────────

    console.log(
      `✅ Hierarchy cleared — switching to: ${selectedClass.classname} (${targetDbName})`,
    );

    pool.useDatabase(targetDbName);

    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: req.primary_class,
      current_class: targetDbName,
      created_in: req.created_in || req.primary_class,
    };

    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: "6h" });

    console.log(`\n✅ Successfully switched user ${userId} to ${targetDbName}`);
    console.log(`   Primary class (home): ${req.primary_class}`);
    console.log(
      `   Current class (working): ${targetDbName} (${selectedClass.classname})`,
    );

    res.json({
      success: true,
      message: `Switched to ${selectedClass.classname} successfully.`,
      token: newToken,
      newClass: { id: selectedClass.db_name, display: selectedClass.classname },
      isPrimary: selectedClass.db_name === req.primary_class,
      switchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Switch class error:", err);
    res.status(500).json({ error: "Failed to switch class" });
  }
});

// Get current session info
router.get("/session-info", verifyToken, async (req, res) => {
  try {
    const DISPLAY_MAPPING = await getDISPLAY_MAPPING();

    res.json({
      userId: req.user_id,
      fullName: req.user_fullname,
      role: req.user_role,
      primaryClass: {
        id: req.primary_class,
        display:
          DISPLAY_MAPPING[req.primary_class] || req.primary_class.toUpperCase(),
      },
      currentClass: {
        id: req.current_class,
        display:
          DISPLAY_MAPPING[req.current_class] || req.current_class.toUpperCase(),
      },
      isWorkingOnPrimary: req.primary_class === req.current_class,
    });
  } catch (error) {
    console.error("❌ Session info error:", error);
    res.status(500).json({ error: "Failed to get session info" });
  }
});

// Reset to primary class
router.post("/reset-to-primary", verifyToken, async (req, res) => {
  try {
    const DISPLAY_MAPPING = await getDISPLAY_MAPPING();

    // Create new JWT with current_class reset to primary_class
    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: req.primary_class,
      current_class: req.primary_class, // Reset to primary (e.g., back to 'hicaddata')
    };

    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: "24h" });

    console.log(
      `🔄 User ${req.user_fullname} reset to primary class: ${req.primary_class}`,
    );

    res.json({
      success: true,
      message: `Reset to primary class: ${DISPLAY_MAPPING[req.primary_class] || req.primary_class}`,
      token: newToken,
      resetAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Reset to primary error:", error);
    res.status(500).json({
      error: "Failed to reset to primary class",
      message: error.message,
    });
  }
});

module.exports = router;
