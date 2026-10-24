// ============================================================
// Payslip Sync — Prepare: apply stage tables to live
// services/sync/merge.service.js
//
// Website contract, "Apply, Go live and roll back":
//   merge-columns  undo snapshot (sent columns of rows about to change)
//                  + list of new keys, then apply in chunks of 10,000 keys
//   replace-scope  undo snapshot of the period, then delete + insert in
//                  one transaction
//   swap (prepare) DROP __prev, RENAME live → __prev, __stage → live
// Nothing staff can see changes before the swap tables move at Go live:
// the new period's rows are not read until py_stdrate moves.
// ============================================================

const db = require("./db");
const { SUFFIX } = require("./staging.service");
const { SyncError } = require("./package.service");

const CHUNK_KEYS = 10000;

const qq = (cols, alias) => cols.map((c) => (alias ? `${alias}.${db.q(c)}` : db.q(c))).join(", ");
const onKeys = (key, a, b) => key.map((k) => `${a}.${db.q(k)} = ${b}.${db.q(k)}`).join(" AND ");

/** Key upper bounds that split the stage table into chunks of CHUNK_KEYS keys. */
async function* keyChunks(st, conn) {
  const qs = db.qt(st.schema, st.stage);
  const keyList = qq(st.key);
  let last = null;
  for (;;) {
    const where = last ? `WHERE (${keyList}) > (${last.map(() => "?").join(", ")})` : "";
    const [rows] = await conn.query(
      `SELECT ${keyList} FROM ${qs} ${where} ORDER BY ${keyList} LIMIT 1 OFFSET ${CHUNK_KEYS - 1}`,
      last || [],
    );
    const upper = rows.length ? st.key.map((k) => rows[0][k]) : null;
    yield { lower: last, upper };
    if (!upper) return;
    last = upper;
  }
}

function rangeWhere(key, alias, lower, upper) {
  const cols = `(${qq(key, alias)})`;
  const ph = (n) => `(${new Array(n).fill("?").join(", ")})`;
  const parts = [];
  const params = [];
  if (lower) {
    parts.push(`${cols} > ${ph(key.length)}`);
    params.push(...lower);
  }
  if (upper) {
    parts.push(`${cols} <= ${ph(key.length)}`);
    params.push(...upper);
  }
  return { sql: parts.length ? parts.join(" AND ") : "1 = 1", params };
}

// ── merge-columns ──────────────────────────────────────────

async function applyMerge(st) {
  const conn = await db.getConnection();
  try {
    const live = db.qt(st.schema, st.table);
    const stage = db.qt(st.schema, st.stage);
    const undo = db.qt(st.schema, st.table + SUFFIX.undo);
    const undoNew = db.qt(st.schema, st.table + SUFFIX.undoNew);
    const keyLower = new Set(st.key.map((k) => k.toLowerCase()));
    const sent = st.columns.filter((c) => !keyLower.has(c.toLowerCase()));

    await conn.query(`DROP TABLE IF EXISTS ${undo}, ${undoNew}`);
    // 2. rows about to change, sent columns only
    await conn.query(
      `CREATE TABLE ${undo} ENGINE=InnoDB AS
       SELECT ${qq([...st.key, ...sent], "t")} FROM ${live} t JOIN ${stage} s ON ${onKeys(st.key, "t", "s")}`,
    );
    await conn.query(`ALTER TABLE ${undo} ADD PRIMARY KEY (${qq(st.key)})`).catch(() => {});
    // 3. keys that are new
    await conn.query(
      `CREATE TABLE ${undoNew} ENGINE=InnoDB AS
       SELECT ${qq(st.key, "s")} FROM ${stage} s LEFT JOIN ${live} t ON ${onKeys(st.key, "t", "s")}
       WHERE t.${db.q(st.key[0])} IS NULL`,
    );
    await conn.query(`ALTER TABLE ${undoNew} ADD PRIMARY KEY (${qq(st.key)})`).catch(() => {});

    // 4. apply in chunks of 10,000 keys: update existing rows, insert new keys.
    //    Each part (scope, e.g. one his_year) writes only its own columns.
    const parts = st.parts && st.parts.size ? [...st.parts.values()] : [{ scope: null, columns: st.columns }];
    let updated = 0;
    let inserted = 0;
    for (const part of parts) {
      const pSent = part.columns.filter((c) => !keyLower.has(c.toLowerCase()));
      const sc = parts.length > 1 ? await scopeCond(st, part.scope, "s") : null;
      for await (const { lower, upper } of keyChunks(st, conn)) {
        const r = rangeWhere(st.key, "s", lower, upper);
        const where = sc ? `${r.sql} AND ${sc.sql}` : r.sql;
        const params = sc ? [...r.params, ...sc.params] : r.params;
        if (pSent.length) {
          const [u] = await conn.query(
            `UPDATE ${live} t JOIN ${stage} s ON ${onKeys(st.key, "t", "s")}
             SET ${pSent.map((c) => `t.${db.q(c)} = s.${db.q(c)}`).join(", ")}
             WHERE ${where}`,
            params,
          );
          updated += u.affectedRows;
        }
        const [i] = await conn.query(
          `INSERT INTO ${live} (${qq(part.columns)})
           SELECT ${qq(part.columns, "s")} FROM ${stage} s JOIN ${undoNew} n ON ${onKeys(st.key, "n", "s")}
           WHERE ${where}`,
          params,
        );
        inserted += i.affectedRows;
      }
    }
    const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM ${undo}`);
    return { mode: "merge-columns", changedRows: Number(c.n), updated, inserted, undo: true };
  } finally {
    conn.release();
  }
}

async function rollbackMerge(st) {
  if (!(await db.tableExists(st.schema, st.table + SUFFIX.undo))) return; // failed before any change
  const live = db.qt(st.schema, st.table);
  const undo = db.qt(st.schema, st.table + SUFFIX.undo);
  const undoNew = db.qt(st.schema, st.table + SUFFIX.undoNew);
  const keyLower = new Set(st.key.map((k) => k.toLowerCase()));
  const sent = st.columns.filter((c) => !keyLower.has(c.toLowerCase()));
  await db.transaction(async (c) => {
    if (sent.length) {
      await c.query(
        `UPDATE ${live} t JOIN ${undo} u ON ${onKeys(st.key, "t", "u")}
         SET ${sent.map((col) => `t.${db.q(col)} = u.${db.q(col)}`).join(", ")}`,
      );
    }
    // (key) IN (subquery): a multi-table DELETE with aliases needs a default database.
    await c.query(`DELETE FROM ${live} WHERE (${qq(st.key)}) IN (SELECT ${qq(st.key)} FROM ${undoNew})`);
  });
}

// ── replace-scope ──────────────────────────────────────────

/** `alias.col = ?` for one scope object, column names matched to live. */
async function scopeCond(st, scope, alias = null) {
  const cols = Object.keys(scope || {});
  if (!cols.length) return null;
  const live = st.live || (await require("./staging.service").liveColumns(st.schema, st.table));
  const parts = [];
  const params = [];
  for (const k of cols) {
    const col = live.get(k.toLowerCase());
    if (!col) throw new SyncError("column-mismatch", `Scope column ${k} missing on ${st.table}.`);
    parts.push(`${alias ? alias + "." : ""}${db.q(col.name)} = ?`);
    params.push(scope[k]);
  }
  return { sql: `(${parts.join(" AND ")})`, params };
}

/** Scopes of a stage (its parts) or of a recorded rollback step. */
function scopesOf(st) {
  if (st.parts && st.parts.size) return [...st.parts.values()].map((p) => p.scope);
  if (Array.isArray(st.scopes)) return st.scopes;
  return [st.scope || null];
}

/** WHERE for every scope of a replace-scope table, or null = whole table. */
async function scopeWhere(st) {
  const scopes = scopesOf(st);
  if (!scopes.length || scopes.some((sc) => !sc || !Object.keys(sc).length)) return null;
  const conds = [];
  for (const sc of scopes) conds.push(await scopeCond(st, sc));
  return { sql: conds.map((c) => c.sql).join(" OR "), params: conds.flatMap((c) => c.params) };
}

async function applyReplace(st) {
  const where = await scopeWhere(st);
  if (!where) {
    // No scope (full package): replace the whole table by swapping a full copy.
    return applyReplaceWhole(st);
  }
  const live = db.qt(st.schema, st.table);
  const stage = db.qt(st.schema, st.stage);
  const undo = db.qt(st.schema, st.table + SUFFIX.undo);

  await db.query(`DROP TABLE IF EXISTS ${undo}`);
  await db.query(`CREATE TABLE ${undo} ENGINE=InnoDB AS SELECT * FROM ${live} WHERE ${where.sql}`, where.params);
  const [[u]] = await db.query(`SELECT COUNT(*) AS n FROM ${undo}`);

  const out = await db.transaction(async (c) => {
    const [d] = await c.query(`DELETE FROM ${live} WHERE ${where.sql}`, where.params);
    const [i] = await c.query(
      `INSERT INTO ${live} (${qq(st.columns)}) SELECT ${qq(st.columns)} FROM ${stage}`,
    );
    return { deleted: d.affectedRows, inserted: i.affectedRows };
  });
  return { mode: "replace-scope", scopes: scopesOf(st), previousRows: Number(u.n), ...out, undo: true };
}

async function applyReplaceWhole(st) {
  // Build a full-shape copy (all columns, all indexes) and swap it in.
  const full = db.qt(st.schema, st.table + "__stagefull");
  await db.query(`DROP TABLE IF EXISTS ${full}`);
  await db.query(`CREATE TABLE ${full} LIKE ${db.qt(st.schema, st.table)}`);
  await db.query(
    `INSERT INTO ${full} (${qq(st.columns)}) SELECT ${qq(st.columns)} FROM ${db.qt(st.schema, st.stage)}`,
  );
  await db.query(`DROP TABLE ${db.qt(st.schema, st.stage)}`);
  await db.query(`RENAME TABLE ${full} TO ${db.qt(st.schema, st.stage)}`);
  await swapNow([st]);
  return { mode: "replace-scope", scope: null, swapped: true };
}

async function rollbackReplace(st) {
  const where = await scopeWhere(st);
  if (!where) return; // whole-table replace is rolled back by its __prev swap
  if (!(await db.tableExists(st.schema, st.table + SUFFIX.undo))) return;
  const live = db.qt(st.schema, st.table);
  const undo = db.qt(st.schema, st.table + SUFFIX.undo);
  await db.transaction(async (c) => {
    await c.query(`DELETE FROM ${live} WHERE ${where.sql}`, where.params);
    await c.query(`INSERT INTO ${live} SELECT * FROM ${undo}`);
  });
}

// ── swap ───────────────────────────────────────────────────

/**
 * DROP the old __prev tables, then one RENAME TABLE moving every given
 * table: live → __prev, __stage → live. All databases in one statement
 * (they share this MySQL server). Retries on lock wait timeout.
 */
async function swapNow(stages) {
  if (!stages.length) return;
  const conn = await db.getConnection();
  try {
    await conn.query("SET SESSION lock_wait_timeout = 30");
    const prevs = stages.map((st) => db.qt(st.schema, st.table + SUFFIX.prev));
    await conn.query(`DROP TABLE IF EXISTS ${prevs.join(", ")}`);
    const pairs = stages.flatMap((st) => [
      `${db.qt(st.schema, st.table)} TO ${db.qt(st.schema, st.table + SUFFIX.prev)}`,
      `${db.qt(st.schema, st.stage)} TO ${db.qt(st.schema, st.table)}`,
    ]);
    await retryLock(() => conn.query(`RENAME TABLE ${pairs.join(", ")}`));
  } finally {
    conn.release();
  }
}

/**
 * Swap back: live ↔ __prev through __rb in one statement, so the rollback
 * can itself be reversed.
 */
async function swapBack(tables) {
  if (!tables.length) return;
  const conn = await db.getConnection();
  try {
    await conn.query("SET SESSION lock_wait_timeout = 30");
    const rbs = tables.map((t) => db.qt(t.schema, t.table + SUFFIX.rb));
    await conn.query(`DROP TABLE IF EXISTS ${rbs.join(", ")}`);
    const pairs = tables.flatMap((t) => [
      `${db.qt(t.schema, t.table)} TO ${db.qt(t.schema, t.table + SUFFIX.rb)}`,
      `${db.qt(t.schema, t.table + SUFFIX.prev)} TO ${db.qt(t.schema, t.table)}`,
      `${db.qt(t.schema, t.table + SUFFIX.rb)} TO ${db.qt(t.schema, t.table + SUFFIX.prev)}`,
    ]);
    await retryLock(() => conn.query(`RENAME TABLE ${pairs.join(", ")}`));
  } finally {
    conn.release();
  }
}

async function retryLock(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const lockWait = e && (e.code === "ER_LOCK_WAIT_TIMEOUT" || e.errno === 1205);
      if (!lockWait || i >= tries) throw e;
    }
  }
}

module.exports = {
  CHUNK_KEYS,
  applyMerge,
  rollbackMerge,
  applyReplace,
  rollbackReplace,
  swapNow,
  swapBack,
};
