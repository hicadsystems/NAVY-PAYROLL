// ============================================================
// Payslip Sync — database access
// services/sync/db.js
//
// The sync code uses its own small mysql2 pool, separate from
// config/db.js (which switches database per user session). Every
// statement names its database explicitly: `db`.`table`.
//
// Login: SYNC_DB_USER / SYNC_DB_PASSWORD (the restricted sync_writer
// user from the plan). Falls back to MYSQL_USER / MYSQL_PASSWORD so
// development works without a separate user.
// ============================================================

const mysql = require("mysql2/promise");
const config = require("../../config");

// Website database keys used in packages → schema names in this install.
// Keys match navy-payslip-sync manifest.DATABASES.
const DATABASE_KEYS = [
  "officers",
  "wofficers",
  "ratings",
  "ratingsA",
  "ratingsB",
  "juniorTrainee",
];
const MASTER_KEY = "officers";

let _pool = null;

/**
 * Login for sync writes. SYNC_DB_USER / SYNC_DB_PASSWORD when set (empty values
 * count as not set); otherwise, or when the sync user is the app's own login,
 * the app's MySQL login from config.
 */
function loginSettings() {
  const env = (k) => (process.env[k] && process.env[k].trim() !== "" ? process.env[k] : null);
  const user = env("SYNC_DB_USER");
  const own = !user || user === config.mysql.user;
  return {
    host: env("SYNC_DB_HOST") || config.mysql.host,
    port: parseInt(env("SYNC_DB_PORT")) || config.mysql.port,
    user: user || config.mysql.user,
    password: own ? (env("SYNC_DB_PASSWORD") ?? config.mysql.password) : (process.env.SYNC_DB_PASSWORD || ""),
  };
}

function pool() {
  if (!_pool) {
    _pool = mysql.createPool({
      ...loginSettings(),
      connectionLimit: parseInt(process.env.SYNC_DB_POOL_SIZE) || 6,
      waitForConnections: true,
      // decimals and big integers stay exact
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      timezone: "local",
      multipleStatements: false,
      charset: "utf8mb4",
    });
  }
  return _pool;
}

/** Schema name for a package database key (officers → hicaddata). */
function schemaFor(dbKey) {
  const name = config.databases[dbKey];
  if (!name) {
    const err = new Error(`Database '${dbKey}' is not configured on this website`);
    err.code = "unknown-database";
    throw err;
  }
  return name;
}

/** Package database key for a schema name (hicaddata → officers), or null. */
function keyForSchema(schema) {
  if (!schema) return null;
  const s = String(schema).toLowerCase();
  for (const k of DATABASE_KEYS) {
    if (String(config.databases[k] || "").toLowerCase() === s) return k;
  }
  return null;
}

function masterSchema() {
  return schemaFor(MASTER_KEY);
}

/** Back-quote an identifier. */
function q(name) {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

/** `db`.`table` */
function qt(schema, table) {
  return `${q(schema)}.${q(table)}`;
}

/** Control table in the master database. */
function ctl(table) {
  return qt(masterSchema(), table);
}

async function query(sql, params = []) {
  return pool().query(sql, params);
}

async function getConnection() {
  return pool().getConnection();
}

/** Run fn(conn) inside a transaction on one connection. */
async function transaction(fn) {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

let _packet = null;
/** Server max_allowed_packet in bytes (cached). */
async function maxAllowedPacket() {
  if (_packet == null) {
    const [[r]] = await query("SELECT @@max_allowed_packet AS p");
    _packet = Number(r.p);
  }
  return _packet;
}

async function tableExists(schema, table) {
  const [[r]] = await query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
  return Number(r.n) > 0;
}

async function end() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    _packet = null;
    await p.end();
  }
}

module.exports = {
  loginSettings,
  DATABASE_KEYS,
  MASTER_KEY,
  pool,
  schemaFor,
  keyForSchema,
  masterSchema,
  q,
  qt,
  ctl,
  query,
  getConnection,
  transaction,
  maxAllowedPacket,
  tableExists,
  end,
};
