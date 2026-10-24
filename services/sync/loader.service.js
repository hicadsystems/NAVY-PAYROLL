// ============================================================
// Payslip Sync — bulk loader
// services/sync/loader.service.js
//
// local_infile is OFF on the host, so batches go in as multi-row
// INSERTs, each statement kept well under max_allowed_packet.
// ============================================================

const db = require("./db");
const { SyncError } = require("./package.service");

const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;

/** Wire value → value for mysql2 (see Package format, "types"). */
function fromWire(v, type) {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "binary":
      return Buffer.from(String(v), "base64");
    case "bit":
      return Number(v) ? 1 : 0;
    case "int":
    case "float":
      return typeof v === "number" ? v : Number(v);
    default:
      // string, bigint, decimal, date, datetime, time: keep the exact text
      return v;
  }
}

function approxSize(v) {
  if (v === null || v === undefined) return 4;
  if (Buffer.isBuffer(v)) return v.length * 2 + 3;
  return String(v).length * 2 + 3; // escaping worst case
}

/**
 * Insert one batch's rows into the stage table.
 * Rows arrive in primary-key order (the exporter reads by key).
 */
async function insertBatch(st, batch, part, conn = null) {
  const rows = batch.rows || [];
  if (!rows.length) return 0;
  const columns = part ? part.columns : st.columns;
  const ncol = columns.length;
  const types = batch.types || [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== ncol) {
      throw new SyncError("bad-record", `A row of ${st.table} has ${r && r.length} values, expected ${ncol}.`);
    }
  }

  const packet = await db.maxAllowedPacket();
  const limit = Math.max(64 * 1024, Math.min(MAX_STATEMENT_BYTES, Math.floor(packet * 0.5)));
  const head = `INSERT INTO ${db.qt(st.schema, st.stage)} (${columns.map(db.q).join(", ")}) VALUES `;
  const rowSql = `(${new Array(ncol).fill("?").join(", ")})`;
  const run = (sql, params) => (conn ? conn.query(sql, params) : db.query(sql, params));

  let parts = [];
  let params = [];
  let size = head.length;
  let inserted = 0;

  const flush = async () => {
    if (!parts.length) return;
    await run(head + parts.join(", "), params);
    inserted += parts.length;
    parts = [];
    params = [];
    size = head.length;
  };

  for (const r of rows) {
    let rs = rowSql.length + 2;
    const vals = new Array(ncol);
    for (let i = 0; i < ncol; i++) {
      vals[i] = fromWire(r[i], types[i]);
      rs += approxSize(vals[i]);
    }
    if (parts.length && size + rs > limit) await flush();
    parts.push(rowSql);
    for (const v of vals) params.push(v);
    size += rs;
  }
  await flush();
  return inserted;
}

module.exports = { insertBatch, fromWire, MAX_STATEMENT_BYTES };
