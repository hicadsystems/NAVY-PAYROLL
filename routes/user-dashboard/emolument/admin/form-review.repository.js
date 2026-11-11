/**
 * FILE: routes/user-dashboard/emolument/admin/form-review.repository.js
 *
 * SQL for the admin "Review & Approve" section (emolument-admin →
 * bulk-approve.html). The admin works across every ship and command, so
 * none of the writes here are gated on a ship/command scope the way the
 * DO/FO/CPO equivalents are. They ARE gated on the form's current status,
 * so a form that another session has already moved is never moved twice.
 *
 * Stage ↔ storage (see emolument.constants.js):
 *
 *   Stage           ef_personalinfos.Status        ef_emolument_forms.status
 *   ─────────────   ─────────────────────────────  ─────────────────────────
 *   Not filled      NULL / ''                      DRAFT / REJECTED / none
 *   Submitted       'Filled' / 'FO' (+ enum forms) SUBMITTED / DO_REVIEWED
 *   FO approved     'CPO'                          FO_APPROVED
 *   Confirmed       'Verified'  (emolumentform=Yes) CPO_CONFIRMED
 *   Completed       'Updated'   (emolumentform=Yes) CPO_CONFIRMED (+ SYNCED trail)
 *
 * Every multi-table write runs in one transaction.
 */

"use strict";

const pool = require("../../../../config/db");
const config = require("../../../../config");
const { buildNameOrServiceNumberClause } = require("../emolument.search");
const formRepo = require("../form/form.repository");
const {
  FORM_STATUS,
  LEGACY_STATUS,
  FILLED_STATUS_VALUES,
} = require("../emolument.constants");

const DB = () => process.env.DB_OFFICERS || config.databases.officers;

// Max comma-separated terms accepted by one search, so a pasted list can't
// build an unbounded OR chain.
const MAX_SEARCH_TERMS = 100;

// Status values that mean "submitted, waiting for FO approval".
const SUBMITTED_STATUS_SQL = FILLED_STATUS_VALUES.map((v) => `'${v}'`).join(", ");

// Status values that mean "FO approved, waiting for CPO confirmation".
const FO_APPROVED_STATUS_SQL = [
  LEGACY_STATUS.FO_APPROVED, // 'CPO'
  FORM_STATUS.FO_APPROVED, //   'FO_APPROVED'
]
  .map((v) => `'${v}'`)
  .join(", ");

function staleError(message) {
  return Object.assign(new Error(message), { code: "STALE_STATUS" });
}

async function withTransaction(fn) {
  pool.useDatabase(DB());
  return pool.smartTransaction(fn);
}

// ─────────────────────────────────────────────────────────────
// SETTINGS — ef_settings key/value store
// ─────────────────────────────────────────────────────────────

let settingsTableReady = false;

// The migration creates the table; this covers deployments where the
// migration has not been run yet, so the toggle works on first use.
async function ensureSettingsTable() {
  if (settingsTableReady) return;
  pool.useDatabase(DB());
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ef_settings (
       setting_key    VARCHAR(64)  NOT NULL,
       setting_value  VARCHAR(255) NULL,
       updated_by     VARCHAR(50)  NULL,
       updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (setting_key)
     )`,
  );
  settingsTableReady = true;
}

async function getSetting(key) {
  pool.useDatabase(DB());
  try {
    await ensureSettingsTable();
    const [rows] = await pool.query(
      `SELECT setting_value, updated_by, updated_at
       FROM ef_settings WHERE setting_key = ? LIMIT 1`,
      [key],
    );
    return rows[0] || null;
  } catch (err) {
    // No table and no CREATE privilege — treat as "not set".
    if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_TABLEACCESS_DENIED_ERROR") {
      return null;
    }
    throw err;
  }
}

async function setSetting(key, value, updatedBy) {
  pool.useDatabase(DB());
  await ensureSettingsTable();
  await pool.query(
    `INSERT INTO ef_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       setting_value = VALUES(setting_value),
       updated_by    = VALUES(updated_by),
       updated_at    = NOW()`,
    [key, value, updatedBy ?? null],
  );
}

// ─────────────────────────────────────────────────────────────
// LIST — every personnel record, alphabetical, any status
// ─────────────────────────────────────────────────────────────

/**
 * Splits "NN/0001, Musa ,NN0002" into distinct non-empty terms.
 * @param {string} q
 * @returns {string[]}
 */
function splitSearchTerms(q) {
  const seen = new Set();
  const terms = [];
  for (const raw of String(q ?? "").split(",")) {
    const term = raw.trim();
    const key = term.toUpperCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_SEARCH_TERMS) break;
  }
  return terms;
}

function buildListClause(filters = {}) {
  // Rows with no service number are exit placeholders — nothing to review.
  const conditions = ["p.serviceNumber IS NOT NULL", "p.serviceNumber <> ''"];
  const params = [];

  // Comma-separated search: each term matches name OR service number,
  // and a row matches if ANY term matches.
  const terms = splitSearchTerms(filters.q);
  if (terms.length) {
    const parts = [];
    for (const term of terms) {
      const { sql, params: termParams } = buildNameOrServiceNumberClause(term);
      if (sql) {
        parts.push(sql);
        params.push(...termParams);
      }
    }
    if (parts.length) conditions.push(`(${parts.join(" OR ")})`);
  }

  if (filters.ship) {
    conditions.push("p.ship = ?");
    params.push(filters.ship);
  }
  if (filters.command) {
    conditions.push("p.command = ?");
    params.push(filters.command);
  }
  if (filters.payrollclass) {
    conditions.push("p.payrollclass = ?");
    params.push(filters.payrollclass);
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}

async function listForms(filters = {}, limit = 25, offset = 0) {
  pool.useDatabase(DB());
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { where, params } = buildListClause(filters);

  const [rows] = await pool.query(
    `SELECT p.serviceNumber, p.Surname, p.OtherName, p.Rank,
            p.payrollclass, p.classes, p.ship, p.command,
            p.Status, p.emolumentform, p.formNumber, p.FormYear,
            cmd.commandName
     FROM ef_personalinfos p
     LEFT JOIN ef_commands cmd ON cmd.code = p.command
     ${where}
     ORDER BY p.Surname ASC, p.OtherName ASC, p.serviceNumber ASC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ef_personalinfos p ${where}`,
    params,
  );

  return { rows, total: Number(total) || 0 };
}

// ─────────────────────────────────────────────────────────────
// SINGLE RECORD LOOKUPS
// ─────────────────────────────────────────────────────────────

async function getPersonForReview(serviceNo) {
  pool.useDatabase(DB());
  const [rows] = await pool.query(
    `SELECT serviceNumber, Surname, OtherName, \`Rank\`, Status, emolumentform,
            payrollclass, classes, ship, command, formNumber, FormYear
     FROM ef_personalinfos
     WHERE serviceNumber = ? LIMIT 1`,
    [serviceNo],
  );
  return rows[0] || null;
}

// The form row for a cycle — same preference order the form loader uses.
async function getFormRow(serviceNo, formYear) {
  pool.useDatabase(DB());
  const [rows] = await pool.query(
    `SELECT id, status, ship, command
     FROM ef_emolument_forms
     WHERE service_no = ? AND form_year = ?
     ORDER BY (status <> 'DRAFT') DESC, id DESC
     LIMIT 1`,
    [serviceNo, String(formYear)],
  );
  return rows[0] || null;
}

// Admin edit — writes every form table in one transaction, no status change.
async function saveFormTables(serviceNo, body, validLoanTypes, validAllowTypes) {
  return withTransaction((conn) =>
    formRepo.saveAllTables(conn, serviceNo, body, validLoanTypes, validAllowTypes),
  );
}

// Keep the form row's routing (ship/command) in step with an admin edit,
// so the form keeps showing up for the right FO/CPO.
async function updateFormRowPlacement(serviceNo, formYear, ship, command) {
  pool.useDatabase(DB());
  await pool.query(
    `UPDATE ef_emolument_forms
     SET ship = ?, command = ?, updated_at = NOW()
     WHERE service_no = ? AND form_year = ?`,
    [ship ?? null, command ?? null, serviceNo, String(formYear)],
  );
}

// ─────────────────────────────────────────────────────────────
// PROGRESS — one stage forward
// ─────────────────────────────────────────────────────────────

async function insertApprovalTx(conn, { formId, action, fromStatus, toStatus, performedBy, remarks }) {
  await conn.query(
    `INSERT INTO ef_form_approvals
       (form_id, action, from_status, to_status, performed_by, performer_role, remarks, performed_at)
     VALUES (?, ?, ?, ?, ?, 'EMOL_ADMIN', ?, NOW())`,
    [formId, action, fromStatus || null, toStatus, performedBy, remarks || null],
  );
}

/**
 * Not filled → Submitted. Marks the personnel row submitted with the given
 * form number/year. The caller writes the ef_emolument_forms row and the
 * trail after commit, exactly like a personnel submission does.
 */
async function markSubmittedByAdmin(serviceNo, formNumber, formYear) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE ef_personalinfos
       SET Status      = ?,
           formNumber  = ?,
           FormYear    = ?,
           datecreated = NOW(),
           dateModify  = NOW()
       WHERE serviceNumber = ?
         AND (Status IS NULL OR Status = '')
         AND (emolumentform IS NULL OR emolumentform != 'Yes')`,
      [LEGACY_STATUS.SUBMITTED, formNumber, formYear, serviceNo],
    );
    if (!result.affectedRows) throw staleError("Form is no longer at the Not Filled stage.");
    return true;
  });
}

/**
 * Submitted → FO approved (DO stage bypassed, as in the old admin bulk approve).
 */
async function approveAsFo(serviceNo, formYear, admin, remarks) {
  return withTransaction(async (conn) => {
    const [[form]] = await conn.query(
      `SELECT id, status FROM ef_emolument_forms
       WHERE service_no = ? AND form_year = ?
         AND status IN ('SUBMITTED', 'DO_REVIEWED')
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [serviceNo, String(formYear)],
    );
    if (!form) throw staleError("No submitted form found for this cycle.");

    const [r1] = await conn.query(
      `UPDATE ef_personalinfos
       SET Status     = ?,
           fo_name    = ?,
           fo_rank    = ?,
           fo_svcno   = ?,
           fo_date    = NOW(),
           dateModify = NOW()
       WHERE serviceNumber = ?
         AND Status IN (${SUBMITTED_STATUS_SQL})
         AND (emolumentform IS NULL OR emolumentform != 'Yes')`,
      [LEGACY_STATUS.FO_APPROVED, admin.name, admin.rank, admin.svcNo, serviceNo],
    );
    if (!r1.affectedRows) throw staleError("Form is no longer at the Submitted stage.");

    await conn.query(
      `UPDATE ef_emolument_forms
       SET status = 'FO_APPROVED', updated_at = NOW()
       WHERE id = ?`,
      [form.id],
    );

    await insertApprovalTx(conn, {
      formId: form.id,
      action: FORM_STATUS.FO_APPROVED,
      fromStatus: form.status,
      toStatus: FORM_STATUS.FO_APPROVED,
      performedBy: admin.svcNo,
      remarks,
    });

    return { formId: form.id, fromStatus: form.status };
  });
}

/**
 * FO approved → Confirmed. Same writes as the CPO confirm
 * (cpo.repository.confirmFormWithHistory) without the command scope.
 * The year's history row is replaced rather than duplicated, so a form
 * that was confirmed, rejected and re-submitted can be confirmed again.
 */
async function confirmAsCpo(serviceNo, formId, formYear, admin, snapshot, remarks) {
  return withTransaction(async (conn) => {
    const [[form]] = await conn.query(
      `SELECT id, status FROM ef_emolument_forms WHERE id = ? FOR UPDATE`,
      [formId],
    );
    if (!form || form.status !== FORM_STATUS.FO_APPROVED)
      throw staleError("Form is no longer at the FO Approved stage.");

    const [r1] = await conn.query(
      `UPDATE ef_personalinfos
       SET \`Status\`      = ?,
           emolumentform = 'Yes',
           hod_svcno     = ?,
           hod_name      = ?,
           hod_rank      = ?,
           hod_date      = NOW(),
           dateconfirmed = NOW(),
           dateModify    = NOW()
       WHERE serviceNumber = ?
         AND \`Status\` IN (${FO_APPROVED_STATUS_SQL})
         AND (emolumentform IS NULL OR emolumentform != 'Yes')`,
      [LEGACY_STATUS.CPO_CONFIRMED, admin.svcNo, admin.name, admin.rank, serviceNo],
    );
    if (!r1.affectedRows) throw staleError("Form is no longer at the FO Approved stage.");

    await conn.query(
      `UPDATE ef_emolument_forms
       SET status = 'CPO_CONFIRMED', snapshot = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(snapshot), formId],
    );

    await conn.query(
      `DELETE FROM ef_personalinfoshist WHERE serviceNumber = ? AND FormYear = ?`,
      [serviceNo, formYear],
    );
    await conn.query(
      `INSERT INTO ef_personalinfoshist (
        FormYear,
        serviceNumber, Surname, OtherName, Title, \`Rank\`,
        payrollclass, classes, ship, command, branch,
        \`Status\`, formNumber, emolumentform,
        confirmedBy, dateconfirmed,
        div_off_name, div_off_rank, div_off_svcno, div_off_date,
        hod_name,     hod_rank,     hod_svcno,     hod_date,
        fo_name,      fo_rank,      fo_svcno,       fo_date,
        NIN, upload
      )
      SELECT
        ?,
        serviceNumber, Surname, OtherName, Title, \`Rank\`,
        payrollclass, classes, ship, command, branch,
        \`Status\`, formNumber, emolumentform,
        confirmedBy, dateconfirmed,
        div_off_name, div_off_rank, div_off_svcno, div_off_date,
        hod_name,     hod_rank,     hod_svcno,     hod_date,
        fo_name,      fo_rank,      fo_svcno,       fo_date,
        NIN, upload
      FROM ef_personalinfos
      WHERE serviceNumber = ?`,
      [formYear, serviceNo],
    );

    await insertApprovalTx(conn, {
      formId,
      action: FORM_STATUS.CPO_CONFIRMED,
      fromStatus: FORM_STATUS.FO_APPROVED,
      toStatus: FORM_STATUS.CPO_CONFIRMED,
      performedBy: admin.svcNo,
      remarks,
    });

    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// REJECT — any stage after submission
//
// Resets the personnel row so they can re-fill, marks the cycle's form row
// REJECTED, clears the approval trail and records the rejection — the same
// convention the DO/FO/CPO rejects follow. For a confirmed form the year's
// history row is removed too, since that confirmation no longer stands.
// ─────────────────────────────────────────────────────────────

async function rejectAnyStage(serviceNo, formYear, rejectedBy, remarks) {
  return withTransaction(async (conn) => {
    const [[person]] = await conn.query(
      `SELECT Status, emolumentform FROM ef_personalinfos
       WHERE serviceNumber = ? LIMIT 1 FOR UPDATE`,
      [serviceNo],
    );
    if (!person) throw staleError("Personnel record not found.");

    const status = String(person.Status ?? "").trim();
    if (!status && person.emolumentform !== "Yes")
      throw staleError("Form has not been submitted, so there is nothing to reject.");
    const wasConfirmed = person.emolumentform === "Yes";

    await conn.query(
      `UPDATE ef_personalinfos
       SET Status        = NULL,
           emolumentform = NULL,
           dateModify    = NOW()
       WHERE serviceNumber = ?`,
      [serviceNo],
    );

    let formId = null;
    if (formYear) {
      await conn.query(
        `UPDATE ef_emolument_forms
         SET status = 'REJECTED', updated_at = NOW()
         WHERE service_no = ? AND form_year = ?
           AND status NOT IN ('DRAFT', 'REJECTED')`,
        [serviceNo, String(formYear)],
      );

      const [[form]] = await conn.query(
        `SELECT id FROM ef_emolument_forms
         WHERE service_no = ? AND form_year = ?
         ORDER BY (status <> 'DRAFT') DESC, id DESC
         LIMIT 1`,
        [serviceNo, String(formYear)],
      );
      formId = form?.id ?? null;

      if (wasConfirmed) {
        await conn.query(
          `DELETE FROM ef_personalinfoshist WHERE serviceNumber = ? AND FormYear = ?`,
          [serviceNo, formYear],
        );
      }
    }

    if (formId) {
      await conn.query(`DELETE FROM ef_form_approvals WHERE form_id = ?`, [formId]);
      await conn.query(
        `INSERT INTO ef_form_rejections (form_id, service_number, rejected_by, remarks)
         VALUES (?, ?, ?, ?)`,
        [formId, serviceNo, rejectedBy, remarks || null],
      );
    }

    return { formId, previousStatus: person.Status ?? null, wasConfirmed };
  });
}

module.exports = {
  // settings
  getSetting,
  setSetting,
  // list
  splitSearchTerms,
  listForms,
  // lookups
  getPersonForReview,
  getFormRow,
  saveFormTables,
  updateFormRowPlacement,
  // stage moves
  markSubmittedByAdmin,
  approveAsFo,
  confirmAsCpo,
  rejectAnyStage,
};
