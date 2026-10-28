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
//
// Which database holds each payroll class comes from py_payrollclass
// (classcode → db_name) in the master database, like the rest of the app.
// Only the master itself (hicaddata, where py_payrollclass lives) comes
// from config. The .env class databases are used only if py_payrollclass
// cannot be read.
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

// py_payrollclass.classcode of each package database (navy-payslip-sync
// manifest.DATABASE_CLASSCODES from 0.1.3; this copy is used with older libraries).
const CLASS_CODES = {
  officers: "1",
  wofficers: "2",
  ratings: "3",
  ratingsA: "4",
  ratingsB: "5",
  juniorTrainee: "6",
};
const CLASS_TTL_MS = 60 * 1000;

let _pool = null;
let _classes = null; // { at, source, list, byKey: Map(key → row) }

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

/** The master database (hicaddata): control tables and py_payrollclass live here. */
function masterSchema() {
  const name = config.databases[MASTER_KEY];
  if (!name) {
    const err = new Error("The master payroll database (officers) is not configured on this website");
    err.code = "unknown-database";
    throw err;
  }
  return name;
}

function keyForClasscode(code) {
  const c = String(code == null ? "" : code).trim().replace(/^0+(?=\d)/, "");
  try {
    const m = require("./shared").lib().manifest;
    if (typeof m.databaseForClasscode === "function") return m.databaseForClasscode(c);
  } catch (_) {}
  return DATABASE_KEYS.find((k) => CLASS_CODES[k] === c) || null;
}

/** Fallback when py_payrollclass cannot be read: the .env class databases. */
function classesFromConfig(reason) {
  const list = DATABASE_KEYS.map((k) => ({
    key: k,
    classcode: CLASS_CODES[k],
    classname: null,
    status: null,
    schema: config.databases[k] || null,
  }));
  return { at: Date.now(), source: "config", reason, list, byKey: new Map(list.filter((c) => c.key).map((c) => [c.key, c])) };
}

/**
 * Payroll classes from py_payrollclass (cached 60 s). Each row:
 * { key, classcode, classname, status, schema }; key is the package database
 * (officers, wofficers, ...) or null for a class packages do not carry.
 */
async function refreshClasses({ force = false } = {}) {
  if (!force && _classes && Date.now() - _classes.at < CLASS_TTL_MS) return _classes;
  try {
    const [rows] = await query(
      `SELECT classcode, classname, status, db_name FROM ${qt(masterSchema(), "py_payrollclass")}
       ORDER BY CAST(classcode AS UNSIGNED), classcode`,
    );
    const list = rows.map((r) => ({
      key: keyForClasscode(r.classcode),
      classcode: String(r.classcode).trim(),
      classname: r.classname == null ? null : String(r.classname).trim(),
      status: r.status == null ? null : String(r.status).trim(),
      schema: r.db_name ? String(r.db_name).trim() : null,
    }));
    const byKey = new Map();
    for (const c of list) if (c.key && !byKey.has(c.key)) byKey.set(c.key, c);
    // The master is hicaddata whatever its py_payrollclass row says.
    const m = byKey.get(MASTER_KEY);
    if (m) m.schema = masterSchema();
    else byKey.set(MASTER_KEY, { key: MASTER_KEY, classcode: CLASS_CODES[MASTER_KEY], classname: null, status: null, schema: masterSchema() });
    _classes = { at: Date.now(), source: "py_payrollclass", list, byKey };
  } catch (e) {
    if (!_classes || _classes.source !== "config") {
      console.warn(`⚠️ payslip sync: py_payrollclass not readable (${e.message}); using the .env databases`);
    }
    _classes = classesFromConfig(e.message);
  }
  return _classes;
}

function classesNow() {
  return _classes || classesFromConfig("not loaded yet");
}

/** Payroll classes as last loaded (call refreshClasses() first). */
function classes() {
  return classesNow();
}

/** Schema name for a package database key (officers → hicaddata), from py_payrollclass. */
function schemaFor(dbKey) {
  if (dbKey === MASTER_KEY) return masterSchema();
  const c = classesNow().byKey.get(dbKey);
  if (!c || !c.schema) {
    const err = new Error(`Database '${dbKey}' has no payroll class with a database (py_payrollclass classcode ${CLASS_CODES[dbKey] || "?"}) on this website`);
    err.code = "unknown-database";
    throw err;
  }
  return c.schema;
}

/** Package database key for a schema name (hicaddata → officers), or null. */
function keyForSchema(schema) {
  if (!schema) return null;
  const s = String(schema).toLowerCase();
  let master = null;
  try {
    master = masterSchema();
  } catch (_) {}
  if (master && master.toLowerCase() === s) return MASTER_KEY;
  for (const [k, c] of classesNow().byKey) {
    if (c.schema && c.schema.toLowerCase() === s) return k;
  }
  return null;
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
  CLASS_CODES,
  pool,
  refreshClasses,
  classes,
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
