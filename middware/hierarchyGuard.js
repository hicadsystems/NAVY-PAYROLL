// middware/hierarchyGuard.js
//
// Payroll-class hierarchy enforcement.
//
// Live py_payrollclass schema:
//   classcode | classname  | status | db_name
//   1         | OFFICERS   | active | hicaddata
//   2         | W.OFFICERS | active | hicaddata1
//   3         | RATE A     | active | hicaddata2
//   4         | RATE B     | active | hicaddata3
//   5         | RATE C     | active | hicaddata4
//   6         | TRAINEES   | active | hicaddata5
//
// Rule for switching / accessing data:
//   User whose primary_class maps to classcode N can only access classes
//   where classcode >= N (their own class or below in rank).
//
// Rule for changing personnel payroll class:
//   Personnel can only be moved UPWARD — to a class with a LOWER classcode
//   (higher rank). Moving downward is blocked.

const pool = require("../config/db");

/**
 * Resolve any identifier (db_name, classname, or classcode string)
 * to a full py_payrollclass row. Returns null if not found.
 * py_payrollclass is in MASTER_TABLES so pool.query auto-qualifies it.
 */
async function resolveClass(identifier) {
  const [rows] = await pool.query(
    `SELECT classcode, classname, db_name
     FROM py_payrollclass
     WHERE db_name = ? OR classname = ? OR classcode = ?
     LIMIT 1`,
    [identifier, identifier, identifier],
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Guard for switching payroll class and accessing data.
 *
 * User may only access their own class or any class with a HIGHER classcode
 * (lower rank). Rejects with 403 if target classcode < user's classcode.
 *
 * Returns true  → allowed.
 * Returns false → 403 already sent, caller must return.
 */
async function assertHierarchyAccess(req, res, targetIdentifier) {
  try {
    if (!req.primary_class) {
      res.status(403).json({
        error: "Cannot determine your payroll class. Please log in again.",
      });
      return false;
    }

    const userClass = await resolveClass(req.primary_class);
    if (!userClass) {
      res.status(403).json({
        error: "Your account payroll class could not be verified.",
        primary_class: req.primary_class,
        hint: "Ensure your account primary_class matches a db_name in py_payrollclass.",
      });
      return false;
    }

    const targetClass = await resolveClass(targetIdentifier);
    if (!targetClass) {
      res.status(400).json({
        error: `Invalid or unknown payroll class: "${targetIdentifier}".`,
      });
      return false;
    }

    const userCode = parseInt(userClass.classcode, 10);
    const targetCode = parseInt(targetClass.classcode, 10);

    if (targetCode < userCode) {
      res.status(403).json({
        error: `Access denied. "${targetClass.classname}" (rank ${targetCode}) is above your class "${userClass.classname}" (rank ${userCode}).`,
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("❌ assertHierarchyAccess error:", err.message);
    res
      .status(500)
      .json({ error: "Hierarchy check failed.", details: err.message });
    return false;
  }
}

/**
 * Guard for "Change Personnel Payroll Class".
 *
 * Two rules enforced:
 * 1. User must have access to the SOURCE class (classcode >= their own).
 * 2. Target classcode must be STRICTLY LOWER than source classcode
 *    (personnel can only be moved upward / to a higher rank).
 *
 * Returns true  → allowed.
 * Returns false → 403 already sent, caller must return.
 */
async function assertUpwardMigrationOnly(
  req,
  res,
  sourceIdentifier,
  targetIdentifier,
) {
  try {
    if (!req.primary_class) {
      res.status(403).json({
        error: "Cannot determine your payroll class. Please log in again.",
      });
      return false;
    }

    const userClass = await resolveClass(req.primary_class);
    if (!userClass) {
      res.status(403).json({
        error: "Your account payroll class could not be verified.",
        primary_class: req.primary_class,
        hint: "Ensure your account primary_class matches a db_name in py_payrollclass.",
      });
      return false;
    }

    const sourceClass = await resolveClass(sourceIdentifier);
    if (!sourceClass) {
      res.status(400).json({
        error: `Invalid or unknown source payroll class: "${sourceIdentifier}".`,
      });
      return false;
    }

    const targetClass = await resolveClass(targetIdentifier);
    if (!targetClass) {
      res.status(400).json({
        error: `Invalid or unknown target payroll class: "${targetIdentifier}".`,
      });
      return false;
    }

    const userCode = parseInt(userClass.classcode, 10);
    const sourceCode = parseInt(sourceClass.classcode, 10);
    const targetCode = parseInt(targetClass.classcode, 10);

    // Rule 1: user must have access to the source class (their level or below)
    if (sourceCode < userCode) {
      res.status(403).json({
        error: `Access denied. You cannot operate on "${sourceClass.classname}" — it is above your class "${userClass.classname}".`,
      });
      return false;
    }

    // Rule 2: target must be higher rank (lower classcode) than source
    if (targetCode >= sourceCode) {
      res.status(403).json({
        error: `Invalid direction. Personnel can only be moved upward. "${targetClass.classname}" (rank ${targetCode}) is not above "${sourceClass.classname}" (rank ${sourceCode}).`,
        hint: "Choose a target class with a lower classcode (higher rank).",
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("❌ assertUpwardMigrationOnly error:", err.message);
    res
      .status(500)
      .json({ error: "Hierarchy check failed.", details: err.message });
    return false;
  }
}

module.exports = {
  resolveClass,
  assertHierarchyAccess,
  assertUpwardMigrationOnly,
};
