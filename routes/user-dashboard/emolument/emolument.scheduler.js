/**
 * FILE: routes/user-dashboard/emolument/emolument.scheduler.js
 *
 * Scheduled job that keeps ef_ships.openship in sync with the
 * live state of ef_control every minute.
 *
 * Logic:
 *   1. Find all ef_control rows where NOW() is within the date window
 *      (startdate <= NOW() <= enddate) and status IN ('Open','Reopen').
 *      These are the currently active open windows.
 *
 *   2. For each such row:
 *      - ship = 'All'  → set ALL ef_ships.openship = 1
 *      - ship = <name> → set that specific ship's openship = 1
 *
 *   3. Any ship NOT covered by an active open window gets openship = 0.
 *
 * Mount in your app entry point:
 *   require('./routes/user-dashboard/emolument/emolument.scheduler');
 *
 * Requires: node-cron  (npm install node-cron)
 */

"use strict";

const cron = require("node-cron");
const crypto = require("crypto");
const { run } = require("../../../config/sql/scripts/py_ef_banks_migration");

// ─────────────────────────────────────────────────────────────
// SESSION ISOLATION FOR BACKGROUND JOBS
//
// config/db.js keeps a global sessionDatabases Map keyed by session id,
// with useDatabase() writing to it and a later query()/execute() call
// reading it back via AsyncLocalStorage. Any code path that never runs
// inside sessionContext.run() falls back to the shared "default" key —
// which middware/authentication.js's pre-login token check also uses.
//
// This scheduler used to call pool.useDatabase()/pool.query() straight
// from cron callbacks with no session context at all, so every tick
// wrote into that same "default" bucket. A concurrent request hitting
// "default" (or the next tick firing) could flip the target database
// out from under an in-flight query on this or the other side.
//
// Fix: give every tick/startup run its own unique AsyncLocalStorage
// scope, so scheduler DB-context writes can never collide with request
// traffic or with each other. Do NOT remove this — see project memory
// on the ships-sync DB race (2026-07-23).
// ─────────────────────────────────────────────────────────────
async function runInSchedulerContext(pool, fn) {
  const sessionContext = pool._getSessionContext
    ? pool._getSessionContext()
    : null;
  const jobSessionId = `scheduler:${crypto.randomUUID()}`;

  if (sessionContext) {
    return sessionContext.run(jobSessionId, fn);
  }
  return fn();
}

// Pool initialises asynchronously — we must not call pool.useDatabase()
// until the async IIFE in db.js has completed and dbConfig is set.
// We wait by polling pool.getAvailableDatabases() until it returns entries.
async function waitForPool(pool, retries = 30, intervalMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const dbs = pool.getAvailableDatabases();
      if (dbs && dbs.length > 0) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Pool did not become ready within the expected time.");
}

// Resolve DB name the same way all repositories do —
// process.env.MYSQL_DB_OFFICERS is always set in this project.
function getDB() {
  if (process.env.MYSQL_DB_OFFICERS) return process.env.MYSQL_DB_OFFICERS;
  if (process.env.DB_OFFICERS) return process.env.DB_OFFICERS;
  // Last resort: ask pool directly
  try {
    const pool = require("../../../config/db");
    const dbs = pool.getAvailableDatabases();
    return dbs[0] || null;
  } catch {
    return null;
  }
}

// Close any ef_control windows that have expired (enddate < NOW()) but are still marked Open/Reopen.
async function closeExpiredWindows() {
  const pool = require("../../../config/db");
  const DB = getDB();
  if (!DB) throw new Error("Cannot resolve database name.");

  pool.useDatabase(DB);

  const [result] = await pool.query(
    `UPDATE ef_control
     SET status = 'Close'
     WHERE enddate < NOW()
       AND status IN ('Open', 'Reopen')`,
  );

  if (result.affectedRows > 0) {
    console.log(
      `🔒 Closed ${result.affectedRows} expired ef_control window(s).`,
    );
  }
}

function isDateLeftExpired(dateLeft) {
  if (!dateLeft) return false;

  // datetime: "2024-01-15T00:00:00.000Z" or "2024-01-15 00:00:00"
  // string:   "20240115"
  const isDatetimeFormat = dateLeft.includes("-") || dateLeft.includes("T");

  if (isDatetimeFormat) {
    return new Date(dateLeft) <= new Date();
  }

  // YYYYMMDD string comparison
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return dateLeft <= today;
}

// Archive the CURRENT-cycle emolument form(s) belonging to the given
// serviceNumbers before we delete their ef_personalinfos rows.
//
// This is distinct from archivePreviousCycleIfNeeded(): that function only
// snapshots rows once a *new* cycle has started (form_year != currentYear).
// A person can leave mid-cycle — before the cycle ever rolls over — and in
// that case their current-year ef_emolument_forms row would never get a
// snapshot and would be lost once ef_personalinfos is deleted. This function
// snapshots it unconditionally (any form_year, as long as it isn't already
// archived) so their final cycle's data survives the personnel removal.
async function archiveExpiredPersonnelForms(pool, ids) {
  if (!ids.length) return;

  const placeholders = ids.map(() => "?").join(",");

  const [result] = await pool.query(
    `UPDATE ef_emolument_forms f
     INNER JOIN ef_personalinfos p ON p.serviceNumber = f.service_no
     SET f.snapshot   = COALESCE(f.snapshot, JSON_OBJECT(
                          'archived', true,
                          'archivedAt', NOW(),
                          'previousYear', f.form_year,
                          'previousStatus', p.Status,
                          'wasConfirmed', IF(p.emolumentform = 'Yes', true, false),
                          'reason', 'personnel_exit'
                        )),
         f.updated_at = NOW()
     WHERE f.service_no IN (${placeholders})
       AND f.snapshot   IS NULL`,
    [...ids.map(String)],
  );

  if (result.affectedRows > 0) {
    console.log(
      `📦 Archived ${result.affectedRows} current-cycle emolument form(s) for exiting personnel.`,
    );
  }
}

// Close any ef_control windows that have expired (enddate < NOW()) but are still marked Open/Reopen.
async function removeExpiredPersonnel() {
  const pool = require("../../../config/db");
  const DB = getDB();
  if (!DB) throw new Error("Cannot resolve database name.");

  pool.useDatabase(DB);

  const [result] = await pool.query(
    `
    SELECT Empl_ID, DateLeft, exittype
    FROM hr_employees
    WHERE (
            DateLeft IS NOT NULL
            AND DateLeft <> ''
          )
      OR (
            exittype IS NOT NULL
            AND TRIM(exittype) <> ''
          );
    `,
  );

  if (result.length <= 0) {
    console.log(`🔒 No expired personnel.`);
    return;
  }

  const expired = result.filter(
    (r) => r.exittype != null || isDateLeftExpired(r.DateLeft),
  );

  if (expired.length === 0) {
    console.log("🔒 No expired personnel.");
    return;
  }

  const ids = expired.map((r) => r.Empl_ID);

  const placeholders = ids.map(() => "?").join(",");

  // Archive their current-cycle emolument form BEFORE deleting
  // ef_personalinfos, so this cycle's data isn't lost even though
  // the cycle itself hasn't turned over yet.
  await archiveExpiredPersonnelForms(pool, ids);

  //Delete statement

  await pool.query(`SET FOREIGN_KEY_CHECKS = 0`);
  await pool.query(
    `
    DELETE FROM ef_personalinfos
    WHERE serviceNumber in (${placeholders})
    `,
    [...ids.map(String)],
  );
  await pool.query(`SET FOREIGN_KEY_CHECKS = 1`);

  console.log(`🗑️ ${ids.length} employee(s) removed from emolument.`);
}

let syncFailures = 0;
const MAX_SYNC_FAILURES = 5;
async function syncOpenship() {
  const pool = require("../../../config/db");
  const DB = getDB();
  try {
    pool.useDatabase(DB);

    // 1. Get all currently active open windows
    const [activeRows] = await pool.query(
      `SELECT ship, formtype, status
       FROM ef_control
       WHERE NOW() BETWEEN startdate AND enddate
         AND status IN ('Open', 'Reopen')`,
    );

    const isAnyOpen = activeRows.length > 0;
    const hasGlobal = activeRows.some((r) => r.ship === "All" || !r.ship);
    const openShipNames = new Set(
      activeRows.filter((r) => r.ship && r.ship !== "All").map((r) => r.ship),
    );

    // 2. Sync ef_ships.openship
    if (hasGlobal) {
      await pool.query(`UPDATE ef_ships SET openship = 1`);
    } else if (openShipNames.size > 0) {
      await pool.query(`UPDATE ef_ships SET openship = 0`);
      const placeholders = [...openShipNames].map(() => "?").join(",");
      await pool.query(
        `UPDATE ef_ships SET openship = 1 WHERE shipName IN (${placeholders})`,
        [...openShipNames],
      );
    } else {
      await pool.query(`UPDATE ef_ships SET openship = 0`);
    }

    // 3. ef_systeminfos.SiteStatus is no longer used as a gate —
    //    checkFormEligibility now reads ef_control directly.
    //    No SiteStatus update needed here.
    syncFailures = 0; // reset failure count on success
    console.log(
      `🔄 Synced ef_ships.openship with ${activeRows.length} active window(s).`,
    );
  } catch (err) {
    syncFailures++;
    console.error(
      `❌ syncOpenship error (${syncFailures}/${MAX_SYNC_FAILURES}):`,
      err.message,
    );
    if (syncFailures >= MAX_SYNC_FAILURES) {
      console.error(
        "🚨 syncOpenship has failed repeatedly — investigate immediately.",
      );
      // optionally: process.exit(1) or emit an alert
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// AUTO-ARCHIVE PREVIOUS CYCLE ON STARTUP
//
// Every person fills the form every year. On a new cycle:
//
// 1. Snapshot ALL ef_emolument_forms rows from the previous year
//    where snapshot is null — preserves history for everyone
//    regardless of confirmation status.
//
// 2. Reset ALL ef_personalinfos cycle fields:
//    Status = NULL, formNumber = NULL, FormYear = NULL,
//    emolumentform = NULL  ← clears the re-fill gate.
//    hr_employees.emolumentform stays 'Yes' as the permanent
//    payroll sync record — not touched here.
//
// 3. Reset ef_control form number counters to 1 so the new
//    cycle starts with fresh sequential form numbers.
// ─────────────────────────────────────────────────────────────
async function archivePreviousCycleIfNeeded() {
  const pool = require("../../../config/db");
  const DB = getDB();
  if (!DB)
    throw new Error(
      "Cannot resolve database name — check MYSQL_DB_OFFICERS env var.",
    );
  try {
    pool.useDatabase(DB);

    const [yearRows] = await pool.smartQuery(
      `SELECT processingyear FROM ef_control
       WHERE status IN ('Open','Reopen')
       ORDER BY processingyear DESC LIMIT 1`,
    );

    if (!yearRows.length) return;

    const currentYear = String(yearRows[0].processingyear);

    // All personnel whose FormYear is from a previous cycle
    const [staleRows] = await pool.query(
      `SELECT serviceNumber, FormYear FROM ef_personalinfos
       WHERE FormYear IS NOT NULL
         AND FormYear != ?`,
      [currentYear],
    );

    if (!staleRows.length) return;

    // Fix: collect all distinct previous years
    const prevYears = [...new Set(staleRows.map((r) => String(r.FormYear)))];

    // Log them all
    console.log(
      `📦 New cycle → ${currentYear}. Previous years found: ${prevYears.join(", ")}`,
    );

    // Step 1: Snapshot ALL ef_emolument_forms from previous year (no snapshot yet)
    const placeholders = prevYears.map(() => "?").join(",");
    await pool.query(
      `UPDATE ef_emolument_forms f
       INNER JOIN ef_personalinfos p ON p.serviceNumber = f.service_no
       SET f.snapshot   = COALESCE(f.snapshot, JSON_OBJECT(
                            'archived', true,
                            'archivedAt', NOW(),
                            'previousYear', f.form_year,
                            'previousStatus', p.Status,
                            'wasConfirmed', IF(p.emolumentform = 'Yes', true, false)
                          )),
           f.updated_at = NOW()
       WHERE f.form_year IN (${placeholders})
         AND f.snapshot  IS NULL`,
      [...prevYears],
    );

    // Step 2: Reset ALL ef_personalinfos cycle fields for everyone
    await pool.query(
      `UPDATE ef_personalinfos
       SET Status        = NULL,
           formNumber    = NULL,
           FormYear      = NULL,
           emolumentform = NULL,
           fo_date = NULL,
           fo_name = NULL,
           fo_rank = NULL,
           fo_svcno = NULL,
           cdr_date = NULL,
           cdr_name = NULL,
           cdr_rank = NULL,
           cdr_svcno = NULL,
           hod_date = NULL,
           hod_name = NULL,
           hod_rank = NULL,
           hod_svcno = NULL,
           div_off_date = NULL,
           div_off_name = NULL,
           div_off_rank = NULL,
           div_off_svcno = NULL,
           dateModify    = NOW()`,
    );

    // Step 3: Reset form number counters for the new cycle
    await pool.query(
      `UPDATE ef_control
       SET OfficersFormNo = 1,
           RatingsFormNo  = 1,
           TrainingFormNo = 1`,
    );

    console.log(
      `✅ Archive complete. ${staleRows.length} records reset for cycle ${currentYear}.`,
    );
  } catch (err) {
    console.error(
      "❌ emolument.scheduler archivePreviousCycleIfNeeded error:",
      err.message,
    );
  }
}

// Run every minute
cron.schedule("* * * * *", async () => {
  const pool = require("../../../config/db");
  await runInSchedulerContext(pool, async () => {
    await closeExpiredWindows();
    await syncOpenship();
    await archivePreviousCycleIfNeeded();
  });
});

// Run everyday
cron.schedule("0 0 * * *", async () => {
  const pool = require("../../../config/db");
  await runInSchedulerContext(pool, async () => {
    await archivePreviousCycleIfNeeded();
    await removeExpiredPersonnel();
    await run();
  });
});

// On startup: wait for pool to be ready, then sync + archive
(async () => {
  try {
    const pool = require("../../../config/db");
    await waitForPool(pool);
    await runInSchedulerContext(pool, async () => {
      await closeExpiredWindows();
      await syncOpenship();
      await archivePreviousCycleIfNeeded();
      await removeExpiredPersonnel();
    });
  } catch (err) {
    console.error("❌ emolument.scheduler startup error:", err.message);
  }
})();

console.log("✅ Emolument scheduler started — syncing openship every minute.");

module.exports = { syncOpenship, archivePreviousCycleIfNeeded };
