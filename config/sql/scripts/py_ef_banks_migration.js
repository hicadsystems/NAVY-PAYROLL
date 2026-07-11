/**
 * FILE: migrations/scripts/py_ef_banks_migration.js
 *
 * PURPOSE:
 * Mirgates py_bank (payroll banking info, which is banks and their branches accepted by payroll) to ef_banks and ef_bank_branches.
 *
 *
 * CONTEXT:
 *  This is a script that copies recent info on py_bank to ef_banks and ef_bank_branches. It is intended to run multiple times, possibly as part of the emol scheduler,
 *  preferably before each emolument cycle is started. It is idempotent, so it can be run multiple times without creating duplicates.
 *  This is done because the payroll is the source of truth for banking info, and ef_banks and ef_bank_branches are used by the emolument form to validate banking info.
 *
 *
 * WHAT IS CONSTRUCTED:
 * - ef_banks: a table of banks accepted by payroll, with their codes and names(if it does not exist, it is created)
 * - ef_bank_branches: a table of bank branches accepted by payroll, with their codes and names(if it does not exist, it is created)
 * - py_bank: a table of banks and their branches accepted by payroll, with their codes and names. structure is as follows:
 *      bankcode: the code of the bank. this is the primary key of ef_banks and a foreign key in ef_bank_branches. corresponding colums is bankcode in both ef_banks and ef_bank_branches.
 *      bankname: the name of the bank. corresponding is bankname in ef_banks.
 *      branchcode: the code of the branch. corresponding column is branchcode in ef_bank_branches.
 *      branchname: the name of the branch. corresponding column is branchname in ef_bank_branches.
 * - the primary key in ef_bank_branches is a composite of bankcode and branchcode, which is the same as the PK in py_bank.
 *
 * CONFLICT RESOLUTION (py_bank can have the same bankcode/branchcode paired
 * with more than one name):
 *  - For each bankcode, the bankname with the most occurrences in py_bank
 *    wins; ties are broken alphabetically for determinism.
 *  - Same logic applies per (bankcode, branchcode) for branchname.
 *  - Every conflict is logged to stderr via console.warn so it can be
 *    reviewed, but the migration does not halt on conflicts.
 *  - ef_banks/ef_bank_branches rows are upserted (INSERT ... ON DUPLICATE
 *    KEY UPDATE), so payroll's current data always overwrites the stored
 *    name on each run — payroll is the source of truth.
 *
 *
 * SAFETY:
 * - This script is idempotent, so it can be run multiple times without creating duplicates.
 * - It is safe to run this script even if ef_banks and ef_bank_branches already exist, as it will only insert new records that do not already exist.
 *
 * USAGE:
 *   node migrations/scripts/py_ef_banks_migration.js
 *   $env:DRY_RUN="true"; node migrations/scripts/py_ef_banks_migration.js
 *   $env:BATCH_SIZE="50"; node migrations/scripts/py_ef_banks_migration.js
 *   call and run in emolument.scheduler.js
 *
 * RUN ORDER:
 *   Run at any time, preferably before each emolument cycle is started, and as server is starting up.
 */

"use strict";

// ── Direct MySQL connection — bypasses the shared async pool ──
// This makes the script fully self-contained and runnable
// without waiting for pool initialisation to complete.
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../.env.local"),
});

console.log(__dirname, "../../.env");

const DRY_RUN = process.env.DRY_RUN === "true";
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 100;

// Read connection details from env (loaded by dotenv in your project)
const DB_HOST = process.env.MYSQL_HOST;
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER;
const DB_PASS = process.env.MYSQL_PASSWORD;
const DB_NAME = process.env.MYSQL_DB_OFFICERS;

if (!DB_NAME) {
  console.error(
    "❌ MYSQL_DB_OFFICERS env var is not set. Check your .env.local file.",
  );
  process.exit(1);
}

// Create connection (not pool — single connection for a migration is fine)
async function getConnection() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    dateStrings: true,
    timezone: "local",
    connectTimeout: 30000,
  });
  return conn;
}

// Thin query wrapper — uses query() not execute() so LIMIT/OFFSET
// integer params work correctly and missing optional columns don't
// cause prepared-statement type errors.
async function q(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return [rows];
}

// Check if py_bank table exists
async function checkPyBankTableExists(conn) {
  const [rows] = await q(conn, `SHOW TABLES LIKE 'py_bank'`);
  return rows.length > 0;
}

async function checkEfBanksTableExists(conn) {
  const [rows] = await q(conn, `SHOW TABLES LIKE 'ef_banks'`);
  return rows.length > 0;
}

async function checkEfBankBranchesTableExists(conn) {
  const [rows] = await q(conn, `SHOW TABLES LIKE 'ef_bank_branches'`);
  return rows.length > 0;
}

async function createEfBanksTable(conn) {
  const createTableSQL = `
    CREATE TABLE ef_banks (
      bankcode VARCHAR(10) PRIMARY KEY,
      bankname VARCHAR(255) NOT NULL
    );
  `;
  await q(conn, createTableSQL);
  console.log("✅ ef_banks table created.");
}

async function createEfBankBranchesTable(conn) {
  const createTableSQL = `
    CREATE TABLE ef_bank_branches (
        bankcode VARCHAR(10) NOT NULL,
        branchcode VARCHAR(10) NOT NULL,
        branchname VARCHAR(255) NOT NULL,
        PRIMARY KEY (bankcode, branchcode),
        FOREIGN KEY (bankcode) REFERENCES ef_banks(bankcode)
    );
  `;
  await q(conn, createTableSQL);
  console.log("✅ ef_bank_branches table created.");
}

// ── Chunking helper for BATCH_SIZE-limited multi-row upserts ──
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Reads py_bank and reduces it to one canonical {bankcode, bankname} row
 * per bankcode. When a bankcode maps to more than one bankname in
 * py_bank, the name with the most occurrences wins (ties broken
 * alphabetically); conflicts are logged for manual review.
 */
async function fetchCanonicalBanks(conn) {
  const [rows] = await q(
    conn,
    `SELECT bankcode, bankname, COUNT(*) AS cnt
     FROM py_bank
     WHERE bankcode IS NOT NULL AND bankcode <> ''
     GROUP BY bankcode, bankname
     ORDER BY bankcode, cnt DESC, bankname ASC`,
  );

  const byCode = new Map();
  for (const row of rows) {
    if (!byCode.has(row.bankcode)) {
      byCode.set(row.bankcode, row);
    } else {
      console.warn(
        `⚠️  bankcode ${row.bankcode} has conflicting bankname "${row.bankname}" ` +
          `in py_bank (using "${byCode.get(row.bankcode).bankname}" instead).`,
      );
    }
  }

  return Array.from(byCode.values()).map((r) => ({
    bankcode: r.bankcode,
    bankname: r.bankname,
  }));
}

/**
 * Reads py_bank and reduces it to one canonical
 * {bankcode, branchcode, branchname} row per (bankcode, branchcode).
 * Same most-frequent-wins conflict resolution as fetchCanonicalBanks.
 * Rows with a null/empty branchcode are skipped (nothing to key a branch
 * record on).
 */
async function fetchCanonicalBranches(conn) {
  const [rows] = await q(
    conn,
    `SELECT bankcode, branchcode, branchname, COUNT(*) AS cnt
     FROM py_bank
     WHERE bankcode IS NOT NULL AND bankcode <> ''
       AND branchcode IS NOT NULL AND branchcode <> ''
     GROUP BY bankcode, branchcode, branchname
     ORDER BY bankcode, branchcode, cnt DESC, branchname ASC`,
  );

  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.bankcode}::${row.branchcode}`;
    if (!byKey.has(key)) {
      byKey.set(key, row);
    } else {
      console.warn(
        `⚠️  bank/branch ${row.bankcode}/${row.branchcode} has conflicting ` +
          `branchname "${row.branchname}" in py_bank (using "${byKey.get(key).branchname}" instead).`,
      );
    }
  }

  return Array.from(byKey.values()).map((r) => ({
    bankcode: r.bankcode,
    branchcode: r.branchcode,
    branchname: r.branchname,
  }));
}

/**
 * Upserts canonical bank rows into ef_banks, BATCH_SIZE rows at a time.
 * Must run before upsertBankBranches, since ef_bank_branches.bankcode
 * has a FK reference to ef_banks.bankcode.
 */
async function upsertBanks(conn, banks) {
  if (!banks.length) {
    console.log("No banks to upsert.");
    return;
  }

  for (const batch of chunk(banks, BATCH_SIZE)) {
    if (DRY_RUN) {
      console.log(
        `[DRY RUN] Would upsert ${batch.length} bank(s): ` +
          batch.map((b) => b.bankcode).join(", "),
      );
      continue;
    }

    const placeholders = batch.map(() => "(?, ?)").join(", ");
    const params = batch.flatMap((b) => [b.bankcode, b.bankname]);

    await q(
      conn,
      `INSERT INTO ef_banks (bankcode, bankname)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE bankname = VALUES(bankname)`,
      params,
    );
  }

  console.log(
    `${DRY_RUN ? "[DRY RUN] Would have upserted" : "✅ Upserted"} ${banks.length} bank(s) into ef_banks.`,
  );
}

/**
 * Upserts canonical bank-branch rows into ef_bank_branches, BATCH_SIZE
 * rows at a time. Must run after upsertBanks (see FK note above).
 */
async function upsertBankBranches(conn, branches) {
  if (!branches.length) {
    console.log("No bank branches to upsert.");
    return;
  }

  for (const batch of chunk(branches, BATCH_SIZE)) {
    if (DRY_RUN) {
      console.log(
        `[DRY RUN] Would upsert ${batch.length} branch(es): ` +
          batch.map((b) => `${b.bankcode}/${b.branchcode}`).join(", "),
      );
      continue;
    }

    const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
    const params = batch.flatMap((b) => [
      b.bankcode,
      b.branchcode,
      b.branchname,
    ]);

    await q(
      conn,
      `INSERT INTO ef_bank_branches (bankcode, branchcode, branchname)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE branchname = VALUES(branchname)`,
      params,
    );
  }

  console.log(
    `${DRY_RUN ? "[DRY RUN] Would have upserted" : "✅ Upserted"} ${branches.length} branch(es) into ef_bank_branches.`,
  );
}

async function run() {
  const conn = await getConnection();

  try {
    // py_bank is the source of truth — if it's missing there is nothing
    // to migrate from, so fail loudly rather than silently no-op.
    const pyBankExists = await checkPyBankTableExists(conn);
    if (!pyBankExists) {
      throw new Error(
        "py_bank table does not exist. Cannot run py_bank → ef_banks migration.",
      );
    }

    const efBanksExists = await checkEfBanksTableExists(conn);
    if (!efBanksExists) {
      if (DRY_RUN) {
        console.log("[DRY RUN] Would create ef_banks table.");
      } else {
        await createEfBanksTable(conn);
      }
    }

    const efBankBranchesExists = await checkEfBankBranchesTableExists(conn);
    if (!efBankBranchesExists) {
      if (DRY_RUN) {
        console.log("[DRY RUN] Would create ef_bank_branches table.");
      } else {
        await createEfBankBranchesTable(conn);
      }
    }

    console.log("🔍 Reading canonical bank list from py_bank...");
    const banks = await fetchCanonicalBanks(conn);
    console.log(`Found ${banks.length} distinct bank code(s).`);

    console.log("🔍 Reading canonical branch list from py_bank...");
    const branches = await fetchCanonicalBranches(conn);
    console.log(`Found ${branches.length} distinct bank/branch code pair(s).`);

    // Banks first — ef_bank_branches.bankcode has an FK reference to
    // ef_banks.bankcode.
    await upsertBanks(conn, banks);
    await upsertBankBranches(conn, branches);

    console.log("✅ py_bank → ef_banks / ef_bank_branches migration complete.");
  } finally {
    await conn.end();
  }
}

// Runnable both as a CLI script (`node py_ef_banks_migration.js`) and as
// an importable module (e.g. from emolument.scheduler.js).
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}

module.exports = { run };
