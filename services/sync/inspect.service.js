// ============================================================
// Payslip Sync — check an uploaded package without loading it
// services/sync/inspect.service.js
//
// Signature and payload hash, exporter key, sequence rule, decryption with
// this website's key, every manifest entry (rows, batches, checksum), table
// and column rules, columns against this website's MySQL. Writes nothing to
// the payroll databases.
// ============================================================

const db = require("./db");
const shared = require("./shared");
const pkgSvc = require("./package.service");
const staging = require("./staging.service");
const { tableChecksum } = require("./validate.service");

async function checkPackageFile(filePath) {
  const items = [];
  const add = (label, status, detail = "") => items.push({ label, status, detail });
  const lib = shared.lib();

  // ── header, exporter, signature ──
  const { header } = await lib.reader.readHeader(filePath);
  const v = await pkgSvc.verifyFile(filePath); // throws on bad signature / hash / changed key
  let approval = null;
  if (v.needsApproval) {
    approval = { exporterId: v.info.exporterId, keyIdFormatted: v.info.keyIdFormatted };
    add("Signature and contents", "ok", "checked with the key the package carries");
    add("Exporter", "warn", `${v.info.exporterId}, key id ${v.info.keyIdFormatted}: not approved yet — you approve it when you load the package (compare the key id with the exporter screen or media log)`);
  } else {
    add("Signature and contents", "ok", "signed by the approved exporter key; no byte changed");
    add("Exporter", "ok", `${header.exporterId}, key id ${pkgSvc.formatKeyId(v.exporter.key_id)}`);
  }
  try {
    const s = await pkgSvc.checkSequence(header);
    add("Sequence", "ok", header.kind === "full" ? `full package, seq ${header.seq}` : `seq ${header.seq} follows ${s.lastAppliedSeq}`);
  } catch (e) {
    add("Sequence", "fail", e.message);
  }
  const wk = pkgSvc.websiteKey();
  const forKey = header.encryption && header.encryption.websiteKeyId;
  if (forKey && wk.keyId && forKey !== wk.keyId) {
    add("Encrypted for this website", "fail", `package is for website key ${pkgSvc.formatKeyId(forKey)}, this website has ${pkgSvc.formatKeyId(wk.keyId)}`);
    return { header: summary(header), approval, items, tables: [], ok: false };
  }

  // ── decrypt and count every entry ──
  const parts = new Map(); // db/table|scopeKey → { db, table, scope, columns, rows, batches:[] }
  let manifest = null;
  const t0 = Date.now();
  const payloadOffset = v.payloadOffset || Number(lib.format.PAYLOAD_OFFSET);
  for await (const rec of pkgSvc.readRecords(filePath, header, payloadOffset)) {
    if (rec.type === "batch") {
      const b = rec.batch;
      const k = `${b.database}/${String(b.table).toLowerCase()}|${staging.scopeKey(b.scope)}`;
      if (!parts.has(k)) parts.set(k, { db: b.database, table: b.table, scope: b.scope || null, mode: b.mode, columns: b.columns, rows: 0, batches: [] });
      const p = parts.get(k);
      p.rows += b.rows.length;
      p.batches.push({ batchNo: Number(b.batchNo), checksum: b.checksum });
    } else if (rec.type === "manifest") manifest = rec.manifest;
  }
  add("Decryption", "ok", `${[...parts.values()].reduce((a, p) => a + p.rows, 0).toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!manifest) {
    add("Manifest", "fail", "the package has no manifest");
    return { header: summary(header), approval, items, tables: [], ok: false };
  }

  // ── each manifest entry ──
  const tables = [];
  const liveCache = new Map();
  const hrAllowed = new Set(shared.hrEmployeesPayrollColumns());
  for (const [dbKey, d] of Object.entries(manifest.databases || {})) {
    for (const m0 of d.tables || []) {
      const m = { ...m0, table: m0.table || m0.name };
      const k = `${dbKey}/${String(m.table).toLowerCase()}|${staging.scopeKey(m.scope)}`;
      const p = parts.get(k);
      if (p) p.listed = true;
      const row = { database: dbKey, table: m.table, scope: m.scope && Object.keys(m.scope).length ? m.scope : null, mode: m.mode, applyAt: m.applyAt, expectedRows: Number(m.rows), rows: p ? p.rows : 0, problems: [] };
      tables.push(row);
      try {
        staging.checkTableAllowed(m.table, dbKey, header.kind);
      } catch (e) {
        row.problems.push(e.message);
      }
      if (!p) {
        if (Number(m.rows) > 0) row.problems.push("no batches arrived");
      } else {
        if (p.rows !== Number(m.rows)) row.problems.push(`rows ${p.rows} ≠ ${m.rows}`);
        if (m.batches != null && p.batches.length !== Number(m.batches)) row.problems.push(`batches ${p.batches.length} ≠ ${m.batches}`);
        const sum = tableChecksum(p.batches.slice().sort((a, b) => a.batchNo - b.batchNo).map((b) => b.checksum));
        if (m.checksum && sum !== m.checksum) row.problems.push("checksum mismatch");
        if (String(m.table).toLowerCase() === "hr_employees") {
          const keys = ((shared.tableDef(m.table, dbKey, header.kind) || {}).key || []).map((x) => x.toLowerCase());
          const extra = p.columns.filter((c) => !hrAllowed.has(String(c).toLowerCase()) && !keys.includes(String(c).toLowerCase()));
          if (extra.length) row.problems.push(`login / non-payroll columns refused: ${extra.join(", ")}`);
        }
        // columns against this website's MySQL
        let schemaName;
        try {
          schemaName = db.schemaFor(dbKey);
        } catch (e) {
          row.problems.push(e.message);
        }
        if (staging.websiteKeeps(m.table)) {
          row.note = "website keeps its own table: verified, not loaded";
        } else if (schemaName) {
          const ck = `${schemaName}.${String(m.table).toLowerCase()}`;
          if (!liveCache.has(ck)) {
            const name = await staging.resolveTableName(schemaName, m.table);
            liveCache.set(ck, name ? await staging.liveColumns(schemaName, name) : null);
          }
          const live = liveCache.get(ck);
          if (!live) row.problems.push(`table ${m.table} does not exist in ${schemaName}`);
          else {
            const missing = p.columns.filter((c) => !live.has(String(c).toLowerCase()));
            if (missing.length) row.problems.push(`columns not on the website: ${missing.join(", ")}`);
            // The other way: website columns the package does not carry.
            const sent = new Set(p.columns.map((c) => String(c).toLowerCase()));
            const notSent = [...live.values()].filter((c) => !sent.has(c.name.toLowerCase()));
            const required = notSent.filter(
              (c) => c.nullable === "NO" && c.dflt == null && !/auto_increment|generated/i.test(String(c.extra || "")),
            );
            const mode = String(m.mode || p.mode || "");
            if (mode === "swap" || (mode === "replace-scope" && !(m.scope && Object.keys(m.scope).length))) {
              // the whole table is replaced: required columns fail, the rest are emptied
              if (required.length) row.problems.push(`website columns required but not in the package: ${required.map((c) => c.name).join(", ")}`);
              const emptied = notSent.filter((c) => !required.includes(c));
              if (emptied.length) (row.warnings = row.warnings || []).push(`website-only columns that would be emptied: ${emptied.map((c) => c.name).join(", ")}`);
            } else if (required.length) {
              // merge / replace of a period: only new rows need these columns
              (row.warnings = row.warnings || []).push(`new rows would need website columns the package does not carry: ${required.map((c) => c.name).join(", ")}`);
            }
          }
        }
      }
    }
  }
  for (const p of parts.values()) {
    if (!p.listed) tables.push({ database: p.db, table: p.table, scope: p.scope, rows: p.rows, problems: ["batches arrived but the manifest does not list them"] });
  }
  const bad = tables.filter((t) => t.problems.length);
  add("Tables against the manifest and this database", bad.length ? "fail" : "ok", bad.length ? `${bad.length} of ${tables.length} entries have problems` : `${tables.length} entries match`);
  const warned = tables.filter((t) => t.warnings && t.warnings.length);
  if (warned.length) add("Website columns the package does not carry", "warn", `${warned.length} table(s): see the table list`);

  const totals = Object.fromEntries(Object.entries(manifest.databases || {}).map(([k, d]) => [k, d.totals || null]));
  return {
    header: summary(header),
    approval,
    items,
    tables,
    totals,
    ok: !items.some((i) => i.status === "fail"),
  };
}

function summary(h) {
  return {
    kind: h.kind, period: h.period, seq: h.seq, baseSeq: h.baseSeq, exporterId: h.exporterId,
    operator: h.operator, createdAt: h.createdAt, databases: h.databases, exporterVersion: h.exporterVersion,
    fingerprint: shared.fingerprint(h.payloadSha256),
  };
}

module.exports = { checkPackageFile };
