// ============================================================
// Payslip Sync — Go live, withdraw, roll back
// services/sync/golive.service.js
//
// Go live: one RENAME TABLE swaps py_masterpayded, py_mastercum and
// py_stdrate (shared manifest goliveTables) for every prepared database
// at once. Each database's tables move together, so its staff never see
// the old month with new numbers.
//
// Roll back (only the latest run): swap live ↔ __prev through __rb in one
// statement, then restore __undo snapshots. The last applied seq steps
// back; the officer runs --discard-last before the next export.
// ============================================================

const db = require("./db");
const run = require("./run.service");
const merge = require("./merge.service");
const publications = require("./publication.service");
const uploadSvc = require("./upload.service");
const { SUFFIX } = require("./staging.service");
const { SyncError } = require("./package.service");

/** The newest run that changed live data (prepared or live), or null. */
async function latestEffectiveRun() {
  const [rows] = await db.query(
    `SELECT id FROM ${db.ctl("sync_runs")}
     WHERE status IN ('prepared', 'live', 'partly_rolled_back')
     ORDER BY id DESC LIMIT 1`,
  );
  return rows.length ? run.getRun(rows[0].id) : null;
}

/**
 * Go live for a period: every prepared database of the latest prepared
 * run for that period, in one RENAME TABLE. A withdrawn period whose data
 * is already live is simply published again.
 */
async function goLive({ period, by }) {
  if (!/^\d{6}$/.test(String(period || ""))) throw new SyncError("bad-request", "Give the period as YYYYMM.");
  return run.withLock(async () => {
    const [rows] = await db.query(
      `SELECT r.id FROM ${db.ctl("sync_runs")} r JOIN ${db.ctl("sync_packages")} p ON p.id = r.package_id
       WHERE r.status = 'prepared' AND p.period = ? ORDER BY r.id DESC LIMIT 1`,
      [period],
    );

    if (!rows.length) {
      // Re-publish a withdrawn period (data already live).
      const [w] = await db.query(
        `SELECT database_name FROM ${db.ctl("sync_publications")} WHERE period = ? AND status = 'withdrawn'`,
        [period],
      );
      if (!w.length) throw new SyncError("nothing-prepared", `No prepared or withdrawn month for ${period}.`, 409);
      for (const r of w) await publications.setStatus(r.database_name, period, "published", by);
      return { period, republished: w.map((r) => r.database_name), swapped: [] };
    }

    const r = await run.getRun(rows[0].id);
    const newer = await latestEffectiveRun();
    if (newer && newer.id !== r.id) {
      throw new SyncError("stale-run", "A newer package has been applied since this one was prepared.", 409);
    }
    const summary = r.summary;
    const tables = (summary.goliveTables || []).filter(Boolean);
    for (const t of tables) {
      if (!(await db.tableExists(t.schema, t.table + SUFFIX.stage))) {
        throw new SyncError("stage-missing", `${t.schema}.${t.table}${SUFFIX.stage} is missing; upload the package again.`, 409);
      }
    }

    const t0 = Date.now();
    await merge.swapNow(tables.map((t) => ({ ...t, stage: t.table + SUFFIX.stage })));
    const ms = Date.now() - t0;

    summary.steps = (summary.steps || []).concat(
      tables.map((t) => ({ kind: "swap", dbKey: t.dbKey, schema: t.schema, table: t.table, at: "golive" })),
    );
    summary.timings = { ...(summary.timings || {}), golive: ms };
    const dbs = [...new Set(Object.keys(summary.totals || {}).concat(tables.map((t) => t.dbKey)))];
    for (const d of dbs) await publications.setStatus(d, period, "published", by);
    await db.query(
      `UPDATE ${db.ctl("sync_runs")} SET status = 'live', stage = 'published', live_at = NOW(), summary = ? WHERE id = ?`,
      [JSON.stringify(summary), r.id],
    );
    await uploadSvc.removeFile(r.package_id).catch(() => {});
    return { period, runUuid: r.run_uuid, databases: dbs, swapped: tables.length, ms };
  });
}

/** Hide a period from staff until it is published again. */
async function withdraw({ dbKey, period, by }) {
  db.schemaFor(dbKey);
  const p = await publications.get(dbKey, period);
  if (!p) throw new SyncError("not-found", `No publication for ${dbKey} ${period}.`, 404);
  if (p.status !== "published") throw new SyncError("bad-request", `${dbKey} ${period} is ${p.status}, not published.`, 409);
  await publications.setStatus(dbKey, period, "withdrawn", by);
  return { dbKey, period, status: "withdrawn" };
}

/**
 * Roll back one database of the latest run (prepared or live) for a period.
 * Swap tables go back to their __prev copies; merged and replaced rows
 * are restored from __undo.
 */
async function rollback({ dbKey, period, by }) {
  db.schemaFor(dbKey);
  return run.withLock(async () => {
    const r = await latestEffectiveRun();
    if (!r || String(r.period) !== String(period)) {
      throw new SyncError("not-latest", "Only the latest applied package can be rolled back.", 409);
    }
    const summary = r.summary;
    summary.rolledBack = summary.rolledBack || {};
    if (summary.rolledBack[dbKey]) throw new SyncError("bad-request", `${dbKey} is already rolled back.`, 409);
    const dbs = [...new Set((summary.steps || []).map((s) => s.dbKey).concat(Object.keys(summary.totals || {})))];
    if (!dbs.includes(dbKey)) throw new SyncError("not-found", `${dbKey} was not in this package.`, 404);

    // A prepared (not live) run: Go live tables are still in __stage; drop them.
    if (r.status === "prepared") {
      for (const t of (summary.goliveTables || []).filter((t) => t.dbKey === dbKey)) {
        await db.query(`DROP TABLE IF EXISTS ${db.qt(t.schema, t.table + SUFFIX.stage)}`);
      }
    }
    await run.undoApplied(summary.steps || [], { dbKey });

    summary.rolledBack[dbKey] = { by, at: new Date().toISOString() };
    const all = dbs.every((d) => summary.rolledBack[d]);
    const pub = await publications.get(dbKey, period);
    if (pub) await publications.setStatus(dbKey, period, "rolled_back", by);

    await db.query(
      `UPDATE ${db.ctl("sync_runs")} SET status = ?, stage = ?, summary = ? WHERE id = ?`,
      [all ? "rolled_back" : "partly_rolled_back", `rolled back: ${Object.keys(summary.rolledBack).join(", ")}`, JSON.stringify(summary), r.id],
    );
    // The sequence steps back: this package no longer counts as applied.
    await db.query(
      `UPDATE ${db.ctl("sync_packages")} SET status = 'rolled_back', rolled_back_at = NOW() WHERE id = ?`,
      [r.package_id],
    );
    return {
      dbKey,
      period,
      runStatus: all ? "rolled_back" : "partly_rolled_back",
      remaining: dbs.filter((d) => !summary.rolledBack[d]),
      instruction:
        "Inside the payroll network, run navy-sync-exporter --discard-last before the next export.",
    };
  });
}

module.exports = { goLive, withdraw, rollback, latestEffectiveRun };
