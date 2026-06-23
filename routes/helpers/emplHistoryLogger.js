// helpers/emplHistoryLogger.js
//
// ⚠️ ADJUST THIS PATH if your project structure differs — this assumes
// `helpers/` sits at the same level as `config/` and `middware/`.
const pool = require("../../config/db");

// =============================================================================
// py_emplhistory AUDIT LOGGER
// =============================================================================
// Monthly-snapshot history of hr_employees changes.
//
//   • period format: YYYYMMDDHHMM  (12 chars — fits varchar(15))
//   • One snapshot row is kept per employee PER CALENDAR MONTH.
//   • The FIRST update to an employee in a given month copies their
//     pre-update hr_employees row into py_emplhistory — this captures
//     "what the record looked like before this month's edits."
//   • Every SUBSEQUENT update that same month does NOT re-snapshot —
//     it just bumps that row's `period` to the latest edit timestamp,
//     leaving the original snapshot data untouched.
//   • If the Empl_ID has no existing hr_employees row (brand-new
//     personnel, or an unknown ID in a batch sheet), this is a no-op,
//     NOT an error — there's nothing to snapshot yet.
//
// MUST be called BEFORE the UPDATE to hr_employees runs, so the snapshot
// captures the true "before" state.
// =============================================================================

// Exact set of py_emplhistory columns that can be copied verbatim from a
// hr_employees row (period/dateadded are computed separately, not copied).
const EMPLHISTORY_COLUMNS = new Set([
  "Empl_ID",
  "Surname",
  "OtherName",
  "Title",
  "TITLEDESC",
  "Sex",
  "JobClass",
  "Jobtitle",
  "MaritalStatus",
  "Factory",
  "Location",
  "Birthdate",
  "DateEmpl",
  "DateLeft",
  "TELEPHONE",
  "HOMEADDR",
  "nok_name",
  "Bankcode",
  "bankbranch",
  "BankACNumber",
  "InternalACNo",
  "StateofOrigin",
  "LocalGovt",
  "TaxCode",
  "NSITFcode",
  "NHFcode",
  "seniorno",
  "command",
  "nok_addr",
  "Language1",
  "Fluency1",
  "Language2",
  "Fluency2",
  "Language3",
  "Fluency3",
  "Country",
  "Height",
  "Weight",
  "BloodGroup",
  "Genotype",
  "entry_mode",
  "Status",
  "datepmted",
  "dateconfirmed",
  "taxed",
  "gradelevel",
  "gradetype",
  "entitlement",
  "town",
  "createdby",
  "datecreated",
  "nok_relation",
  "specialisation",
  "accomm_type",
  "qual_allow",
  "sp_qual_allow",
  "rent_subsidy",
  "instruction_allow",
  "command_allow",
  "award",
  "payrollclass",
  "email",
  "pfacode",
  "state",
  "emolumentform",
  "exittype",
  "dateadded",
]);

// Known column-NAME differences between hr_employees and py_emplhistory.
// hr_employees field → py_emplhistory field
//
// ⚠️ FLAGGED ASSUMPTION: `gsm_number` → `TELEPHONE` is inferred from naming
// convention, not confirmed against your actual hr_employees schema. If
// that's wrong (or hr_employees has no phone-equivalent column at all),
// remove that line below — TELEPHONE will just stay NULL in history rows.
const EMPLHISTORY_FIELD_ALIASES = {
  Titledesc: "TITLEDESC",
  // gsm_number: "TELEPHONE",
};

function getCurrentPeriodParts() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return {
    yyyymm: `${y}${m}`, // for the "is there a row this month?" match
    period: `${y}${m}${d}${h}${min}`, // full YYYYMMDDHHMM value to write
  };
}

/**
 * Log a snapshot/timestamp-bump into py_emplhistory for the given Empl_ID.
 * MUST be called before the corresponding hr_employees UPDATE.
 *
 * @param {string} emplId
 * @returns {Promise<{logged: boolean, action?: 'snapshotted'|'bumped', period?: string, reason?: string}>}
 */
async function logEmployeeHistory(emplId) {
  // 1. Fetch the CURRENT (pre-update) row — this is the snapshot data.
  const [rows] = await pool.query(
    "SELECT * FROM hr_employees WHERE Empl_ID = ? LIMIT 1",
    [emplId],
  );

  if (!rows || rows.length === 0) {
    // No existing record — brand-new employee, or an unknown Empl_ID in a
    // batch sheet. Nothing to snapshot. NOT an error.
    return { logged: false, reason: "no_existing_record" };
  }

  const currentRow = rows[0];
  const { yyyymm, period } = getCurrentPeriodParts();

  // 2. Does a history row already exist for THIS employee, THIS month?
  const [existing] = await pool.query(
    `SELECT period FROM py_emplhistory
     WHERE Empl_ID = ? AND period LIKE ?
     ORDER BY period DESC LIMIT 1`,
    [emplId, `${yyyymm}%`],
  );

  if (existing.length > 0) {
    // Already snapshotted this month — just bump the timestamp forward.
    await pool.query(
      `UPDATE py_emplhistory SET period = ? WHERE Empl_ID = ? AND period = ?`,
      [period, emplId, existing[0].period],
    );
    console.log(
      `📜 [emplHistory] Bumped period → ${period} for ${emplId} (already snapshotted this month)`,
    );
    return { logged: true, action: "bumped", period };
  }

  // 3. First edit this month — copy the pre-update row into history.
  const insertData = {
    period,
    // dateadded: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  for (const [field, value] of Object.entries(currentRow)) {
    const targetField = EMPLHISTORY_FIELD_ALIASES[field] || field;
    if (EMPLHISTORY_COLUMNS.has(targetField) && value !== undefined) {
      insertData[targetField] = value;
    }
  }

  const fields = Object.keys(insertData);
  const values = Object.values(insertData);
  const placeholders = fields.map(() => "?").join(", ");

  await pool.query(
    `INSERT INTO py_emplhistory (${fields.map((f) => `\`${f}\``).join(", ")}) VALUES (${placeholders})`,
    values,
  );

  console.log(
    `📜 [emplHistory] Snapshotted ${emplId} → period ${period} (first edit this month)`,
  );
  return { logged: true, action: "snapshotted", period };
}

module.exports = { logEmployeeHistory };
