// ============================================================
// Payslip Sync — processing one uploaded package (a "run")
// services/sync/run.service.js
//
// received → verifying → loading → validating → prepared   (→ live at Go live)
//                                                failed from any step
//
// verify  signature, payload hash, sequence (shared library)
// load    stream decrypted batches into <table>__stage
// validate counts and checksums against the manifest  ← nothing live changed yet
// apply   swap-at-prepare tables, merge-columns and replace-scope (with undo)
// Go live tables stay in __stage until golive.service switches them.
// ============================================================

const crypto = require("crypto");
const db = require("./db");
const shared = require("./shared");
const pkgSvc = require("./package.service");
const uploadSvc = require("./upload.service");
const staging = require("./staging.service");
const loader = require("./loader.service");
const merge = require("./merge.service");
const validator = require("./validate.service");
const publications = require("./publication.service");
const { SyncError } = pkgSvc;

const LOCK_NAME = "navy_payslip_sync";
const active = new Map(); // runId → promise (this process)

// ── lock: one run / Go live / roll back at a time ──────────

async function withLock(fn) {
  const conn = await db.getConnection();
  try {
    const [[r]] = await conn.query("SELECT GET_LOCK(?, 5) AS got", [LOCK_NAME]);
    if (Number(r.got) !== 1) {
      throw new SyncError("busy", "Another sync step is running. Try again when it finishes.", 409);
    }
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

// ── run rows ───────────────────────────────────────────────

function parseSummary(s) {
  if (!s) return {};
  if (typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch (_) {
    return {};
  }
}

async function getRun(idOrUuid) {
  const byUuid = typeof idOrUuid === "string" && idOrUuid.includes("-");
  const [rows] = await db.query(
    `SELECT r.*, p.fingerprint, p.seq, p.base_seq, p.kind, p.period, p.exporter_id, p.bytes,
            p.uploaded_by, p.upload_started_at, p.upload_finished_at, p.status AS package_status,
            p.reject_reason, p.header_json
     FROM ${db.ctl("sync_runs")} r JOIN ${db.ctl("sync_packages")} p ON p.id = r.package_id
     WHERE ${byUuid ? "r.run_uuid" : "r.id"} = ?`,
    [idOrUuid],
  );
  if (!rows.length) return null;
  const r = rows[0];
  r.summary = parseSummary(r.summary);
  return r;
}

async function listRuns({ limit = 50 } = {}) {
  const [rows] = await db.query(
    `SELECT r.id, r.run_uuid, r.status, r.stage, r.started_at, r.finished_at, r.live_at,
            r.error, r.error_code, r.summary, r.started_by,
            p.fingerprint, p.seq, p.base_seq, p.kind, p.period, p.bytes, p.uploaded_by,
            p.status AS package_status
     FROM ${db.ctl("sync_runs")} r JOIN ${db.ctl("sync_packages")} p ON p.id = r.package_id
     ORDER BY r.id DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 50))}`,
  );
  return rows.map((r) => {
    const s = parseSummary(r.summary);
    return {
      ...r,
      summary: undefined,
      rows: s.totalRows || null,
      timings: s.timings || {},
      machineMs: machineMs(s.timings || {}),
      totals: s.totals || null,
      approval: s.approval || null,
    };
  });
}

/** Export + upload + verify + load + apply + validate + golive. */
function machineMs(t) {
  return ["export", "upload", "verify", "load", "apply", "validate", "golive"].reduce(
    (a, k) => a + (Number(t[k]) || 0),
    0,
  );
}

async function setStatus(runId, status, stage = null, extra = {}) {
  const sets = ["status = ?", "stage = ?"];
  const params = [status, stage];
  if (extra.summary !== undefined) {
    sets.push("summary = ?");
    params.push(JSON.stringify(extra.summary));
  }
  if (extra.error !== undefined) {
    sets.push("error = ?", "error_code = ?");
    params.push(extra.error, extra.errorCode || null);
  }
  if (extra.finished) sets.push("finished_at = NOW()");
  params.push(runId);
  await db.query(`UPDATE ${db.ctl("sync_runs")} SET ${sets.join(", ")} WHERE id = ?`, params);
}

async function saveSummary(runId, summary) {
  await db.query(`UPDATE ${db.ctl("sync_runs")} SET summary = ? WHERE id = ?`, [
    JSON.stringify(summary),
    runId,
  ]);
}

// ── start ──────────────────────────────────────────────────

/**
 * Create a run for a received package and process it in the background.
 * Returns { runId, runUuid }.
 */
async function startRun(packageId, by) {
  const uuid = crypto.randomUUID();
  const [r] = await db.query(
    `INSERT INTO ${db.ctl("sync_runs")} (run_uuid, package_id, status, started_at, started_by, summary)
     VALUES (?, ?, 'received', NOW(), ?, ?)`,
    [uuid, packageId, by, JSON.stringify({ timings: {} })],
  );
  const runId = r.insertId;
  const p = processRun(runId).catch((e) => console.error("❌ sync run crashed:", e));
  active.set(runId, p);
  p.finally(() => active.delete(runId));
  return { runId, runUuid: uuid };
}

/**
 * Check only: verify, decrypt and compare everything, load nothing.
 * Run statuses: checking → checked | check_failed. The package stays "received",
 * so "Load and prepare" (reprocess) can follow.
 */
async function startCheck(packageId, by) {
  const uuid = crypto.randomUUID();
  const [r] = await db.query(
    `INSERT INTO ${db.ctl("sync_runs")} (run_uuid, package_id, status, stage, started_at, started_by, summary)
     VALUES (?, ?, 'checking', 'check only, nothing is loaded', NOW(), ?, ?)`,
    [uuid, packageId, by, JSON.stringify({ checkOnly: true, timings: {} })],
  );
  const runId = r.insertId;
  const p = (async () => {
    const [[pkg]] = await db.query(`SELECT * FROM ${db.ctl("sync_packages")} WHERE id = ?`, [packageId]);
    const t0 = Date.now();
    try {
      const report = await require("./inspect.service").checkPackageFile(pkg.file_path);
      const summary = { checkOnly: true, check: report, timings: { verify: Date.now() - t0 }, totals: report.totals };
      await setStatus(runId, report.ok ? "checked" : "check_failed", report.ok ? "ready to load" : "problems found", {
        summary,
        finished: true,
        error: report.ok ? null : report.items.filter((i) => i.status === "fail").map((i) => `${i.label}: ${i.detail}`).join(" | "),
        errorCode: report.ok ? null : "check-failed",
      });
    } catch (e) {
      const err = pkgSvc.fromLibError(e);
      await setStatus(runId, "check_failed", err.code, { summary: { checkOnly: true }, error: err.message, errorCode: err.code, finished: true });
      const refusal = ["bad-signature", "payload-hash-mismatch", "exporter-key-changed", "decrypt-failed", "bad-magic", "bad-header", "truncated", "not-applicable"];
      if (refusal.includes(err.code)) await uploadSvc.reject(packageId, err).catch(() => {});
    }
  })().catch((e) => console.error("❌ sync check crashed:", e));
  active.set(runId, p);
  p.finally(() => active.delete(runId));
  return { runId, runUuid: uuid };
}

/** Wait for a background run (tests, CLI). */
async function waitFor(runId) {
  const p = active.get(runId);
  if (p) await p;
  return getRun(runId);
}

/** Runs left mid-way by a restart can never finish: mark them failed. */
async function recoverInterruptedRuns() {
  try {
    const [r] = await db.query(
      `UPDATE ${db.ctl("sync_runs")}
       SET status = 'failed', error = 'The server restarted during processing. Nothing staff can see was changed by the unfinished step; reprocess the package.',
           error_code = 'interrupted', finished_at = NOW()
       WHERE status IN ('verifying', 'loading', 'validating', 'checking')`,
    );
    return r.affectedRows;
  } catch (_) {
    return 0;
  }
}

// ── the pipeline ───────────────────────────────────────────

async function processRun(runId) {
  // Which database each payroll class is in: py_payrollclass as it is now.
  await db.refreshClasses({ force: true });
  const run = await getRun(runId);
  const summary = run.summary || {};
  summary.timings = summary.timings || {};
  const T = summary.timings;
  const [[pkg]] = await db.query(`SELECT * FROM ${db.ctl("sync_packages")} WHERE id = ?`, [run.package_id]);
  if (pkg.upload_started_at && pkg.upload_finished_at) {
    T.upload = Math.max(0, new Date(pkg.upload_finished_at) - new Date(pkg.upload_started_at));
  }

  const stages = new Map();
  const appliedSteps = []; // filled as Prepare changes live tables
  try {
    await withLock(async () => {
      // ── verify ──
      await setStatus(runId, "verifying", "signature and sequence", { summary });
      let t0 = Date.now();
      const v = await pkgSvc.verifyFile(pkg.file_path);
      if (v.needsApproval) {
        summary.approval = { ...v.info, publicKeyPem: undefined };
        summary.approvalKeyPem = v.info.publicKeyPem;
        await setStatus(runId, "received", "awaiting exporter approval", {
          summary,
          error: `New exporter ${v.info.exporterId}, key id ${v.info.keyIdFormatted}. A super admin must approve it.`,
          errorCode: "unknown-exporter",
        });
        throw Object.assign(new Error("awaiting approval"), { _stop: true });
      }
      const header = v.header;
      await pkgSvc.checkSequence(header);
      T.verify = Date.now() - t0;

      // ── load ──
      await setStatus(runId, "loading", "stage tables", { summary });
      t0 = Date.now();
      let manifest = null;
      let totalRows = 0;
      let lastSave = Date.now();
      for await (const rec of pkgSvc.readRecords(pkg.file_path, header, v.payloadOffset)) {
        if (rec.type === "batch") {
          const b = rec.batch;
          if (!header.databases || !header.databases.includes(b.database)) {
            throw new SyncError("bad-record", `Batch for ${b.database}, which the header does not list.`);
          }
          const key = `${b.database}/${String(b.table).toLowerCase()}`;
          let st = stages.get(key);
          if (!st) {
            st = await staging.createStage({ dbKey: b.database, batch: b, kind: header.kind });
            stages.set(key, st);
          }
          // one part per manifest entry (database + table + scope)
          const part = await staging.ensurePart(st, b);
          const tb = Date.now();
          const n = st.skip ? b.rows.length : await loader.insertBatch(st, b, part);
          st.loadMs += Date.now() - tb;
          st.rows += n;
          st.batches += 1;
          part.rows += n;
          part.batches.push({ batchNo: Number(b.batchNo), checksum: b.checksum });
          totalRows += n;
          if (Date.now() - lastSave > 3000) {
            lastSave = Date.now();
            await setStatus(runId, "loading", `${b.database}.${b.table} batch ${b.batchNo} · ${totalRows} rows`);
          }
        } else if (rec.type === "manifest") {
          manifest = rec.manifest;
        }
      }
      if (!manifest) throw new SyncError("missing-end", pkgSvc.messageFor("missing-end"));
      for (const st of stages.values()) await staging.finishStage(st);
      T.load = Date.now() - t0;
      if (manifest.timings && manifest.timings.exportMs != null) T.export = Number(manifest.timings.exportMs);
      summary.totalRows = totalRows;

      // ── validate ──
      await setStatus(runId, "validating", "counts and checksums", { summary });
      t0 = Date.now();
      summary.checks = await validator.validate(manifest, stages, header);
      summary.totals = Object.fromEntries(
        Object.entries(manifest.databases).map(([k, d]) => [k, d.totals || null]),
      );
      summary.notInPackage = await flagWebsiteOnlyStaff(stages);
      T.validate = Date.now() - t0;

      // ── apply (Prepare) ──
      await setStatus(runId, "validating", "applying", { summary });
      t0 = Date.now();
      await applyPrepare({ runId, header, stages, summary, steps: appliedSteps });
      T.apply = Date.now() - t0;

      // ── prepared ──
      const period = String(header.period || manifest.period || "");
      for (const dbKey of Object.keys(manifest.databases)) {
        const totals = manifest.databases[dbKey].totals || {};
        await publications.markPrepared({
          dbKey,
          period,
          staffCount: totals.staffCount != null ? Number(totals.staffCount) : null,
          totalNet: totals.totalNet != null ? String(totals.totalNet) : null,
          packageId: pkg.id,
          runId,
        });
      }
      await db.query(
        `UPDATE ${db.ctl("sync_packages")} SET status = 'applied', applied_at = NOW(), reject_reason = NULL WHERE id = ?`,
        [pkg.id],
      );
      await setStatus(runId, "prepared", "ready for Go live", { summary, finished: true, error: null });
    });
  } catch (e) {
    if (e && e._stop) return;
    const err = pkgSvc.fromLibError(e);
    console.error(`❌ sync run ${runId} failed:`, err.code, err.message);
    // Undo anything this run already applied to live, then drop its stage tables.
    if (appliedSteps.length) {
      try {
        await undoApplied(appliedSteps);
      } catch (u) {
        console.error("❌ sync: undo after failure did not complete:", u.message);
        err.message += ` | Undo after failure failed: ${u.message}`;
      }
    }
    await staging.dropStages([...stages.values()]);
    summary.failures = err.failures || undefined;
    if (err.checks) summary.checks = err.checks;
    await setStatus(runId, "failed", err.code, {
      summary,
      error: err.message,
      errorCode: err.code,
      finished: true,
    }).catch(() => {});
    const refusal = ["bad-signature", "payload-hash-mismatch", "exporter-key-changed", "decrypt-failed",
      "sequence-gap", "sequence-old", "bad-magic", "bad-header", "truncated", "not-applicable"];
    if (refusal.includes(err.code)) await uploadSvc.reject(pkg.id, err).catch(() => {});
  }
}

/**
 * Every package carries hr_employees for all staff. Website rows whose key is
 * not in the package (renumbered on the website, removed in payroll, created
 * on the website) are flagged for review only — never deleted, because the
 * row holds the person's login data.
 * Returns { <db>: { count, sample: [ids] } } for databases with such rows.
 */
async function flagWebsiteOnlyStaff(stages) {
  const out = {};
  for (const st of stages.values()) {
    if (st.table.toLowerCase() !== "hr_employees" || !st.rows) continue;
    const on = st.key.map((k) => `s.${db.q(k)} = t.${db.q(k)}`).join(" AND ");
    const from = `FROM ${db.qt(st.schema, st.table)} t LEFT JOIN ${db.qt(st.schema, st.stage)} s ON ${on}
                  WHERE s.${db.q(st.key[0])} IS NULL`;
    const [[c]] = await db.query(`SELECT COUNT(*) AS n ${from}`);
    const n = Number(c.n);
    if (!n) continue;
    const [rows] = await db.query(`SELECT t.${db.q(st.key[0])} AS id ${from} ORDER BY t.${db.q(st.key[0])} LIMIT 50`);
    out[st.dbKey] = { count: n, sample: rows.map((r) => r.id) };
  }
  return out;
}

/**
 * Prepare: swap-at-prepare tables, then merge-columns, then replace-scope.
 * Returns { steps } describing what changed, for rollback.
 */
async function applyPrepare({ runId, header, stages, summary, steps = [] }) {
  const goliveSet = new Set(shared.goliveTables(header.kind).map((t) => String(t).toLowerCase()));
  const swapNow = [];
  const goliveStages = [];
  summary.applied = {};

  // previous hashes for "skipped if unchanged"
  const [state] = await db.query(
    `SELECT database_name, table_name, table_hash FROM ${db.ctl("sync_table_state")} WHERE scope = ''`,
  );
  const lastHash = new Map(state.map((s) => [`${s.database_name}/${s.table_name.toLowerCase()}`, s.table_hash]));

  for (const [key, st] of stages) {
    if (st.skip) {
      summary.applied[key] = { mode: st.mode, skipped: "website keeps its own table" };
      continue;
    }
    const m = st.manifest || {};
    const applyAt = String(m.applyAt || st.applyAt || "prepare").toLowerCase();
    const mode = m.mode || st.mode;
    if (mode === "swap" && (applyAt === "golive" || goliveSet.has(st.table.toLowerCase()))) {
      goliveStages.push(st);
      summary.applied[key] = { mode, at: "golive", rows: st.rows };
    } else if (mode === "swap") {
      if (header.kind !== "full" && lastHash.get(key) && lastHash.get(key) === st.tableHash) {
        await db.query(`DROP TABLE IF EXISTS ${db.qt(st.schema, st.stage)}`);
        summary.applied[key] = { mode, at: "prepare", skipped: "unchanged" };
      } else {
        swapNow.push(st);
      }
    }
  }

  // 1. lookups and other swap-at-prepare tables, one RENAME
  if (swapNow.length) {
    await merge.swapNow(swapNow);
    for (const st of swapNow) {
      steps.push({ kind: "swap", dbKey: st.dbKey, schema: st.schema, table: st.table });
      summary.applied[`${st.dbKey}/${st.table.toLowerCase()}`] = { mode: "swap", at: "prepare", rows: st.rows };
    }
  }
  // 2. merge-columns, 3. replace-scope (each with its undo snapshot)
  for (const mode of ["merge-columns", "replace-scope"]) {
    for (const [key, st] of stages) {
      if (st.skip) continue;
      if ((st.manifest && st.manifest.mode ? st.manifest.mode : st.mode) !== mode) continue;
      // Record the step before it runs, so a failure part-way is undone too.
      const step = {
        kind: mode,
        dbKey: st.dbKey,
        schema: st.schema,
        table: st.table,
        key: st.key,
        columns: st.columns,
        scopes: [...st.parts.values()].map((p) => p.scope),
      };
      steps.push(step);
      const out = mode === "merge-columns" ? await merge.applyMerge(st) : await merge.applyReplace(st);
      if (out.swapped) step.kind = "swap";
      summary.applied[key] = { ...out, rows: st.rows };
      if (!out.swapped) await db.query(`DROP TABLE IF EXISTS ${db.qt(st.schema, st.stage)}`);
    }
  }

  // table state
  for (const st of stages.values()) {
    if (st.skip) continue;
    for (const part of st.parts.values()) {
      const scope = part.scope ? JSON.stringify(part.scope) : "";
      await db.query(
        `INSERT INTO ${db.ctl("sync_table_state")}
           (database_name, table_name, scope, last_run_id, row_count, table_hash, applied_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE last_run_id = VALUES(last_run_id), row_count = VALUES(row_count),
           table_hash = VALUES(table_hash), applied_at = NOW()`,
        [st.dbKey, st.table, scope.slice(0, 100), runId, part.rows, part.tableHash || null],
      );
    }
  }

  summary.steps = steps;
  summary.goliveTables = goliveStages.map((st) => ({ dbKey: st.dbKey, schema: st.schema, table: st.table }));
  await saveSummary(runId, summary);
  return { steps };
}

/** Reverse applied steps (newest first). Used on failure and by roll back. */
async function undoApplied(steps, { dbKey = null } = {}) {
  const mine = steps.filter((s) => !dbKey || s.dbKey === dbKey).slice().reverse();
  for (const s of mine) {
    if (s.kind === "merge-columns") await merge.rollbackMerge(s);
    else if (s.kind === "replace-scope") await merge.rollbackReplace(s);
  }
  const swaps = mine.filter((s) => s.kind === "swap");
  if (swaps.length) await merge.swapBack(swaps);
}

/** Restart processing of a package whose last run failed or waited for approval. */
async function reprocess(packageId, by) {
  const [[p]] = await db.query(`SELECT * FROM ${db.ctl("sync_packages")} WHERE id = ?`, [packageId]);
  if (!p) throw new SyncError("not-found", "Unknown package.", 404);
  if (!["received", "rejected"].includes(p.status)) {
    throw new SyncError("bad-request", `Package is ${p.status}; only a received or refused package can be processed again.`);
  }
  const [[busy]] = await db.query(
    `SELECT COUNT(*) AS n FROM ${db.ctl("sync_runs")}
     WHERE package_id = ? AND status IN ('verifying', 'loading', 'validating', 'checking')`,
    [packageId],
  );
  if (Number(busy.n)) throw new SyncError("busy", "This package is being processed.", 409);
  await db.query(
    `UPDATE ${db.ctl("sync_packages")} SET status = 'received', reject_reason = NULL WHERE id = ?`,
    [packageId],
  );
  // Earlier runs of this package that waited for approval are replaced by the new one.
  await db.query(
    `UPDATE ${db.ctl("sync_runs")} SET status = 'superseded', stage = 'processed again', finished_at = COALESCE(finished_at, NOW())
     WHERE package_id = ? AND status = 'received'`,
    [packageId],
  );
  return startRun(packageId, by);
}

/**
 * Delete a check-only run (checked / check_failed). A check never changes
 * payroll or staff data, so only the record goes. When the package has no other
 * runs and was never applied, the package record, its upload chunks and the
 * uploaded file go too (the same file can then be uploaded again).
 */
const DELETABLE_RUNS = ["checked", "check_failed"];

async function deleteCheckRun(idOrUuid, by) {
  const run = await getRun(idOrUuid);
  if (!run) throw new SyncError("not-found", "Unknown run.", 404);
  if (!DELETABLE_RUNS.includes(run.status)) {
    throw new SyncError(
      "bad-request",
      `Only check-only runs can be deleted; this run is ${run.status}. Loads, Go live and rollbacks stay in the history.`,
    );
  }
  if (active.has(run.id)) throw new SyncError("busy", "This run is still working.", 409);

  const out = await db.transaction(async (conn) => {
    await conn.query(`DELETE FROM ${db.ctl("sync_runs")} WHERE id = ?`, [run.id]);
    const [[pkg]] = await conn.query(
      `SELECT id, status, file_path, fingerprint FROM ${db.ctl("sync_packages")} WHERE id = ? FOR UPDATE`,
      [run.package_id],
    );
    const [[left]] = await conn.query(
      `SELECT COUNT(*) AS n FROM ${db.ctl("sync_runs")} WHERE package_id = ?`,
      [run.package_id],
    );
    if (!pkg || Number(left.n) > 0 || !["received", "rejected"].includes(pkg.status)) {
      return { packageRemoved: false, file: null };
    }
    await conn.query(`DELETE FROM ${db.ctl("sync_upload_chunks")} WHERE fingerprint = ?`, [pkg.fingerprint]);
    await conn.query(`DELETE FROM ${db.ctl("sync_packages")} WHERE id = ?`, [pkg.id]);
    return { packageRemoved: true, file: pkg.file_path };
  });

  if (out.file) {
    await require("fs").promises.rm(out.file, { force: true }).catch((e) =>
      console.error(`⚠️  sync: could not remove ${out.file}: ${e.message}`),
    );
  }
  console.log(
    `🗑️  sync: ${by} deleted check run ${run.run_uuid} (seq ${run.seq}, ${run.fingerprint})${out.packageRemoved ? " and its uploaded package" : ""}`,
  );
  return { runUuid: run.run_uuid, fingerprint: run.fingerprint, packageRemoved: out.packageRemoved };
}

module.exports = {
  LOCK_NAME,
  withLock,
  getRun,
  listRuns,
  machineMs,
  startRun,
  startCheck,
  waitFor,
  recoverInterruptedRuns,
  processRun,
  undoApplied,
  reprocess,
  deleteCheckRun,
  DELETABLE_RUNS,
  parseSummary,
  saveSummary,
};
