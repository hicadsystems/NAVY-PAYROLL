// ============================================================
// Payslip Sync — publications (which months staff may see)
// services/sync/publication.service.js
// ============================================================

const db = require("./db");

/**
 * Is a period visible to staff in this payroll database?
 *
 *  - a sync_publications row 'published'                → yes
 *  - a row in any other state (prepared, withdrawn, …)  → no
 *  - no row: periods before the first synced publication stay visible,
 *    and so does everything while this database has never been synced
 *    (existing history, and the current behaviour before go-live day)
 *
 * @param {string} schema  payroll database name (e.g. hicaddata2)
 * @param {string} period  YYYYMM
 * @returns {Promise<{visible: boolean, reason: string}>}
 */
async function isPeriodVisible(schema, period) {
  const dbKey = db.keyForSchema(schema);
  if (!dbKey) return { visible: true, reason: "database not synced" };
  let rows;
  try {
    [rows] = await db.query(
      `SELECT status FROM ${db.ctl("sync_publications")} WHERE database_name = ? AND period = ?`,
      [dbKey, String(period)],
    );
  } catch (e) {
    // Control tables not created yet → sync not in use.
    if (e && (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146)) {
      return { visible: true, reason: "sync not installed" };
    }
    throw e;
  }
  if (rows.length) {
    const s = rows[0].status;
    return { visible: s === "published", reason: s };
  }
  const [[first]] = await db.query(
    `SELECT MIN(period) AS p FROM ${db.ctl("sync_publications")}
     WHERE database_name = ? AND status IN ('published', 'withdrawn', 'rolled_back')`,
    [dbKey],
  );
  if (!first || !first.p) return { visible: true, reason: "never synced" };
  if (String(period) < String(first.p)) return { visible: true, reason: "before first synced publication" };
  return { visible: false, reason: "not published" };
}

/** Mark prepared. A period already published keeps showing until Go live. */
async function markPrepared({ dbKey, period, staffCount, totalNet, packageId, runId }, conn = null) {
  const run = (sql, p) => (conn ? conn.query(sql, p) : db.query(sql, p));
  await run(
    `INSERT INTO ${db.ctl("sync_publications")}
       (database_name, period, status, staff_count, total_net, package_id, run_id, prepared_at)
     VALUES (?, ?, 'prepared', ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       published_by = IF(status = 'published', published_by, NULL),
       published_at = IF(status = 'published', published_at, NULL),
       withdrawn_by = NULL, withdrawn_at = NULL, rolled_back_by = NULL, rolled_back_at = NULL,
       status = IF(status = 'published', 'published', 'prepared'),
       staff_count = VALUES(staff_count), total_net = VALUES(total_net),
       package_id = VALUES(package_id), run_id = VALUES(run_id), prepared_at = NOW()`,
    [dbKey, period, staffCount, totalNet, packageId, runId],
  );
}

async function setStatus(dbKey, period, status, by, conn = null) {
  const run = (sql, p) => (conn ? conn.query(sql, p) : db.query(sql, p));
  const col = {
    published: ["published_by", "published_at"],
    withdrawn: ["withdrawn_by", "withdrawn_at"],
    rolled_back: ["rolled_back_by", "rolled_back_at"],
  }[status];
  let extra = col ? `, ${col[0]} = ?, ${col[1]} = NOW()` : "";
  if (status === "published") extra += ", withdrawn_by = NULL, withdrawn_at = NULL";
  const params = col ? [status, by, dbKey, period] : [status, dbKey, period];
  const [r] = await run(
    `UPDATE ${db.ctl("sync_publications")} SET status = ?${extra} WHERE database_name = ? AND period = ?`,
    params,
  );
  return r.affectedRows;
}

async function get(dbKey, period) {
  const [rows] = await db.query(
    `SELECT * FROM ${db.ctl("sync_publications")} WHERE database_name = ? AND period = ?`,
    [dbKey, period],
  );
  return rows[0] || null;
}

async function list({ limit = 200 } = {}) {
  const [rows] = await db.query(
    `SELECT p.*, k.seq, k.kind, k.fingerprint, r.run_uuid, r.status AS run_status
     FROM ${db.ctl("sync_publications")} p
     LEFT JOIN ${db.ctl("sync_packages")} k ON k.id = p.package_id
     LEFT JOIN ${db.ctl("sync_runs")} r ON r.id = p.run_id
     ORDER BY p.period DESC, p.database_name
     LIMIT ${Math.max(1, Math.min(1000, Number(limit) || 200))}`,
  );
  return rows;
}

module.exports = { isPeriodVisible, markPrepared, setStatus, get, list };
