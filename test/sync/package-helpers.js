// Builds real .npsync packages for the website tests with navy-payslip-sync's own
// writer (AES-256-GCM, X25519 sealed key, Ed25519 signature, gzipped batches).
// Mode, applyAt and scope of each table come from the library's manifest.

const sync = require("navy-payslip-sync");

const BATCH_ROWS = 5000;

function makeExporter(id) {
  const k = sync.crypto.generateExporterKeyPair();
  return { id, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem };
}

/** Is this table in the manifest for this database and kind? (hr_employees is master-only from v0.1.2) */
function has(database, table, kind) {
  return sync.manifest.tablesFor(database, kind === "dryrun" ? "month" : kind).some((x) => x.name === table);
}

/** Manifest definition of a table for one database and kind. */
function def(database, table, kind) {
  const t = sync.manifest.tablesFor(database, kind === "dryrun" ? "month" : kind).find((x) => x.name === table);
  if (!t) throw new Error(`${table} is not in the manifest for ${database}/${kind}`);
  return t;
}

/**
 * entries: [{ database, table, columns, types, rows, scope? }] — one per manifest entry
 * (a py_payhistory month entry per his_year). Mode / applyAt / key come from the manifest
 * unless given.
 */
async function writePackage(file, { exporter, websitePublicKeyPem, kind = "month", seq, baseSeq = null, period, databases, entries, totals = {} }) {
  const w = await sync.writer.PackageWriter.create({ filePath: file, websitePublicKeyPem });
  const manifest = { manifestVersion: sync.manifest.MANIFEST_VERSION, kind, period, seq, baseSeq, timings: { exportMs: 60000 }, databases: {} };
  for (const d of databases) manifest.databases[d] = { totals: totals[d] || { staffCount: 0, totalNet: "0.0000" }, tables: [] };

  // encode every entry's batches, then interleave them across entries like the parallel exporter
  const queues = [];
  for (const e of entries) {
    const dd = def(e.database, e.table, kind);
    const mode = e.mode || dd.mode;
    const applyAt = e.applyAt || dd.applyAt;
    const scope = e.scope !== undefined ? e.scope : null;
    const list = [];
    for (let i = 0, no = 1; i < e.rows.length; i += BATCH_ROWS, no++) {
      const enc = await sync.batch.encodeBatch({
        database: e.database, table: e.table, mode, scope, batchNo: no,
        columns: e.columns, types: e.types, rows: e.rows.slice(i, i + BATCH_ROWS),
      });
      list.push({ name: sync.batch.batchRecordName(e.database, e.table, scope, no), ...enc });
    }
    queues.push(list);
    manifest.databases[e.database].tables.push({
      table: e.table, mode, applyAt, rollback: sync.manifest.rollbackFor(mode), key: dd.key, scope,
      columns: e.columns, types: e.types, rows: e.rows.length, batches: list.length,
      checksum: sync.batch.tableChecksum(list.map((b) => b.checksum)),
    });
  }
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round]) await w.addBatch(q[round].name, q[round].buffer);
  }
  const res = await w.finish({
    headerFields: { kind, exporterId: exporter.id, seq, baseSeq, period, databases, operator: "test", manifestVersion: manifest.manifestVersion, exporterVersion: sync.version },
    manifest,
    exporterPrivateKeyPem: exporter.privateKeyPem,
    exporterPublicKeyPem: exporter.publicKeyPem,
  });
  return res.header;
}

module.exports = { sync, makeExporter, writePackage, def, has };
