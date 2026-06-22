const express = require("express");
const router = express.Router();
const pool = require("../../config/db"); // mysql2 pool
const verifyToken = require("../../middware/authentication");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call py_compute_arrears once for a single form row.
 * Returns the first result-set row from the SP (the computed line).
 */
async function callArrearsSP(conn, params) {
  const {
    empno,
    rowType,
    itemType,
    subdate1,
    subdate2,
    salcode,
    oldGrdLevel,
    newGrdLevel,
    oldAmount,
    newAmount,
    wstation,
    chkStoppage,
  } = params;

  const [results] = await conn.query(
    `CALL py_compute_arrears(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empno,
      rowType, // 'REGULAR' | 'OTHERS'
      itemType, // payroll item code
      subdate1, // DATE string YYYY-MM-DD
      subdate2, // DATE string YYYY-MM-DD
      salcode ?? null, // REGULAR: salary scale code; OTHERS: null
      oldGrdLevel ?? null, // REGULAR: packed GGSS e.g. '0103'; OTHERS: null
      newGrdLevel ?? null, // REGULAR: packed GGSS; OTHERS: null
      oldAmount ?? 0, // OTHERS: old flat amount; REGULAR: ignored
      newAmount ?? 0, // OTHERS: new flat amount; REGULAR: ignored
      wstation,
      chkStoppage ? 1 : 0,
    ],
  );

  // mysql2 CALL returns [[resultSet1, resultSet2, ...], fields]
  // Our SP emits exactly one SELECT at the end — that is results[0]
  const row = Array.isArray(results[0]) ? results[0][0] : null;
  return row;
}

/**
 * Validate a single REGULAR row from req.body.regularRows[].
 * Returns an error string or null.
 */
function validateRegularRow(row, idx) {
  if (!row.itemType) return `regularRows[${idx}]: itemType is required`;
  if (!row.subdate1) return `regularRows[${idx}]: startDate is required`;
  if (!row.subdate2) return `regularRows[${idx}]: lastDate is required`;
  if (!row.salcode)
    return `regularRows[${idx}]: salcode (OLD Salary Scale) is required`;
  if (!row.oldGrdLevel || !/^\d{4}$/.test(row.oldGrdLevel))
    return `regularRows[${idx}]: oldGrdLevel must be a 4-digit string e.g. '0103'`;
  if (!row.newGrdLevel || !/^\d{4}$/.test(row.newGrdLevel))
    return `regularRows[${idx}]: newGrdLevel must be a 4-digit string e.g. '0105'`;
  return null;
}

/**
 * Validate a single OTHERS row from req.body.othersRows[].
 * Returns an error string or null.
 */
function validateOthersRow(row, idx) {
  if (!row.itemType) return `othersRows[${idx}]: itemType is required`;
  if (!row.subdate1) return `othersRows[${idx}]: startDate is required`;
  if (!row.subdate2) return `othersRows[${idx}]: endDate is required`;
  if (row.oldAmount == null || isNaN(Number(row.oldAmount)))
    return `othersRows[${idx}]: oldAmount must be a number`;
  if (row.newAmount == null || isNaN(Number(row.newAmount)))
    return `othersRows[${idx}]: newAmount must be a number`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /arrears/calculate
//
// Body shape:
// {
//   empno:        "NN001",
//   wstation:     "HQ",
//   chkStoppage:  false,
//   regularRows: [
//     {
//       itemType:    "BP303",
//       subdate1:    "2023-01-01",   // start date  (YYYY-MM-DD)
//       subdate2:    "2023-12-31",   // last date   (YYYY-MM-DD)
//       salcode:     "AFSS2019",
//       oldGrdLevel: "0103",         // grade 01 step 03
//       newGrdLevel: "0105",         // grade 01 step 05
//     },
//     ...
//   ],
//   othersRows: [
//     {
//       itemType:  "PT399",
//       subdate1:  "2023-06-01",
//       subdate2:  "2023-12-31",
//       oldAmount: 15000.00,
//       newAmount: 20000.00,
//     },
//     ...
//   ]
// }
//
// Response:
// {
//   success: true,
//   empno:   "NN001",
//   lines:   [ { itemType, rowType, description, oldAmount, newAmount, durationLabel, netArrears, skipped }, ... ],
//   total:   "1234.56"
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/calculate", verifyToken, async (req, res) => {
  const {
    empno,
    wstation,
    chkStoppage = false,
    regularRows = [],
    othersRows = [],
  } = req.body;

  // ── Body-level validation ──
  if (!empno)
    return res
      .status(400)
      .json({ success: false, message: "empno is required" });
  if (!wstation)
    return res
      .status(400)
      .json({ success: false, message: "wstation is required" });

  if (!Array.isArray(regularRows) || !Array.isArray(othersRows)) {
    return res.status(400).json({
      success: false,
      message: "regularRows and othersRows must be arrays",
    });
  }

  const hasRows = regularRows.length > 0 || othersRows.length > 0;
  if (!hasRows) {
    return res.status(400).json({
      success: false,
      message: "At least one REGULAR or OTHERS row is required",
    });
  }

  // ── Per-row validation ──
  for (let i = 0; i < regularRows.length; i++) {
    const err = validateRegularRow(regularRows[i], i);
    if (err) return res.status(400).json({ success: false, message: err });
  }
  for (let i = 0; i < othersRows.length; i++) {
    const err = validateOthersRow(othersRows[i], i);
    if (err) return res.status(400).json({ success: false, message: err });
  }

  // ── Get a dedicated connection so all SP calls share a session context ──
  const conn = await pool.getConnection();

  try {
    const lines = [];
    let total = 0;

    // ── REGULAR rows ──
    for (const row of regularRows) {
      const spResult = await callArrearsSP(conn, {
        empno,
        rowType: "REGULAR",
        itemType: row.itemType,
        subdate1: row.subdate1,
        subdate2: row.subdate2,
        salcode: row.salcode,
        oldGrdLevel: row.oldGrdLevel,
        newGrdLevel: row.newGrdLevel,
        oldAmount: null,
        newAmount: null,
        wstation,
        chkStoppage,
      });

      if (!spResult) continue;

      if (spResult.result_code === 99) {
        return res
          .status(404)
          .json({ success: false, message: `Employee '${empno}' not found` });
      }

      lines.push({
        itemType: spResult.item_type,
        rowType: spResult.row_type,
        description: spResult.description,
        oldAmount: Number(spResult.old_amount),
        newAmount: Number(spResult.new_amount),
        durationLabel: spResult.duration_label,
        netArrears: Number(spResult.net_arrears),
        skipped: spResult.skipped === 1,
      });

      if (!spResult.skipped) {
        total += Number(spResult.net_arrears);
      }
    }

    // ── OTHERS rows ──
    for (const row of othersRows) {
      const spResult = await callArrearsSP(conn, {
        empno,
        rowType: "OTHERS",
        itemType: row.itemType,
        subdate1: row.subdate1,
        subdate2: row.subdate2,
        salcode: null,
        oldGrdLevel: null,
        newGrdLevel: null,
        oldAmount: Number(row.oldAmount),
        newAmount: Number(row.newAmount),
        wstation,
        chkStoppage,
      });

      if (!spResult) continue;

      if (spResult.result_code === 99) {
        return res
          .status(404)
          .json({ success: false, message: `Employee '${empno}' not found` });
      }

      lines.push({
        itemType: spResult.item_type,
        rowType: spResult.row_type,
        description: spResult.description,
        oldAmount: Number(spResult.old_amount),
        newAmount: Number(spResult.new_amount),
        durationLabel: spResult.duration_label,
        netArrears: Number(spResult.net_arrears),
        skipped: spResult.skipped === 1,
      });

      if (!spResult.skipped) {
        total += Number(spResult.net_arrears);
      }
    }

    return res.json({
      success: true,
      empno,
      lines,
      total: total.toFixed(2),
    });
  } catch (err) {
    console.error("[arrears/calculate]", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error during arrears calculation",
    });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /arrears/lines/:empno
// Fetch all arrears lines currently in py_tempslipnlpc for an employee.
// Used by the frontend after Calculate to display/refresh results.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/lines/:empno", verifyToken, async (req, res) => {
  const { empno } = req.params;
  if (!empno)
    return res
      .status(400)
      .json({ success: false, message: "empno is required" });

  try {
    const [rows] = await pool.query(
      `SELECT
         work_station    AS wstation,
         surname, othername, Title AS title,
         gradelevel, gradetype,
         bpc             AS itemPrefix,
         bpa             AS itemType,
         desc1           AS description,
         tpcoy           AS startDate,
         nsitfcode       AS durationLabel,
         bpm             AS newAmount,
         loan            AS oldAmount,
         lbal            AS difference,
         netpay          AS netArrears,
         numb            AS empno
       FROM py_tempslipnlpc
       WHERE numb = ?
       ORDER BY bpa`,
      [empno],
    );

    const total = rows.reduce((sum, r) => sum + Number(r.netArrears || 0), 0);

    return res.json({
      success: true,
      empno,
      lines: rows,
      total: total.toFixed(2),
    });
  } catch (err) {
    console.error("[arrears/lines]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch arrears lines" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /arrears/lines/:empno
// Clears py_tempslipnlpc for an employee — used on Cancel or before a fresh
// Calculate run so stale lines from prior sessions don't accumulate.
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/lines/:empno", verifyToken, async (req, res) => {
  const { empno } = req.params;
  if (!empno)
    return res
      .status(400)
      .json({ success: false, message: "empno is required" });

  try {
    await pool.query(`DELETE FROM py_tempslipnlpc WHERE numb = ?`, [empno]);
    return res.json({ success: true, message: "Arrears lines cleared" });
  } catch (err) {
    console.error("[arrears/lines DELETE]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to clear arrears lines" });
  }
});

module.exports = router;
