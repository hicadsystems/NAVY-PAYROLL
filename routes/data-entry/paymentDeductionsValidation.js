// routes/data-entry/paymentDeductionsValidation.js
//
// Payment/Deductions Validation screen — backend.
//
// Stage model lives on py_stdrate WHERE type = 'BT05', column `sat`:
//   0   -> Data Entry open. Validation screen renders nothing.
//   500 -> Locked for validation. Set when the "Lock" button is pressed on the
//          frontend. While sat = 500, Data Entry (py_payded create/update/delete)
//          must be blocked, and the Validation screen has data to render.
//   600 -> All py_payded rows have been verified (verifiedby IS NOT NULL on every
//          row). Set automatically the moment the last row is verified.
//   700 -> Payroll files have been saved (see /savepayroll). Set by the savePayroll
//          controller once it has confirmed sat = 600.
//
// Unlock is available at sat = 500 or 600 (it does NOT require full
// verification first -- its only job is to let new py_payded rows be added
// from Data Entry again). Unlocking resets sat all the way to 0, which
// re-opens Data Entry's own write guard. The Validation screen then renders
// nothing again until locked. Unlock is disabled once sat = 700 (saved).
//
// Verification is tracked per-row via verifiedby/dateverified and persists
// across unlock/lock cycles -- it is NOT reset by the sat stage transition.
// A verified row stays immutable from the Data Entry screen even at sat = 0;
// it can only be modified or deleted from this Validation screen's Verified
// tab, and only after an explicit "are you sure you want to modify this
// verified record?" confirmation. Doing so keeps the row's status as
// Verified but re-stamps verifiedby/dateverified to the editor.
//
// Verification audit fields added to py_payded by migration
// 20260624_151352_payded_verification_columns.sql:
//   verifiedby    - full name of the user who verified the row (NULL = pending)
//   dateverified  - timestamp the row was verified
//
// Note: row edits (modify) happen inline in the same modal as the Verify action;
// there is no separate "modifiedby" audit trail per the product requirement.

const express = require("express");
const pool = require("../../config/db");
const verifyToken = require("../../middware/authentication");
const router = express.Router();

const BT05_TYPE = "BT05";

// Small helper — fetch the current BT05 row (sat/sun/ord/mth etc.)
async function getBt05(connection = pool) {
  const [rows] = await connection.query(
    "SELECT type, ord AS year, mth AS month, sat, sun FROM py_stdrate WHERE type = ? LIMIT 1",
    [BT05_TYPE],
  );
  return rows[0] || null;
}

// ===================================================================
// reconcileSat — single source of truth for the invariant:
//   "while locked for validation (sat = 500), if there are no pending
//    rows left to verify, validation is complete -> advance sat to 600."
//
// This is the ONE place that rule is enforced. Any code path that can empty
// the pending queue (verify-one, verify-all, delete) or that just observes
// the stage (the /stage poll, list, stats) should route through here instead
// of re-implementing the 500->600 bump, so the state self-heals no matter how
// the last pending row disappeared.
//
// Only ever touches sat when it is exactly 500: 0 (data entry open), 600
// (already complete) and 700 (saved) are left untouched. Returns the BT05 row
// with sat reflecting any advance that was just applied.
// ===================================================================
async function reconcileSat(connection = pool) {
  const bt05 = await getBt05(connection);
  if (!bt05 || bt05.sat !== 500) return bt05;

  const [[pendingCount]] = await connection.query(
    "SELECT COUNT(*) AS pending FROM py_payded WHERE verifiedby IS NULL",
  );
  if (pendingCount.pending === 0) {
    await connection.query("UPDATE py_stdrate SET sat = 600 WHERE type = ?", [
      BT05_TYPE,
    ]);
    bt05.sat = 600;
  }
  return bt05;
}

// ===================================================================
// GET CURRENT VALIDATION STAGE
// Frontend polls/loads this to decide what to render. Per spec: nothing
// renders on the validation screen unless sat is 500, 600, or 700.
// Unlock is available at 500 or 600 (its only job is to let new py_payded
// rows be added from Data Entry again -- it does not require full
// verification first); it resets sat all the way to 0.
// ===================================================================
router.get("/stage", verifyToken, async (req, res) => {
  try {
    // Self-heal on every poll: if locked with nothing left to verify,
    // this advances sat 500 -> 600 before we report the stage.
    const bt05 = await reconcileSat();

    if (!bt05) {
      return res.status(404).json({
        success: false,
        message: "BT05 not found in py_stdrate",
      });
    }

    const sat = bt05.sat;
    const isLocked = sat === 500 || sat === 600 || sat === 700;

    res.json({
      success: true,
      sat,
      isLocked,
      canRenderValidationScreen: isLocked,
      canUnlock: sat === 500 || sat === 600,
      isSaved: sat === 700,
      year: bt05.year,
      month: bt05.month,
    });
  } catch (error) {
    console.error("Error fetching validation stage:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching validation stage",
      error: error.message,
    });
  }
});

// ===================================================================
// LOCK — sat: 0 -> 500 (or straight to 600 if nothing is pending)
// Triggered by the frontend "Lock" button. Once locked, Data Entry
// (py_payded inputs) must stop accepting modifications, and the
// Validation screen has data to render.
//
// If there are zero pending rows at the moment of locking (e.g. the table
// is empty, or every row was already verified in a prior cycle), there is
// nothing to verify -- skip straight to sat = 600 instead of sitting at
// 500 with an empty Pending tab and an unusable "Verify All" button.
// ===================================================================
router.post("/lock", verifyToken, async (req, res) => {
  try {
    const bt05 = await getBt05();

    if (!bt05) {
      return res.status(404).json({
        success: false,
        message: "BT05 not found in py_stdrate",
      });
    }

    if (bt05.sat === 500 || bt05.sat === 600 || bt05.sat === 700) {
      return res.json({
        success: true,
        message: "Already locked",
        sat: bt05.sat,
      });
    }

    const [[pendingCount]] = await pool.query(
      "SELECT COUNT(*) AS pending FROM py_payded WHERE verifiedby IS NULL",
    );
    const nothingPending = pendingCount.pending === 0;
    const nextSat = nothingPending ? 600 : 500;

    await pool.query("UPDATE py_stdrate SET sat = ? WHERE type = ?", [
      nextSat,
      BT05_TYPE,
    ]);

    res.json({
      success: true,
      message: nothingPending
        ? "Data entry locked. No pending records to verify -- validation is already complete."
        : "Data entry locked. Validation screen is now active.",
      sat: nextSat,
    });
  } catch (error) {
    console.error("Error locking BT05 for validation:", error);
    res.status(500).json({
      success: false,
      message: "Error locking for validation",
      error: error.message,
    });
  }
});

// ===================================================================
// UNLOCK — sat: 500/600 -> 0
// Triggered by the frontend "Unlock" button, available any time data
// entry is locked for validation (sat = 500 or 600) -- it does NOT require
// every row to be verified first. Its only purpose is to let new py_payded
// rows be added from Data Entry again. Resets sat fully to 0 (the original
// pre-lock state), which re-opens Data Entry's own write guard. The
// Validation screen then shows nothing again until locked.
//
// Already-verified rows (verifiedby IS NOT NULL) remain verified across the
// unlock/lock cycle -- verification status is tracked per-row, not reset by
// the stage transition. Data Entry's own guard additionally refuses to
// touch a row once verifiedby is set, regardless of sat.
// ===================================================================
router.post("/unlock", verifyToken, async (req, res) => {
  try {
    const bt05 = await getBt05();

    if (!bt05) {
      return res.status(404).json({
        success: false,
        message: "BT05 not found in py_stdrate",
      });
    }

    if (![500, 600].includes(bt05.sat)) {
      return res.status(409).json({
        success: false,
        message:
          bt05.sat === 700
            ? "Cannot unlock: payroll files have already been saved."
            : "Cannot unlock: data entry is not currently locked for validation.",
        sat: bt05.sat,
      });
    }

    await pool.query("UPDATE py_stdrate SET sat = 0 WHERE type = ?", [
      BT05_TYPE,
    ]);

    res.json({
      success: true,
      message: "Unlocked. Data entry re-opened for new entries.",
      sat: 0,
    });
  } catch (error) {
    console.error("Error unlocking BT05:", error);
    res.status(500).json({
      success: false,
      message: "Error unlocking",
      error: error.message,
    });
  }
});

// ===================================================================
// LIST PAYDED ROWS FOR VALIDATION (paginated, with tab filter)
// Renders only when sat = 500/600/700 (frontend already gates on /stage,
// this endpoint defends the same rule server-side).
//
// Query params:
//   tab    : 'pending' | 'verified' | 'all'  (default 'pending')
//   page, limit, search
// ===================================================================
router.get("/", verifyToken, async (req, res) => {
  try {
    const bt05 = await reconcileSat();

    if (!bt05 || ![500, 600, 700].includes(bt05.sat)) {
      return res.json({
        success: true,
        locked: false,
        message: "Validation screen is not active (BT05.sat is not 500).",
        data: [],
        pagination: null,
      });
    }

    const tab = (req.query.tab || "pending").toLowerCase();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const searchQuery = req.query.search || "";

    let tabClause = "";
    if (tab === "pending") {
      tabClause = "AND p.verifiedby IS NULL";
    } else if (tab === "verified") {
      tabClause = "AND p.verifiedby IS NOT NULL";
    } // 'all' -> no clause

    let searchClause = "";
    const queryParams = [];
    if (searchQuery) {
      searchClause =
        "AND (p.Empl_id LIKE ? OR p.type LIKE ? OR CONCAT(e.Surname, ' ', e.OtherName) LIKE ?)";
      const pattern = `%${searchQuery}%`;
      queryParams.push(pattern, pattern, pattern);
    }

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM py_payded p
      LEFT JOIN hr_employees e ON p.Empl_id = e.Empl_ID
      WHERE 1 = 1
      ${tabClause}
      ${searchClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    // Full name = Surname + OtherName, truncated to 20 chars for card display
    const dataQuery = `
      SELECT
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS months_remaining,
        p.createdby,
        p.datecreated,
        p.verifiedby,
        p.dateverified,
        CASE WHEN p.verifiedby IS NULL THEN 'pending' ELSE 'verified' END AS verification_status,
        TRIM(CONCAT(COALESCE(e.Surname, ''), ' ', COALESCE(e.OtherName, ''))) AS full_name,
        LEFT(TRIM(CONCAT(COALESCE(e.Surname, ''), ' ', COALESCE(e.OtherName, ''))), 20) AS full_name_short
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      LEFT JOIN hr_employees e ON p.Empl_id = e.Empl_ID
      WHERE 1 = 1
      ${tabClause}
      ${searchClause}
      ORDER BY p.Empl_id, p.type
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataQuery, [...queryParams, limit, offset]);

    res.json({
      success: true,
      locked: true,
      sat: bt05.sat,
      tab,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching validation list:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching validation list",
      error: error.message,
    });
  }
});

// ===================================================================
// STATS — counts for frontend tab filtering (pending / verified)
// Controlled purely by verifiedby (NULL = pending, else verified).
// ===================================================================
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const bt05 = await reconcileSat();

    if (!bt05 || ![500, 600, 700].includes(bt05.sat)) {
      return res.json({
        success: true,
        locked: false,
        pending: 0,
        verified: 0,
        total: 0,
      });
    }

    const [rows] = await pool.query(`
      SELECT
        SUM(CASE WHEN verifiedby IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN verifiedby IS NOT NULL THEN 1 ELSE 0 END) AS verified,
        COUNT(*) AS total
      FROM py_payded
    `);

    const stats = rows[0] || { pending: 0, verified: 0, total: 0 };

    res.json({
      success: true,
      locked: true,
      sat: bt05.sat,
      pending: Number(stats.pending) || 0,
      verified: Number(stats.verified) || 0,
      total: Number(stats.total) || 0,
    });
  } catch (error) {
    console.error("Error fetching validation stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching validation stats",
      error: error.message,
    });
  }
});

// ===================================================================
// MODIFY A ROW (from the validation modal) — only while sat = 500
// Editing happens in the same modal as Verify; this does NOT touch
// verifiedby/dateverified, and there is no modifiedby audit column.
// ===================================================================
// MODIFY A ROW (from the validation modal)
// Allowed while sat = 500 or 600 (the screen only renders for 500/600/700,
// and 700 means payroll is saved/closed, so edits stop there).
//
// If the row was already verified, editing it does NOT reset it to pending --
// per product requirement, a verified row stays "Verified" but is re-stamped:
// verifiedby/dateverified are updated to reflect who last touched it and when.
// The frontend gates this behind an explicit "are you sure you want to modify
// this verified record?" confirmation before enabling the fields.
// ===================================================================
router.put("/:emplId/:type", verifyToken, async (req, res) => {
  try {
    const bt05 = await getBt05();
    if (!bt05 || ![500, 600].includes(bt05.sat)) {
      return res.status(409).json({
        success: false,
        message:
          "Modifications are only allowed while validation is active (BT05.sat = 500 or 600).",
        sat: bt05 ? bt05.sat : null,
      });
    }

    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);
    const { amtp, amttd, payind, nomth, amt, amtad } = req.body;

    const [existing] = await pool.query(
      "SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?",
      [emplId, decodedType],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Deduction not found",
      });
    }

    const wasVerified = !!existing[0].verifiedby;
    const updates = [];
    const values = [];

    if (amtp !== undefined) {
      updates.push("amtp = ?");
      values.push(amtp);
    }
    if (amttd !== undefined) {
      updates.push("amttd = ?");
      values.push(amttd);
    }
    if (payind !== undefined) {
      updates.push("payind = ?");
      values.push(payind);
    }
    if (nomth !== undefined) {
      updates.push("nomth = ?");
      values.push(nomth);
    }
    if (amt !== undefined) {
      updates.push("amt = ?");
      values.push(amt);
    }
    if (amtad !== undefined) {
      updates.push("amtad = ?");
      values.push(amtad);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    updates.push("datecreated = NOW()");

    // Re-stamp verification on the editor if this row was already verified --
    // it stays "Verified" but now reflects who last modified it.
    if (wasVerified) {
      updates.push("verifiedby = ?", "dateverified = NOW()");
      values.push(req.user_fullname || "System");
    }

    values.push(emplId, decodedType);

    await pool.query(
      `UPDATE py_payded SET ${updates.join(", ")} WHERE Empl_id = ? AND type = ?`,
      values,
    );

    const [updated] = await pool.query(
      "SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?",
      [emplId, decodedType],
    );

    res.json({
      success: true,
      message: wasVerified
        ? "Verified record updated and re-stamped successfully"
        : "Record updated successfully",
      data: updated[0],
      reVerified: wasVerified,
    });
  } catch (error) {
    console.error("Error modifying payded row during validation:", error);
    res.status(500).json({
      success: false,
      message: "Error modifying record",
      error: error.message,
    });
  }
});

// ===================================================================
// VERIFY ONE ROW
// Logs verifiedby = req.user_fullname and dateverified = NOW().
// After the update, checks whether every py_payded row is now verified;
// if so, advances BT05.sat 500 -> 600 automatically.
// ===================================================================
router.post("/:emplId/:type/verify", verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const bt05 = await getBt05(connection);
    if (!bt05 || bt05.sat !== 500) {
      return res.status(409).json({
        success: false,
        message: "Verification is only allowed while BT05.sat = 500.",
        sat: bt05 ? bt05.sat : null,
      });
    }

    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);
    const verifiedby = req.user_fullname || "System";

    await connection.beginTransaction();
    transactionStarted = true;

    const [result] = await connection.query(
      `UPDATE py_payded
       SET verifiedby = ?, dateverified = NOW()
       WHERE Empl_id = ? AND type = ?`,
      [verifiedby, emplId, decodedType],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Deduction not found",
      });
    }

    // Check if every row is now verified -> advance to 600
    const [[pendingCount]] = await connection.query(
      "SELECT COUNT(*) AS pending FROM py_payded WHERE verifiedby IS NULL",
    );

    let satAdvanced = false;
    if (pendingCount.pending === 0) {
      await connection.query("UPDATE py_stdrate SET sat = 600 WHERE type = ?", [
        BT05_TYPE,
      ]);
      satAdvanced = true;
    }

    await connection.commit();
    transactionStarted = false;

    const [updated] = await pool.query(
      "SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?",
      [emplId, decodedType],
    );

    res.json({
      success: true,
      message: "Record verified successfully",
      data: updated[0],
      sat: satAdvanced ? 600 : 500,
      allVerified: satAdvanced,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error("Error verifying payded row:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying record",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// ===================================================================
// VERIFY ALL (PENDING) ROWS
// Logs verifiedby/dateverified on every currently-pending row, then
// advances BT05.sat 500 -> 600 since, by definition, all rows are now
// verified. No "delete all" counterpart exists, per spec.
// ===================================================================
router.post("/verify-all", verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const bt05 = await getBt05(connection);
    if (!bt05 || bt05.sat !== 500) {
      return res.status(409).json({
        success: false,
        message: "Verification is only allowed while BT05.sat = 500.",
        sat: bt05 ? bt05.sat : null,
      });
    }

    const verifiedby = req.user_fullname || "System";

    await connection.beginTransaction();
    transactionStarted = true;

    const [result] = await connection.query(
      `UPDATE py_payded
       SET verifiedby = ?, dateverified = NOW()
       WHERE verifiedby IS NULL`,
      [verifiedby],
    );

    // All rows are verified by definition now -> advance to 600
    await connection.query("UPDATE py_stdrate SET sat = 600 WHERE type = ?", [
      BT05_TYPE,
    ]);

    await connection.commit();
    transactionStarted = false;

    res.json({
      success: true,
      message: `${result.affectedRows} record(s) verified successfully. Validation complete.`,
      affectedRows: result.affectedRows,
      sat: 600,
      allVerified: true,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error("Error verifying all payded rows:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying all records",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// ===================================================================
// DELETE ONE ROW (from validation screen) — allowed while sat = 500 or 600.
// Deleting an already-verified row requires the same explicit
// "are you sure you want to modify this verified record?" confirmation
// on the frontend before this endpoint is called. No "delete all"
// endpoint exists, per spec.
//
// Deleting a row can empty the pending queue (e.g. every newly-added,
// still-pending row gets deleted). When that happens while sat = 500 there
// is nothing left to verify, so -- mirroring verify-one / verify-all / lock
// -- advance sat 500 -> 600 instead of stranding the user on a validation
// screen with an empty Pending tab and an unusable "Verify All" button.
// ===================================================================
router.delete("/:emplId/:type", verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const bt05 = await getBt05(connection);
    if (!bt05 || ![500, 600].includes(bt05.sat)) {
      return res.status(409).json({
        success: false,
        message:
          "Deletion is only allowed while validation is active (BT05.sat = 500 or 600).",
        sat: bt05 ? bt05.sat : null,
      });
    }

    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);

    await connection.beginTransaction();
    transactionStarted = true;

    const [result] = await connection.query(
      "DELETE FROM py_payded WHERE Empl_id = ? AND type = ?",
      [emplId, decodedType],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Deduction not found",
      });
    }

    // Deleting this row may have cleared the last pending record. Route through
    // the shared invariant: if sat = 500 and nothing is pending, advance to 600.
    const reconciled = await reconcileSat(connection);
    const satAdvanced = bt05.sat === 500 && reconciled.sat === 600;

    await connection.commit();
    transactionStarted = false;

    res.json({
      success: true,
      message: satAdvanced
        ? "Record deleted. No pending records remain -- validation complete."
        : "Record deleted successfully",
      affectedRows: result.affectedRows,
      sat: satAdvanced ? 600 : bt05.sat,
      allVerified: satAdvanced,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error("Error deleting payded row during validation:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting record",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

module.exports = router;

