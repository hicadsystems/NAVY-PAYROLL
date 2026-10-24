// ============================================================
// Payslip Sync — validate stage tables against the package manifest
// services/sync/validate.service.js
//
// Runs after every batch is loaded and before anything live changes.
// A failure here leaves staff data untouched.
// ============================================================

const crypto = require("crypto");
const shared = require("./shared");
const staging = require("./staging.service");
const { SyncError } = require("./package.service");

/**
 * Checksum of one manifest entry (database + table + scope), as in
 * navy-payslip-sync shared/batch-format.js tableChecksum():
 * the batch checksum strings (with their "sha256:" prefix) in batchNo order,
 * joined with "\n", no trailing newline → "sha256:" + sha256 hex.
 * The library's own function is used when present.
 */
function tableChecksum(batchChecksums) {
  const lib = shared.lib();
  const fn = lib.batch && lib.batch.tableChecksum;
  if (typeof fn === "function") return fn(batchChecksums);
  return "sha256:" + crypto.createHash("sha256").update(batchChecksums.join("\n"), "utf8").digest("hex");
}

/**
 * @param {object} manifest  the package manifest record
 * @param {Map}    stages    "db/table" → stage descriptor with parts (scopeKey → part)
 * @param {object} header
 * @returns {object} per database checks; throws SyncError listing every failure
 */
async function validate(manifest, stages, header) {
  const failures = [];
  const result = {};
  if (!manifest || !manifest.databases) {
    throw new SyncError("missing-end", "The package has no manifest.");
  }
  if (manifest.period && header.period && String(manifest.period) !== String(header.period)) {
    failures.push(`manifest period ${manifest.period} differs from header period ${header.period}`);
  }
  if (manifest.seq != null && Number(manifest.seq) !== Number(header.seq)) {
    failures.push(`manifest seq ${manifest.seq} differs from header seq ${header.seq}`);
  }

  const listed = new Set(); // "db/table|scopeKey"
  const expectedPerStage = new Map(); // "db/table" → rows the manifest promises
  for (const [dbKey, d] of Object.entries(manifest.databases)) {
    const checks = [];
    result[dbKey] = { totals: d.totals || null, tables: checks };
    for (const t0 of d.tables || []) {
      const t = { ...t0, table: t0.table || t0.name };
      const key = `${dbKey}/${String(t.table).toLowerCase()}`;
      const sk = staging.scopeKey(t.scope);
      listed.add(`${key}|${sk}`);
      expectedPerStage.set(key, (expectedPerStage.get(key) || 0) + Number(t.rows || 0));
      const st = stages.get(key);
      const part = st && st.parts.get(sk);
      const c = {
        table: t.table,
        scope: t.scope && Object.keys(t.scope).length ? t.scope : null,
        expectedRows: Number(t.rows),
        batches: Number(t.batches),
      };
      checks.push(c);

      if (!part) {
        if (Number(t.rows) === 0) {
          c.ok = true;
          c.note = "empty, nothing loaded";
          continue;
        }
        c.ok = false;
        failures.push(`${dbKey}.${t.table}${c.scope ? " " + JSON.stringify(c.scope) : ""}: in the manifest but no batches arrived`);
        continue;
      }
      if (!st.manifest) st.manifest = t; // mode / applyAt for the apply step (same for every part)
      if (st.skip) c.note = "website keeps its own table: verified, not loaded";
      c.loadedRows = part.rows;
      c.loadedBatches = part.batches.length;

      const errs = [];
      if (part.rows !== Number(t.rows)) errs.push(`rows ${part.rows} ≠ ${t.rows}`);
      if (t.batches != null && part.batches.length !== Number(t.batches)) errs.push(`batches ${part.batches.length} ≠ ${t.batches}`);
      const sums = part.batches.slice().sort((a, b) => a.batchNo - b.batchNo).map((b) => b.checksum);
      const sum = tableChecksum(sums);
      if (t.checksum) {
        c.checksum = sum === t.checksum ? "ok" : "mismatch";
        if (sum !== t.checksum) errs.push("table checksum mismatch");
      }
      part.tableHash = t.checksum || sum;
      if (st.parts.size === 1) st.tableHash = part.tableHash;

      c.ok = errs.length === 0;
      if (errs.length) failures.push(`${dbKey}.${t.table}${c.scope ? " " + JSON.stringify(c.scope) : ""}: ${errs.join("; ")}`);
    }
  }

  for (const [key, st] of stages) {
    for (const part of st.parts.values()) {
      if (!listed.has(`${key}|${part.scopeKey}`)) {
        failures.push(`${key}${part.scope ? " " + JSON.stringify(part.scope) : ""}: batches arrived but the manifest does not list them`);
      }
    }
    if (st.skip) continue;
    const stageRows = await staging.countRows(st.schema, st.stage);
    const want = expectedPerStage.get(key);
    if (want != null && stageRows !== want) failures.push(`${key}: stage table has ${stageRows} rows, expected ${want}`);
  }

  if (failures.length) {
    throw new SyncError("validation-failed", `Checks failed: ${failures.join(" | ")}`, 400, {
      failures,
      checks: result,
    });
  }
  return result;
}

module.exports = { validate, tableChecksum };
