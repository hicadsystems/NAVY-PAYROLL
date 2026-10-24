// ============================================================
// Payslip Sync — system checks for the Console's Checks tab
// services/sync/checks.service.js
//
// Same checks as scripts/sync-preflight.js, run with the login the website
// itself uses for sync (services/sync/db.js), so they test exactly what an
// upload and a Go live will need. Read-only, except the Go-live switch test,
// which swaps a copy of py_stdrate in and straight back.
// ============================================================

const db = require("./db");
const shared = require("./shared");
const schema = require("./schema");
const pkgSvc = require("./package.service");

const NEED_PACKET = 16 * 1024 * 1024;

function item(group, label, status, detail = "") {
  return { group, label, status, detail };
}

async function tablesIn(schemaName) {
  const [rows] = await db.query(
    "SELECT LOWER(TABLE_NAME) AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
    [schemaName],
  );
  return new Set(rows.map((r) => r.t));
}

/** All checks; never throws (each problem becomes a "fail" item). */
async function systemChecks() {
  const out = [];
  const add = (...a) => out.push(item(...a));

  // ── library and key ──
  let lib = null;
  try {
    lib = shared.lib();
    add("Setup", "Payslip sync library", "ok", `navy-payslip-sync ${lib.version || ""}`.trim());
  } catch (e) {
    add("Setup", "Payslip sync library", "fail", e.message);
  }
  try {
    const wk = pkgSvc.websiteKey();
    add("Setup", "Website private key", "ok", `key id ${pkgSvc.formatKeyId(wk.keyId)}`);
  } catch (e) {
    add("Setup", "Website private key", "fail", e.message);
  }

  try {
    await schema.checkControlTables(db);
    add("Setup", "Sync control tables", "ok", `in ${db.masterSchema()}`);
  } catch (e) {
    add("Setup", "Sync control tables", "fail", e.message);
  }

  // ── server ──
  const login = db.loginSettings();
  try {
    const [[v]] = await db.query("SELECT VERSION() v, @@max_allowed_packet p, CURRENT_USER() u");
    add("Server", "Database login used by sync", "ok", `${v.u} on ${login.host}:${login.port} (MySQL ${v.v})`);
    add(
      "Server",
      "max_allowed_packet",
      Number(v.p) >= NEED_PACKET ? "ok" : "fail",
      `${Math.round(Number(v.p) / 1048576)} MB${Number(v.p) >= NEED_PACKET ? "" : " — needs at least 16 MB"}`,
    );
  } catch (e) {
    add("Server", "Database login used by sync", "fail", e.message);
    return out;
  }

  // ── databases on this server ──
  const [schemas] = await db.query("SELECT LOWER(SCHEMA_NAME) AS s FROM INFORMATION_SCHEMA.SCHEMATA");
  const have = new Set(schemas.map((r) => r.s));
  const missingDb = db.DATABASE_KEYS.filter((k) => {
    try {
      return !have.has(db.schemaFor(k).toLowerCase());
    } catch (_) {
      return true;
    }
  });
  add(
    "Server",
    "All six payroll databases on this server",
    missingDb.length ? "fail" : "ok",
    missingDb.length ? `missing: ${missingDb.join(", ")}` : "one Go live switches them together",
  );


  // ── tables a package writes, per database ──
  for (const k of db.DATABASE_KEYS) {
    let name;
    try {
      name = db.schemaFor(k);
    } catch (_) {
      continue;
    }
    if (!have.has(name.toLowerCase())) continue;
    const t = await tablesIn(name);
    const group = `${k} (${name})`;
    if (lib && lib.manifest && typeof lib.manifest.tablesFor === "function") {
      const want = lib.manifest.tablesFor(k, "month").map((x) => String(x.name || x.table));
      const missing = want.filter((x) => !t.has(x.toLowerCase()));
      if (!missing.length) add(group, "Tables a package writes", "ok", `${want.length} tables present`);
      else {
        const hrOnly = missing.length === 1 && missing[0].toLowerCase() === "hr_employees" && k !== db.MASTER_KEY;
        add(
          group,
          "Tables a package writes",
          hrOnly ? "warn" : "fail",
          `missing: ${missing.join(", ")}` +
            (missing.some((x) => x.toLowerCase() === "hr_employees") && k !== db.MASTER_KEY
              ? ` — hr_employees lives only in ${db.masterSchema()} on this website; agree with Dev A where a package should write it`
              : " — a package that carries them for this database will fail"),
        );
      }
    }
    if (t.has("py_ipis_payhistory")) {
      const [[pk]] = await db.query(
        `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'py_ipis_payhistory' AND INDEX_NAME = 'PRIMARY'`,
        [name],
      );
      add(
        group,
        "py_ipis_payhistory primary key",
        pk && pk.c ? "ok" : "fail",
        pk && pk.c ? `(${pk.c})` : "missing — run npm run migrate:up all (it reports duplicate keys if any)",
      );
    }
    if (k === db.MASTER_KEY && t.has("hr_employees")) {
      const [[c]] = await db.query(`SELECT COUNT(*) n FROM ${db.qt(name, "hr_employees")}`);
      add(group, "hr_employees (staff and logins)", "ok", `${Number(c.n).toLocaleString()} staff`);
    }
  }

  // ── grants of the sync login ──
  try {
    const [g] = await db.query("SHOW GRANTS FOR CURRENT_USER()");
    const all = g.map((r) => Object.values(r)[0]).join("\n").toUpperCase();
    const allPriv = all.includes("ALL PRIVILEGES");
    const lacking = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX"].filter((p) => !allPriv && !all.includes(p));
    add(
      "Server",
      "Rights needed for loading and Go live",
      lacking.length ? "fail" : "ok",
      lacking.length ? `missing: ${lacking.join(", ")}` : allPriv ? "full rights (fine locally; use the restricted sync_writer user on staging and production)" : "granted",
    );
  } catch (e) {
    add("Server", "Rights needed for loading and Go live", "warn", e.message);
  }

  return out;
}

/**
 * Go-live switch test: copy py_stdrate to py_stdrate__stage in every database,
 * swap it in and straight back in one RENAME TABLE each time (exactly what Go
 * live does), then drop the copy. Live data is identical at every moment.
 */
async function probeGoLiveSwitch() {
  const run = require("./run.service");
  return run.withLock(async () => {
    // A prepared month keeps its new py_stdrate in py_stdrate__stage until Go live.
    // (only the latest run can still go live; an older prepared run is stale)
    const latest = await require("./golive.service").latestEffectiveRun().catch(() => null);
    if (latest && latest.status === "prepared") {
      return item("Go live", "Switch test", "warn", "skipped: a month is prepared and waiting for Go live; its tables are not touched");
    }
    const dbs = [];
    for (const k of db.DATABASE_KEYS) {
      try {
        const s = db.schemaFor(k);
        if (await db.tableExists(s, "py_stdrate")) dbs.push(s);
      } catch (_) {}
    }
    if (!dbs.length) return item("Go live", "Switch test", "fail", "no py_stdrate table found");
    const live = (d) => db.qt(d, "py_stdrate");
    const stage = (d) => db.qt(d, "py_stdrate__stage");
    // swap through __rb (only ever exists for a moment inside a roll back), so the
    // __prev copies kept for rolling back the last Go live are never touched
    const tmp = (d) => db.qt(d, "py_stdrate__rb");
    const conn = await db.getConnection();
    try {
      await conn.query("SET SESSION lock_wait_timeout = 30");
      for (const d of dbs) {
        await conn.query(`DROP TABLE IF EXISTS ${stage(d)}, ${tmp(d)}`);
        await conn.query(`CREATE TABLE ${stage(d)} LIKE ${live(d)}`);
        await conn.query(`INSERT INTO ${stage(d)} SELECT * FROM ${live(d)}`);
      }
      const swap = dbs.flatMap((d) => [`${live(d)} TO ${tmp(d)}`, `${stage(d)} TO ${live(d)}`, `${tmp(d)} TO ${stage(d)}`]).join(", ");
      const t0 = Date.now();
      await conn.query(`RENAME TABLE ${swap}`);
      await conn.query(`RENAME TABLE ${swap}`);
      return item("Go live", "Switch test", "ok", `one RENAME TABLE across ${dbs.length} databases works (two swaps in ${Date.now() - t0} ms)`);
    } catch (e) {
      return item("Go live", "Switch test", "fail", `${e.code || ""} ${e.message}`.trim());
    } finally {
      for (const d of dbs) await conn.query(`DROP TABLE IF EXISTS ${stage(d)}`).catch(() => {});
      conn.release();
    }
  });
}

module.exports = { systemChecks, probeGoLiveSwitch };
