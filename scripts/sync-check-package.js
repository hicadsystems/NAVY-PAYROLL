// Check a real .npsync package offline with the installed navy-payslip-sync,
// before uploading it anywhere. Nothing is written to a database.
//
//   node scripts/sync-check-package.js <file.npsync> [--fingerprint 2CD0-ECCD-C004]
//        [--key-id D395-4E84-3E15-0137] [--db]
//
// Needs SYNC_PRIVATE_KEY (path to website-private.pem) to decrypt.
// --db also compares every table's columns with this website's MySQL
// (read-only INFORMATION_SCHEMA queries).

const crypto = require("crypto");
const shared = require("../services/sync/shared");
const pkg = require("../services/sync/package.service");
const { scopeKey } = require("../services/sync/staging.service");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^[0-9A-F-]{10,}$/i.test(a));
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const norm = (s) => String(s || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
let problems = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => {
  problems++;
  console.log(`  ✘ ${m}`);
};

(async () => {
  if (!file) {
    console.error("Usage: node scripts/sync-check-package.js <file.npsync> [--fingerprint X] [--key-id X] [--db]");
    process.exit(2);
  }
  const lib = shared.lib();
  console.log(`navy-payslip-sync ${(() => { try { return require("navy-payslip-sync/package.json").version; } catch (_) { return "?"; } })()}`);

  // ── header ──
  console.log("\nHeader");
  const { header, payloadOffset } = await lib.reader.readHeader(file);
  const fp = shared.fingerprint(header.payloadSha256);
  for (const k of ["kind", "period", "seq", "baseSeq", "exporterId", "operator", "createdAt", "exporterVersion", "payloadBytes"]) {
    console.log(`    ${k.padEnd(16)} ${JSON.stringify(header[k])}`);
  }
  console.log(`    ${"databases".padEnd(16)} ${(header.databases || []).join(", ")}`);
  console.log(`    ${"fingerprint".padEnd(16)} ${fp}`);
  if (opt("--fingerprint")) {
    norm(opt("--fingerprint")) === norm(fp) ? ok("fingerprint matches the media log") : bad(`fingerprint ${fp} ≠ ${opt("--fingerprint")}`);
  }
  try {
    lib.format.validateHeaderShape(header);
    ok("header shape");
  } catch (e) {
    bad(`header shape: ${e.message}`);
  }
  if (typeof lib.format.parseHeaderBuffer === "function") {
    const fs = require("fs");
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, Number(lib.format.PAYLOAD_OFFSET) || 16396));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    try {
      const h2 = lib.format.parseHeaderBuffer(buf);
      const same = JSON.stringify((h2 && h2.header) || h2) === JSON.stringify(header);
      same ? ok("parseHeaderBuffer gives the same header (browser preview path)") : console.log("    parseHeaderBuffer result differs in shape:", Object.keys(h2 || {}));
    } catch (e) {
      bad(`parseHeaderBuffer: ${e.message}`);
    }
  }

  // ── exporter key + signature ──
  console.log("\nExporter key and signature");
  const info = await lib.reader.inspectNewExporter(file);
  console.log(`    key id           ${info.keyIdFormatted || pkg.formatKeyId(info.keyId)}`);
  if (opt("--key-id")) {
    norm(info.keyIdFormatted || info.keyId).startsWith(norm(opt("--key-id")))
      ? ok("key id matches the one Dev A sent")
      : bad(`key id ${info.keyIdFormatted} ≠ ${opt("--key-id")}`);
  }
  await lib.reader.verifyPackage(file, { exporterPublicKeyPem: info.publicKeyPem });
  ok("signature and payload hash");
  const seq = lib.format.checkSequence(header, null);
  console.log(`    sequence rule with nothing applied yet: ${JSON.stringify(seq)}`);

  // ── decrypt + tables ──
  console.log("\nDecrypt and read");
  const wk = pkg.websiteKey();
  if (header.encryption && header.encryption.websiteKeyId && wk.keyId) {
    header.encryption.websiteKeyId === wk.keyId
      ? ok("encrypted for this website key")
      : bad(`encrypted for website key ${header.encryption.websiteKeyId}, SYNC_PRIVATE_KEY is ${wk.keyId}`);
  }
  const tables = new Map();
  let manifest = null;
  const t0 = Date.now();
  for await (const rec of pkg.readRecords(file, header, payloadOffset)) {
    if (rec.type === "batch") {
      const b = rec.batch;
      // one entry per database + table + scope (e.g. a py_payhistory part per his_year)
      const k = `${b.database}/${b.table}|${scopeKey(b.scope)}`;
      if (!tables.has(k)) tables.set(k, { db: b.database, table: b.table, mode: b.mode, scope: b.scope, columns: b.columns, types: b.types, rows: 0, batches: 0, list: [] });
      const t = tables.get(k);
      t.rows += b.rows.length;
      t.batches++;
      t.list.push({ batchNo: Number(b.batchNo), checksum: b.checksum });
    } else if (rec.type === "manifest") manifest = rec.manifest;
  }
  ok(`decrypted ${[...tables.values()].reduce((a, t) => a + t.rows, 0).toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!manifest) return bad("no manifest record");

  // ── compare with the manifest ──
  console.log("\nTables against the manifest");
  const formulas = {
    "batch.tableChecksum": (l) => (lib.batch && lib.batch.tableChecksum ? lib.batch.tableChecksum(l) : null),
    "sha256(join '\\n')": (l) => "sha256:" + crypto.createHash("sha256").update(l.join("\n"), "utf8").digest("hex"),
  };
  const formulaHits = {};
  const hrAllowed = new Set(shared.hrEmployeesPayrollColumns());
  for (const [dbKey, d] of Object.entries(manifest.databases || {})) {
    console.log(`  ${dbKey} — staff ${d.totals && d.totals.staffCount}, total net ${d.totals && d.totals.totalNet}`);
    for (const m of d.tables || []) {
      const t = tables.get(`${dbKey}/${m.table}|${scopeKey(m.scope)}`);
      if (t) t.listed = true;
      const def = shared.manifestTable(m.table);
      const errs = [];
      if (!def) errs.push("not in shared manifest");
      if (!t && Number(m.rows) > 0) errs.push("no batches");
      if (t && t.rows !== Number(m.rows)) errs.push(`rows ${t.rows} ≠ ${m.rows}`);
      if (t && m.batches != null && t.batches !== Number(m.batches)) errs.push(`batches ${t.batches} ≠ ${m.batches}`);
      if (t && m.checksum) {
        const sums = t.list.slice().sort((a, b) => a.batchNo - b.batchNo).map((x) => x.checksum);
        const hits = Object.entries(formulas).filter(([, f]) => f(sums) === m.checksum).map(([n]) => n);
        const hit = hits.length ? [hits.join(" = ")] : null;
        if (hit) formulaHits[hit[0]] = (formulaHits[hit[0]] || 0) + 1;
        else errs.push("table checksum matches no known formula");
      }
      if (t && m.table.toLowerCase() === "hr_employees") {
        const keyl = (def && def.key ? def.key : []).map((k) => k.toLowerCase());
        const extra = t.columns.filter((c) => !hrAllowed.has(c.toLowerCase()) && !keyl.includes(c.toLowerCase()));
        if (extra.length) errs.push(`hr_employees columns the website would refuse: ${extra.join(", ")}`);
      }
      const sc = m.scope && Object.keys(m.scope).length ? " " + JSON.stringify(m.scope) : "";
      const line = `${(m.table + sc).padEnd(34)} ${String(m.mode).padEnd(14)} ${String(m.applyAt || "").padEnd(8)} rows ${Number(m.rows).toLocaleString()}`;
      errs.length ? bad(`${line} — ${errs.join("; ")}`) : ok(line);
    }
  }
  for (const t of tables.values()) {
    if (!t.listed) bad(`${t.db}/${t.table}${t.scope ? " " + JSON.stringify(t.scope) : ""}: batches but not in the package manifest`);
  }
  console.log(`\n  table checksum formula: ${JSON.stringify(formulaHits)}`);
  if (!Object.keys(formulaHits).some((k) => k.includes("batch.tableChecksum"))) {
    console.log("  → batch.tableChecksum did not produce the manifest checksums; tell Dev A.");
  }

  // ── optional: compare columns with this website's MySQL ──
  if (args.includes("--db")) {
    console.log("\nColumns against this website's MySQL");
    const db = require("../services/sync/db");
    const staging = require("../services/sync/staging.service");
    const seen = new Set();
    for (const t of tables.values()) {
      if (seen.has(`${t.db}/${t.table}/${t.columns.join(",")}`)) continue;
      seen.add(`${t.db}/${t.table}/${t.columns.join(",")}`);
      let schema;
      try {
        schema = db.schemaFor(t.db);
      } catch (e) {
        bad(`${t.db}: ${e.message}`);
        continue;
      }
      const name = await staging.resolveTableName(schema, t.table);
      if (!name) {
        bad(`${schema}.${t.table} does not exist`);
        continue;
      }
      const live = await staging.liveColumns(schema, name);
      const missing = t.columns.filter((c) => !live.has(String(c).toLowerCase()));
      missing.length ? bad(`${schema}.${name}: package columns missing on the website: ${missing.join(", ")}`) : ok(`${schema}.${name}: ${t.columns.length} columns match`);
    }
    await db.end();
  }

  console.log(problems ? `\n${problems} problem(s).` : "\nPackage checks out.");
  process.exit(problems ? 1 : 0);
})().catch((e) => {
  console.error(`\n✘ ${e.code || "error"}: ${e.message}`);
  process.exit(1);
});
