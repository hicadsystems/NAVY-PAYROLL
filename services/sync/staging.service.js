// ============================================================
// Payslip Sync — stage tables
// services/sync/staging.service.js
//
// Every table in a package is loaded into <table>__stage first.
//   swap           CREATE … LIKE live; only the primary key while loading,
//                  secondary indexes added back in one step afterwards.
//   merge-columns  only the key + sent columns, primary key on the key.
//   replace-scope  same, primary key on the manifest key.
// ============================================================

const db = require("./db");
const shared = require("./shared");
const { SyncError } = require("./package.service");

const MODES = new Set(["swap", "replace-scope", "merge-columns"]);
const SUFFIX = {
  stage: "__stage",
  prev: "__prev",
  undo: "__undo",
  undoNew: "__undo_new",
  rb: "__rb",
};

// Tables the website keeps as its own even though packages carry them: they are
// read and verified but never loaded. py_payrollclass holds website settings
// (db_name — which database a payroll class lives in — status, year, month) that
// the payslip page depends on; the payroll side has none of them.
const WEBSITE_KEEPS = new Set(["py_payrollclass"]);

function websiteKeeps(table) {
  return WEBSITE_KEEPS.has(String(table).toLowerCase());
}

// Never written by a package, whatever the package says.
const WEBSITE_OWNED_PREFIXES = ["ef_", "sync_"];
const WEBSITE_OWNED_TABLES = new Set(["py_webpayslip", "users", "roles", "notifications"]);

/** Live table columns: Map lower-name → { name, type, key, nullable }. */
async function liveColumns(schema, table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_TYPE AS ctype, COLUMN_KEY AS ckey, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS dflt, EXTRA AS extra
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  const m = new Map();
  for (const r of rows) m.set(r.name.toLowerCase(), r);
  return m;
}

/**
 * A package part is one manifest entry: database + table + scope. A month
 * package can carry one py_payhistory part per his_year (closed months
 * crossing a year end), each with its own month columns.
 */
function scopeKey(scope) {
  if (!scope || typeof scope !== "object" || !Object.keys(scope).length) return "";
  return JSON.stringify(Object.keys(scope).sort().map((k) => [k.toLowerCase(), String(scope[k])]));
}

/** Actual table name (case as stored), or null. */
async function resolveTableName(schema, table) {
  const [rows] = await db.query(
    `SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND LOWER(TABLE_NAME) = LOWER(?)`,
    [schema, table],
  );
  return rows.length ? rows[0].t : null;
}

async function primaryKey(schema, table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
     ORDER BY SEQ_IN_INDEX`,
    [schema, table],
  );
  return rows.map((r) => r.c);
}

/** Secondary index definitions, for re-adding after load. */
async function secondaryIndexes(schema, table) {
  const [rows] = await db.query(
    `SELECT INDEX_NAME AS i, NON_UNIQUE AS nu, COLUMN_NAME AS c, SUB_PART AS sp, INDEX_TYPE AS it
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [schema, table],
  );
  const idx = new Map();
  for (const r of rows) {
    if (!idx.has(r.i)) idx.set(r.i, { name: r.i, unique: Number(r.nu) === 0, type: r.it, cols: [] });
    idx.get(r.i).cols.push(r.sp ? `${db.q(r.c)}(${r.sp})` : db.q(r.c));
  }
  return [...idx.values()];
}

function indexClause(ix) {
  const kind = ix.type === "FULLTEXT" ? "FULLTEXT INDEX" : ix.unique ? "UNIQUE INDEX" : "INDEX";
  return `${kind} ${db.q(ix.name)} (${ix.cols.join(", ")})`;
}

function checkTableAllowed(table, dbKey = null, kind = null) {
  const t = String(table).toLowerCase();
  if (WEBSITE_OWNED_TABLES.has(t) || WEBSITE_OWNED_PREFIXES.some((p) => t.startsWith(p))) {
    throw new SyncError("table-not-allowed", `The package tries to write website-owned table ${table}.`);
  }
  if (/__(stage|prev|undo|undo_new|rb)$/i.test(t)) {
    throw new SyncError("table-not-allowed", `Bad table name ${table}.`);
  }
  const def = shared.tableDef(table, dbKey, kind);
  if (!def) {
    throw new SyncError("table-not-allowed", `Table ${table} is not in the sync manifest.`);
  }
  return def;
}

/**
 * Map the batch's source column names to live column names
 * (case-insensitive) and apply the column rules.
 */
function mapColumns(table, batchColumns, live, key) {
  const out = [];
  const seen = new Set();
  for (const c of batchColumns) {
    const col = live.get(String(c).toLowerCase());
    if (!col) {
      throw new SyncError(
        "column-mismatch",
        `Column ${c} of ${table} is in the package but not on the website.`,
      );
    }
    if (seen.has(col.name.toLowerCase())) {
      throw new SyncError("column-mismatch", `Column ${c} of ${table} appears twice.`);
    }
    seen.add(col.name.toLowerCase());
    out.push(col.name);
  }
  if (String(table).toLowerCase() === "hr_employees") {
    // Only payroll columns (plus the key) may be written. Login data stays the website's.
    const allowed = new Set([
      ...shared.hrEmployeesPayrollColumns(),
      ...(key || []).map((k) => String(k).toLowerCase()),
    ]);
    const bad = out.filter((c) => !allowed.has(c.toLowerCase()));
    if (bad.length) {
      throw new SyncError(
        "column-not-allowed",
        `hr_employees columns not allowed in a package: ${bad.join(", ")}.`,
      );
    }
  }
  return out;
}

/**
 * Create <table>__stage for the first batch of a table.
 * Returns the stage descriptor used by the loader and the apply step.
 */
async function createStage({ dbKey, batch, kind = null }) {
  const schema = db.schemaFor(dbKey);
  const def = checkTableAllowed(batch.table, dbKey, kind);
  const mode = batch.mode || def.mode;
  if (!MODES.has(mode)) {
    throw new SyncError("bad-record", `Unknown mode ${mode} for ${batch.table}.`);
  }
  if (websiteKeeps(batch.table)) {
    // read and counted (so the package is verified), never loaded
    const kept = { dbKey, schema, table: batch.table, stage: null, mode, skip: true, key: [], columns: [], parts: new Map(), rows: 0, batches: 0, loadMs: 0 };
    await ensurePart(kept, batch);
    return kept;
  }
  const table = await resolveTableName(schema, batch.table);
  if (!table) {
    throw new SyncError("table-missing", `Table ${batch.table} does not exist in ${schema}.`);
  }
  const live = await liveColumns(schema, table);
  const manifestKey = (def.key || []).map((k) => {
    const c = live.get(String(k).toLowerCase());
    if (!c) throw new SyncError("column-mismatch", `Key column ${k} missing on ${schema}.${table}.`);
    return c.name;
  });
  const columns = mapColumns(table, batch.columns, live, manifestKey); // first part; others via ensurePart
  const stage = table + SUFFIX.stage;
  const qStage = db.qt(schema, stage);
  const qLive = db.qt(schema, table);

  await db.query(`DROP TABLE IF EXISTS ${qStage}`);

  let deferredIndexes = [];
  let key;
  if (mode === "swap") {
    await db.query(`CREATE TABLE ${qStage} LIKE ${qLive}`);
    deferredIndexes = await secondaryIndexes(schema, stage);
    if (deferredIndexes.length) {
      await db.query(
        `ALTER TABLE ${qStage} ${deferredIndexes.map((ix) => `DROP INDEX ${db.q(ix.name)}`).join(", ")}`,
      );
    }
    key = await primaryKey(schema, table);
  } else {
    key = manifestKey.length ? manifestKey : await primaryKey(schema, table);
    if (!key.length) {
      throw new SyncError("no-key", `${mode} needs a key for ${table}; none in the manifest or table.`);
    }
    // Same column types as live, only the columns that travel.
    await db.query(
      `CREATE TABLE ${qStage} ENGINE=InnoDB AS SELECT ${columns.map(db.q).join(", ")} FROM ${qLive} WHERE 1 = 0`,
    );
    await db.query(`ALTER TABLE ${qStage} ADD PRIMARY KEY (${key.map(db.q).join(", ")})`);
  }

  const st = {
    dbKey,
    schema,
    table,
    stage,
    mode,
    applyAt: def.applyAt || "prepare",
    key,
    manifestKey,
    live,
    columns: columns.slice(), // union of every part's columns (live names)
    parts: new Map(), // scopeKey → { scope, columns, rows, batches: [{batchNo, checksum}] }
    deferredIndexes,
    rows: 0,
    batches: 0,
    loadMs: 0,
  };
  await ensurePart(st, batch);
  return st;
}

/**
 * The part (scope) a batch belongs to. A new part may bring columns the
 * stage table does not have yet (another year's month columns): they are
 * added with the live column's type.
 */
async function ensurePart(st, batch) {
  const k = scopeKey(batch.scope);
  let part = st.parts.get(k);
  if (st.skip) {
    if (!part) {
      part = { scopeKey: k, scope: batch.scope && Object.keys(batch.scope).length ? batch.scope : null, columns: [], sourceColumns: batch.columns.slice(), rows: 0, batches: [] };
      st.parts.set(k, part);
    }
    return part;
  }
  if (part) {
    const same =
      batch.columns.length === part.sourceColumns.length &&
      batch.columns.every((c, i) => String(c).toLowerCase() === String(part.sourceColumns[i]).toLowerCase());
    if (!same) throw new SyncError("bad-record", `Batch ${batch.batchNo} of ${st.table} has different columns from its part.`);
    return part;
  }
  const cols = mapColumns(st.table, batch.columns, st.live, st.manifestKey);
  if (st.mode !== "swap") {
    const missingKey = st.key.filter((k2) => !cols.some((c) => c.toLowerCase() === k2.toLowerCase()));
    if (missingKey.length) {
      throw new SyncError("column-mismatch", `${st.table} batches must carry the key (${missingKey.join(", ")}).`);
    }
    const have = new Set(st.columns.map((c) => c.toLowerCase()));
    const add = cols.filter((c) => !have.has(c.toLowerCase()));
    if (add.length) {
      await db.query(
        `ALTER TABLE ${db.qt(st.schema, st.stage)} ${add
          .map((c) => `ADD COLUMN ${db.q(c)} ${st.live.get(c.toLowerCase()).ctype} NULL`)
          .join(", ")}`,
      );
      st.columns.push(...add);
    }
  }
  part = {
    scopeKey: k,
    scope: batch.scope && Object.keys(batch.scope).length ? batch.scope : null,
    columns: cols,
    sourceColumns: batch.columns.slice(),
    rows: 0,
    batches: [],
  };
  st.parts.set(k, part);
  return part;
}

/** After the last batch: add back the secondary indexes of a swap stage table. */
async function finishStage(st) {
  if (st.skip) return;
  if (st.deferredIndexes && st.deferredIndexes.length) {
    await db.query(
      `ALTER TABLE ${db.qt(st.schema, st.stage)} ${st.deferredIndexes.map((ix) => `ADD ${indexClause(ix)}`).join(", ")}`,
    );
  }
}

async function countRows(schema, table) {
  const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM ${db.qt(schema, table)}`);
  return Number(r.n);
}

/** Drop stage tables left by a failed run (live tables are never touched). */
async function dropStages(stages) {
  for (const st of stages) {
    if (st.skip || !st.stage) continue;
    try {
      await db.query(`DROP TABLE IF EXISTS ${db.qt(st.schema, st.stage)}`);
    } catch (_) {}
  }
}

module.exports = {
  SUFFIX,
  MODES,
  websiteKeeps,
  liveColumns,
  resolveTableName,
  primaryKey,
  secondaryIndexes,
  checkTableAllowed,
  mapColumns,
  createStage,
  ensurePart,
  scopeKey,
  finishStage,
  countRows,
  dropStages,
};
