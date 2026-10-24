// Payslip Sync — pre-Day-1 checks (plan §13.1).
//
//   node scripts/sync-preflight.js               read-only checks
//   node scripts/sync-preflight.js --probe-rename also test a Go-live RENAME as the sync user
//   node scripts/sync-preflight.js --probe-rename --as-admin   (local: test it with the app's own login)
//
// Admin connection: MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD (via config.js)
// Sync user:        SYNC_DB_USER (default sync_writer), SYNC_DB_HOST (default %), SYNC_DB_PASSWORD
//
// The rename probe works on a full copy of py_stdrate in every database, swaps it
// in and back in one RENAME TABLE (exactly what Go live does), then drops the copy.
// Live data is identical at every moment. Run it on staging only.

const mysql = require("mysql2/promise");
const config = require("../config");

const DBS = Object.entries(config.databases).filter(([, v]) => v);
const AS_ADMIN = process.argv.includes("--as-admin");
const SYNC_USER = AS_ADMIN ? config.mysql.user : process.env.SYNC_DB_USER || "sync_writer";
const SYNC_HOST = process.env.SYNC_DB_HOST || "%";
const PROBE = process.argv.includes("--probe-rename");
const NEED_PACKET = 16 * 1024 * 1024; // a 5,000-row multi-row INSERT needs headroom

let failures = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { failures++; console.log(`  ✘ ${m}`); };
const info = (m) => console.log(`    ${m}`);
const q = (s) => "`" + s.replace(/`/g, "``") + "`";

async function main() {
  const admin = await mysql.createConnection({
    host: config.mysql.host, port: config.mysql.port,
    user: config.mysql.user, password: config.mysql.password,
  });
  console.log(`Connected to ${config.mysql.host}:${config.mysql.port} as ${config.mysql.user}`);

  // ── Server settings ───────────────────────────────────────────────
  console.log("\nServer");
  const [[v]] = await admin.query(
    "SELECT VERSION() v, @@global.max_allowed_packet p, @@global.local_infile li, @@lower_case_table_names lc");
  info(`MySQL ${v.v}, lower_case_table_names=${v.lc}, local_infile=${v.li ? "ON" : "OFF"}`);
  if (v.p >= NEED_PACKET) ok(`max_allowed_packet = ${(v.p / 1048576).toFixed(0)} MB (need ≥ 16 MB)`);
  else bad(`max_allowed_packet = ${(v.p / 1048576).toFixed(1)} MB — raise to ≥ 16 MB (SET PERSIST max_allowed_packet = 67108864)`);

  // ── Server layout: are all six databases on this one server? ──────
  const [schemas] = await admin.query("SELECT SCHEMA_NAME s FROM INFORMATION_SCHEMA.SCHEMATA");
  const have = new Set(schemas.map((r) => r.s.toLowerCase()));
  const missing = DBS.filter(([, d]) => !have.has(d.toLowerCase()));
  if (!missing.length) ok(`all ${DBS.length} databases on this server — one RENAME TABLE can switch them together`);
  else bad(`not on this server: ${missing.map(([n, d]) => `${n} (${d})`).join(", ")} — Go live must switch per server`);

  // ── hr_employees coverage: master vs class copies ─────────────────
  const master = config.databases.officers;
  console.log(`\nhr_employees coverage (master ${master})`);
  if (have.has(String(master).toLowerCase())) {
    const [[m]] = await admin.query(`SELECT COUNT(*) n FROM ${q(master)}.hr_employees`);
    info(`master: ${m.n} rows`);
    for (const [name, db] of DBS) {
      if (db === master || !have.has(db.toLowerCase())) continue;
      try {
        const [[c]] = await admin.query(
          `SELECT COUNT(*) n,
                  SUM(NOT EXISTS (SELECT 1 FROM ${q(master)}.hr_employees m WHERE m.Empl_ID = e.Empl_ID)) miss
           FROM ${q(db)}.hr_employees e`);
        if (!Number(c.miss)) ok(`${name}: ${c.n} rows, all present in master`);
        else bad(`${name}: ${c.n} rows, ${c.miss} not in master hr_employees`);
      } catch (e) {
        if (/doesn't exist/i.test(e.message)) info(`${name}: no hr_employees here (the website keeps it in ${master} only)`);
        else bad(`${name}: ${e.message}`);
      }
    }
  }

  // ── Per database ──────────────────────────────────────────────────
  for (const [name, db] of DBS) {
    console.log(`\n${name} (${db})`);
    const [[t]] = await admin.query(
      "SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='py_ipis_payhistory'", [db]);
    if (!t.n) { bad("py_ipis_payhistory missing (a package that carries it for this database would fail)"); continue; }

    const [cols] = await admin.query(
      `SELECT COLUMN_NAME c, COLUMN_TYPE t, IS_NULLABLE n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='py_ipis_payhistory' AND COLUMN_NAME IN ('period','numb','Type')`, [db]);
    info("key columns: " + cols.map((c) => `${c.c} ${c.t}${c.n === "YES" ? " NULL" : ""}`).join(", "));
    if (cols.length !== 3) bad("expected columns period, numb, Type");
    for (const c of cols) if (/text|blob/i.test(c.t)) bad(`${c.c} is ${c.t} — cannot be in a primary key without a prefix`);

    const [[cnt]] = await admin.query(`SELECT COUNT(*) n FROM ${q(db)}.py_ipis_payhistory`);
    const [[dup]] = await admin.query(
      `SELECT COUNT(*) groups_, COALESCE(SUM(c),0) rows_ FROM (
         SELECT COUNT(*) c FROM ${q(db)}.py_ipis_payhistory GROUP BY period, numb, Type HAVING COUNT(*) > 1) d`);
    const [[nul]] = await admin.query(
      `SELECT COUNT(*) n FROM ${q(db)}.py_ipis_payhistory WHERE period IS NULL OR numb IS NULL OR Type IS NULL`);
    if (dup.groups_ === 0 && nul.n === 0) ok(`py_ipis_payhistory: ${cnt.n} rows, no duplicate or NULL keys`);
    else {
      if (dup.groups_) bad(`py_ipis_payhistory: ${dup.groups_} duplicate keys covering ${dup.rows_} rows`);
      if (nul.n) bad(`py_ipis_payhistory: ${nul.n} rows with a NULL key column`);
      const [ex] = await admin.query(
        `SELECT period, numb, Type, COUNT(*) c FROM ${q(db)}.py_ipis_payhistory
         GROUP BY period, numb, Type HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 5`);
      ex.forEach((r) => info(`e.g. ${r.period} / ${r.numb} / ${r.Type} × ${r.c}`));
    }

    const [idx] = await admin.query(
      `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('py_ipis_payhistory','py_webpayslip','py_masterpayded','py_mastercum','py_payhistory')
       GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`, [db]);
    idx.forEach((r) => info(`index ${r.t}.${r.i}${r.nu ? "" : " (unique)"} (${r.cols})`));
  }

  // ── Sync user ─────────────────────────────────────────────────────
  console.log(`\nSync user '${SYNC_USER}'@'${SYNC_HOST}'`);
  const [[u]] = await admin.query("SELECT COUNT(*) n FROM mysql.user WHERE User=? AND Host=?", [SYNC_USER, SYNC_HOST])
    .catch(() => [[{ n: -1 }]]);
  if (u.n === 0) bad("user does not exist yet");
  else {
    try {
      const [g] = await admin.query(`SHOW GRANTS FOR ?@?`, [SYNC_USER, SYNC_HOST]);
      g.forEach((r) => info(Object.values(r)[0]));
      const all = g.map((r) => Object.values(r)[0]).join("\n").toUpperCase();
      for (const p of ["ALTER", "DROP", "CREATE", "INSERT"])
        if (!all.includes(p) && !all.includes("ALL PRIVILEGES")) bad(`no ${p} grant seen — RENAME TABLE needs ALTER+DROP on the old name, CREATE+INSERT on the new`);
    } catch (e) { bad(`SHOW GRANTS failed: ${e.message}`); }
  }
  await admin.end();

  // ── Rename probe (as the sync user) ───────────────────────────────
  if (PROBE) {
    console.log("\nRENAME TABLE probe (as sync user, py_stdrate in all databases)");
    const syncPass = process.env.SYNC_DB_PASSWORD ?? (SYNC_USER === config.mysql.user ? config.mysql.password : undefined);
    if (syncPass === undefined) bad("set SYNC_DB_PASSWORD to run the probe");
    else {
      const s = await mysql.createConnection({
        host: config.mysql.host, port: config.mysql.port,
        user: SYNC_USER, password: syncPass,
      });
      const live = (d) => `${q(d)}.py_stdrate`, stage = (d) => `${q(d)}.py_stdrate__stage`, prev = (d) => `${q(d)}.py_stdrate__prev`;
      try {
        for (const [, d] of DBS) {
          await s.query(`DROP TABLE IF EXISTS ${stage(d)}`);
          await s.query(`CREATE TABLE ${stage(d)} LIKE ${live(d)}`);
          await s.query(`INSERT INTO ${stage(d)} SELECT * FROM ${live(d)}`);
        }
        const swap = DBS.flatMap(([, d]) => [`${live(d)} TO ${prev(d)}`, `${stage(d)} TO ${live(d)}`, `${prev(d)} TO ${stage(d)}`]).join(", ");
        const t0 = Date.now();
        await s.query(`RENAME TABLE ${swap}`); // go live
        await s.query(`RENAME TABLE ${swap}`); // and back
        ok(`atomic RENAME across ${DBS.length} databases works (2 swaps in ${Date.now() - t0} ms)`);
      } catch (e) { bad(`probe failed: ${e.code || ""} ${e.message}`); }
      finally {
        for (const [, d] of DBS) await s.query(`DROP TABLE IF EXISTS ${stage(d)}`).catch(() => {});
        await s.end();
      }
    }
  }

  console.log(failures ? `\n${failures} problem(s) found.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("Preflight error:", e.message); process.exit(2); });
