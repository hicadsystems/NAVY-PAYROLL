// Prints the SQL that creates the restricted sync_writer MySQL user
// (Security: "Website writes use a sync_writer user limited to the
// manifest tables, their __stage and __prev copies, and the sync_* tables").
//
//   node scripts/sync-grants.js [user] [host] > sync-grants.sql
//   (review, set a password, run as an admin)
//
// Run the migrations first (the sync_* control tables must exist: their
// grants have no CREATE). Grants on __stage/__prev/… tables that do not exist
// yet are accepted because those grants include CREATE.

const config = require("../config");

const user = process.argv[2] || process.env.SYNC_DB_USER || "sync_writer";
const host = process.argv[3] || "%";

const MANIFEST_TABLES = [
  "ac_months", "py_elementtype", "py_bank", "py_pfa", "ac_businessline", "ac_costcentre",
  "hr_employees", "py_ipis_payhistory", "py_payhistory",
  "py_masterpayded", "py_mastercum", "py_stdrate", "py_payrollclass",
];
const COPIES = ["", "__stage", "__prev", "__undo", "__undo_new", "__rb", "__stagefull"];
const CONTROL = ["sync_exporters", "sync_packages", "sync_upload_chunks", "sync_runs", "sync_table_state", "sync_publications"];
const RW = "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX";
const q = (s) => "`" + s + "`";

const out = [];
out.push(`-- Payslip Sync: restricted MySQL user for the website side`);
out.push(`CREATE USER IF NOT EXISTS '${user}'@'${host}' IDENTIFIED BY '<set a strong password>';`);
for (const schema of Object.values(config.databases).filter(Boolean)) {
  out.push(`\n-- ${schema}`);
  for (const t of MANIFEST_TABLES) {
    for (const c of COPIES) out.push(`GRANT ${RW} ON ${q(schema)}.${q(t + c)} TO '${user}'@'${host}';`);
  }
}
const master = config.databases.officers;
out.push(`\n-- control tables (master ${master})`);
for (const t of CONTROL) out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(master)}.${q(t)} TO '${user}'@'${host}';`);
out.push(`\n-- RENAME TABLE needs ALTER + DROP on the old name and CREATE + INSERT on the new one (granted above).`);
out.push(`-- Then in .env: SYNC_DB_USER=${user}  SYNC_DB_PASSWORD=<the password>`);
console.log(out.join("\n"));
