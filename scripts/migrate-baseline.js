// Mark migrations as already applied WITHOUT running them (a baseline), for a
// server whose schema was changed by hand before the migrations table was used.
// Database names come from the .env / environment (config.databases), and each
// migration's "-- @scope:" line decides which databases get it, as in migrate:up.
//
//   node scripts/migrate-baseline.js --before 20261021            dry run: list what would be marked
//   node scripts/migrate-baseline.js --before 20261021 --apply    write the rows
//   node scripts/migrate-baseline.js --only 20260211_111703 --apply   just that migration
//
// --before <prefix>  only migration files whose name sorts before this prefix
// --only <prefix>    only migration files whose name starts with this prefix
// Rows are written with batch 0, so migrate:down never tries to undo them.
// Already-recorded migrations are left alone.

const migrator = require("../config/sql/migrator");
const config = require("../config");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const before = arg("--before");
const only = arg("--only");
const apply = process.argv.includes("--apply");

async function main() {
  if (!before && !only) {
    console.log("Usage: node scripts/migrate-baseline.js (--before <prefix, e.g. 20261021> | --only <prefix>) [--apply]");
    process.exit(1);
  }
  console.log(apply ? "APPLY: writing baseline rows\n" : "DRY RUN: nothing is written (add --apply)\n");
  let total = 0;
  for (const [key, db] of Object.entries(config.databases)) {
    if (!db) continue;
    try {
      await migrator.connect(db);
      await migrator.ensureMigrationsTable();
      const pending = (await migrator.getPendingMigrations()).filter((f) => (before ? f < before : true) && (only ? f.startsWith(only) : true));
      console.log(`${key} (${db}): ${pending.length} to mark`);
      for (const f of pending) console.log(`   - ${f}`);
      if (apply && pending.length) {
        for (const f of pending) {
          await migrator.connection.query("INSERT IGNORE INTO migrations (name, batch) VALUES (?, 0)", [f]);
        }
        console.log("   ✓ marked");
      }
      total += pending.length;
    } finally {
      await migrator.disconnect();
    }
  }
  console.log(`\n${total} row(s) ${apply ? "written" : "would be written"}. Check with: npm run migrate:status`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
