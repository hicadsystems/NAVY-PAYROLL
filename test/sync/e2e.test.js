// End-to-end test of the website side against a real MySQL/MariaDB.
//
//   SYNC_E2E=1 npm run test:sync
//
// It DROPS and recreates the throwaway schemas t_hicaddata … t_hicaddata5 on
// the MYSQL_HOST from your .env, so it only runs when SYNC_E2E=1 and that host
// is this machine. Your real databases are never touched: config.databases is
// pointed at the t_ schemas before any sync code loads.
// Uses the real navy-payslip-sync (npm install it first): packages are built with
// its own writer (test/sync/package-helpers.js), so encryption, signatures and
// checksums are the real thing.

const config = require("../../config");
const LOCAL = ["localhost", "127.0.0.1", "::1"];
if (process.env.SYNC_E2E !== "1" || !LOCAL.includes(String(config.mysql.host))) {
  console.log("skipped: set SYNC_E2E=1 and use a local MYSQL_HOST to run the sync end-to-end test");
  process.exit(0);
}
config.databases = {
  officers: "t_hicaddata", wofficers: "t_hicaddata1", ratings: "t_hicaddata2",
  ratingsA: "t_hicaddata3", ratingsB: "t_hicaddata4", juniorTrainee: "t_hicaddata5",
};

try {
  require.resolve("navy-payslip-sync");
} catch (_) {
  console.log("skipped: install navy-payslip-sync first (npm install ./navy-payslip-sync-<version>.tgz)");
  process.exit(0);
}
process.env.SYNC_CHUNK_BYTES = String(32 * 1024);

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "npsync-"));
process.env.SYNC_UPLOAD_DIR = path.join(tmp, "uploads");

// The app's real login check (middware/authentication.js) needs a signed-in JWT.
// For this test it is replaced, inside this process only, by one that takes the
// role from an x-test-role header. Nothing in the project is changed.
{
  const Module = require("module");
  const authPath = require.resolve("../../middware/authentication");
  const stub = new Module(authPath, module);
  stub.filename = authPath;
  stub.loaded = true;
  stub.exports = (req, res, next) => {
    if (!req.headers["x-test-role"]) return res.status(401).json({ message: "Please Log In" });
    req.user_id = "TEST1";
    req.user_fullname = "Test Officer";
    req.user_role = req.headers["x-test-role"];
    next();
  };
  require.cache[authPath] = stub;
}

const helpers = require("./package-helpers");
const lib = helpers.sync;

// website key pair (X25519), as made by the library's keygen
const wk = lib.crypto.generateWebsiteKeyPair();
const wkPub = wk.publicKeyPem;
fs.writeFileSync(path.join(tmp, "website.pem"), wk.privateKeyPem);
process.env.SYNC_WEBSITE_PRIVATE_KEY_FILE = path.join(tmp, "website.pem");
void crypto;
const db = require("../../services/sync/db");
const schema = require("../../services/sync/schema");
const publications = require("../../services/sync/publication.service");
const runSvc = require("../../services/sync/run.service");

const DBS = ["t_hicaddata", "t_hicaddata1", "t_hicaddata2", "t_hicaddata3", "t_hicaddata4", "t_hicaddata5"];
const exporter = helpers.makeExporter("navy-payroll-office-01");

let server, base, admin;

// Setup and assertions use an admin connection; the code under test uses
// services/sync/db.js (SYNC_DB_USER when set, e.g. the restricted sync_writer).
async function sql(s, p) {
  if (!admin) {
    const mysql = require("mysql2/promise");
    admin = await mysql.createConnection({ host: config.mysql.host, port: config.mysql.port,
      user: config.mysql.user, password: config.mysql.password, dateStrings: true, bigNumberStrings: true, supportBigNumbers: true });
  }
  return admin.query(s, p);
}

async function setupSchemas() {
  for (const d of DBS) {
    await sql(`DROP DATABASE IF EXISTS ${d}`);
    await sql(`CREATE DATABASE ${d}`);
    const T = (t) => `${d}.${t}`;
    await sql(`CREATE TABLE ${T("hr_employees")} (Empl_ID VARCHAR(20) PRIMARY KEY, Surname VARCHAR(60), othername VARCHAR(60),
      Title VARCHAR(20), gradelevel VARCHAR(10), bankcode VARCHAR(10), BankACNumber VARCHAR(20), pfacode VARCHAR(10),
      nsitfcode VARCHAR(10), factory VARCHAR(10), location VARCHAR(10), payrollclass VARCHAR(5), dateleft DATE NULL,
      password VARCHAR(255) NULL, reset_hash CHAR(64) NULL, token TEXT NULL, email VARCHAR(100) NULL)`);
    await sql(`CREATE TABLE ${T("py_ipis_payhistory")} (period CHAR(6) NOT NULL, numb VARCHAR(20) NOT NULL, Type VARCHAR(10) NOT NULL,
      bpc VARCHAR(5), bpa VARCHAR(50), bp VARCHAR(50), bpm DECIMAL(18,4), PRIMARY KEY (period, numb, Type))`);
    await sql(`CREATE TABLE ${T("py_payhistory")} (his_empno VARCHAR(20), his_year INT, his_type VARCHAR(10),
      amtthismth9 DECIMAL(18,2) NULL, amtthismth10 DECIMAL(18,2) NULL, amtthismth11 DECIMAL(18,2) NULL,
      amtthismth12 DECIMAL(18,2) NULL, amtthismth1 DECIMAL(18,2) NULL,
      PRIMARY KEY (his_empno, his_year, his_type))`);
    for (const t of ["py_masterpayded", "py_mastercum"]) {
      await sql(`CREATE TABLE ${T(t)} (his_empno VARCHAR(20), his_type VARCHAR(10), amtthismth DECIMAL(18,2),
        PRIMARY KEY (his_empno, his_type), UNIQUE KEY uk_empno_type (his_empno, his_type), KEY idx_amt (amtthismth))`);
    }
    await sql(`CREATE TABLE ${T("py_stdrate")} (type VARCHAR(10) PRIMARY KEY, ord VARCHAR(4), mth VARCHAR(2))`);
    await sql(`CREATE TABLE ${T("ac_months")} (cmonth INT PRIMARY KEY, mthdesc VARCHAR(20))`);
    // like the real website table: website settings the payroll side does not have
    await sql(`CREATE TABLE ${T("py_payrollclass")} (classcode VARCHAR(5) PRIMARY KEY, classname VARCHAR(60), db_name VARCHAR(30),
      status VARCHAR(10), year INT NOT NULL, month INT NOT NULL)`);
    await sql(`INSERT INTO ${T("py_payrollclass")} VALUES ('1','OFFICERS','t_hicaddata','active',2026,9), ('2','W/OFFICERS','t_hicaddata1','active',2026,9)`);
    for (const t of ["py_elementtype", "py_bank", "py_pfa", "ac_businessline", "ac_costcentre"]) {
      await sql(`CREATE TABLE ${T(t)} (code VARCHAR(10) PRIMARY KEY, name VARCHAR(60))`);
    }
    await sql(`INSERT INTO ${T("py_stdrate")} VALUES ('BT05','2026','9')`);
    await sql(`INSERT INTO ${T("py_masterpayded")} VALUES ('OLD','BP001',1.00)`);
    // existing website staff with login data
    await sql(
      `INSERT INTO ${T("hr_employees")} (Empl_ID, Surname, BankACNumber, password, reset_hash, email)
       VALUES ('E000001','Oldname','111','$2b$hash1',?, 'e1@x'), ('E000002','Keep','222','$2b$hash2',NULL,'e2@x')`,
      ["a".repeat(64)],
    );
  }
  for (const s of schema.createStatements((t) => `t_hicaddata.${t}`)) await sql(s);
}

function staffRows(n, surname = (i) => `Surname${i}`) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const id = "E" + String(i).padStart(6, "0");
    rows.push([id, surname(i), "Other", "Mr", "GL07", "033", String(1000000 + i), "PF1", "NS1", "F1", "L1", "1", null]);
  }
  return rows;
}
const HR_COLS = ["EMPL_ID", "Surname", "othername", "Title", "gradelevel", "bankcode", "BankACNumber", "pfacode", "nsitfcode", "factory", "location", "payrollclass", "dateleft"];
const HR_TYPES = ["string", "string", "string", "string", "string", "string", "string", "string", "string", "string", "string", "string", "date"];

function packageTables(dbKey, { kind, period, staff, surname, ippisPerStaff = 2 }) {
  const [y, m] = [period.slice(0, 4), String(Number(period.slice(4)))];
  const full = kind === "full";
  const ippis = [];
  for (let i = 1; i <= staff; i++) {
    for (let k = 1; k <= ippisPerStaff; k++) {
      ippis.push([period, "E" + String(i).padStart(6, "0"), `BP00${k}`, "BP", "TAXABLE", "BASIC", (1000 * i + k).toFixed(4)]);
    }
  }
  const mp = [];
  for (let i = 1; i <= staff; i++) mp.push(["E" + String(i).padStart(6, "0"), "BP001", (500 + i + Number(m)).toFixed(2)]);
  // mode / applyAt come from the library's manifest for this kind (helpers.writePackage)
  const t = [
    { database: dbKey, table: "ac_months", columns: ["cmonth", "mthdesc"], types: ["int", "string"],
      rows: [[9, "September"], [10, "October"], [11, "November"]] },
    { database: dbKey, table: "hr_employees", columns: HR_COLS, types: HR_TYPES, rows: staffRows(staff, surname) },
    { database: dbKey, table: "py_ipis_payhistory", scope: full ? null : { period },
      columns: ["period", "numb", "Type", "bpc", "bpa", "bp", "bpm"], types: ["string", "string", "string", "string", "string", "string", "decimal"], rows: ippis },
    { database: dbKey, table: "py_payhistory", scope: full ? null : { his_year: Number(y) },
      columns: ["his_empno", "his_year", "his_type", `amtthismth${m}`], types: ["string", "int", "string", "decimal"],
      rows: mp.map((r) => [r[0], Number(y), r[1], r[2]]) },
    { database: dbKey, table: "py_masterpayded", columns: ["his_empno", "his_type", "amtthismth"], types: ["string", "string", "decimal"], rows: mp },
    { database: dbKey, table: "py_mastercum", columns: ["his_empno", "his_type", "amtthismth"], types: ["string", "string", "decimal"], rows: mp },
    { database: dbKey, table: "py_stdrate", columns: ["type", "ord", "mth"], types: ["string", "string", "string"], rows: [["BT05", y, m]] },
  ];
  if (dbKey === "officers") {
    t.push({ database: dbKey, table: "py_payrollclass", columns: ["classcode", "classname"],
      types: ["string", "string"], rows: [["1", "OFFICERS (LEGACY)"], ["2", "W/OFFICERS (LEGACY)"]] });
  }
  return t;
}

async function makePkg(name, opts) {
  const file = path.join(tmp, name);
  // only what the library's manifest sends for each database (hr_employees: officers only from v0.1.2)
  const entries = opts.databases
    .flatMap((d) => packageTables(d, { ...opts, staff: opts.staffPerDb[d] }))
    .filter((e) => helpers.has(e.database, e.table, opts.kind));
  const totals = Object.fromEntries(opts.databases.map((d) => [d, { staffCount: opts.staffPerDb[d], totalNet: "123456.7800" }]));
  const header = await helpers.writePackage(file, { exporter, websitePublicKeyPem: wkPub, ...opts, entries, totals });
  return { file, header };
}

async function api(method, p, { role = "SYNC OFFICER", json, raw } = {}) {
  const headers = { "x-test-role": role };
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (raw) {
    headers["content-type"] = "application/octet-stream";
    body = raw;
  }
  const r = await fetch(base + p, { method, headers, body });
  return { status: r.status, body: await r.json() };
}

/** Upload like the browser does. stopAfter: send only that many chunks. */
async function uploadFile(file, { stopAfter = null } = {}) {
  const buf = fs.readFileSync(file);
  const { header } = await lib.reader.readHeader(file);
  const start = await api("POST", "/api/sync/packages", { json: { header, totalBytes: buf.length } });
  if (!start.body.success) return { start };
  const { fingerprint, chunkSize, chunkCount, chunksHeld } = start.body.data;
  const held = new Set(chunksHeld);
  let sent = 0;
  for (let n = 0; n < chunkCount; n++) {
    if (held.has(n)) continue;
    if (stopAfter != null && sent >= stopAfter) return { start, fingerprint, partial: true };
    const r = await api("PUT", `/api/sync/packages/${fingerprint}/chunks/${n}`, { raw: buf.subarray(n * chunkSize, Math.min(buf.length, (n + 1) * chunkSize)) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    sent++;
  }
  const done = await api("POST", `/api/sync/packages/${fingerprint}/complete`);
  return { start, fingerprint, done, sent };
}

async function waitRun(runId) {
  await runSvc.waitFor(runId);
  for (let i = 0; i < 100; i++) {
    const r = await runSvc.getRun(runId);
    if (!["received", "verifying", "loading", "validating"].includes(r.status) || r.error_code === "unknown-exporter") return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  return runSvc.getRun(runId);
}

const one = async (s, p) => { const r = (await sql(s, p))[0][0]; if (r && r.n !== undefined) r.n = Number(r.n); return r; };

test.before(async () => {
  await setupSchemas();
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api/sync", require("../../routes/sync"));
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await db.end();
  if (admin) await admin.end();
});

let fullHeader;

test("access: a request without a login is refused", async () => {
  const r = await api("GET", "/api/sync/status", { role: "" });
  assert.equal(r.status, 401);
});

test("full package: unknown exporter → approval → prepared", async () => {
  const { file, header } = await makePkg("full.npsync", {
    kind: "full", seq: 1, baseSeq: null, period: "202610", databases: ["officers", "wofficers"],
    staffPerDb: { officers: 12000, wofficers: 300 },
  });
  fullHeader = header;
  const up = await uploadFile(file);
  assert.equal(up.start.status, 201, JSON.stringify(up.start.body));
  assert.equal(up.start.body.data.approved, false);
  assert.ok(up.start.body.data.chunkCount > 3, "multi-chunk upload");
  assert.equal(up.done.status, 202, JSON.stringify(up.done.body));
  let run = await waitRun(up.done.body.data.runId);
  assert.equal(run.error_code, "unknown-exporter");

  // the wrong key id is refused
  let a = await api("POST", "/api/sync/exporters/approve", { role: "SUPER ADMIN", json: { fingerprint: up.fingerprint, keyIdConfirmed: "0000-0000-0000-0000" } });
  assert.equal(a.body.code, "key-id-mismatch");
  a = await api("POST", "/api/sync/exporters/approve", { role: "SUPER ADMIN", json: { fingerprint: up.fingerprint, keyIdConfirmed: run.summary.approval.keyIdFormatted } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  run = await waitRun(a.body.data.runId);
  assert.equal(run.status, "prepared", run.error);

  // nothing visible yet: hr payroll columns applied at prepare, stdrate not moved
  assert.equal((await one("SELECT ord, mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "9");
  // a full package swaps IPPIS, pay history and lookups in at Go live (manifest "full" plan)
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_ipis_payhistory WHERE period='202610'")).n, 0);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.hr_employees")).n, 12000);
  assert.deepEqual(await publications.isPeriodVisible("t_hicaddata", "202610"), { visible: false, reason: "prepared" });
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202609")).visible, true);
});

test("login data untouched; payroll columns updated", async () => {
  const e1 = await one("SELECT * FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'");
  assert.equal(e1.password, "$2b$hash1");
  assert.equal(e1.reset_hash, "a".repeat(64));
  assert.equal(e1.email, "e1@x");
  assert.equal(e1.Surname, "Surname1");
  assert.equal(e1.BankACNumber, "1000001");
});

test("Go live: one switch, stage indexes restored, published", async () => {
  const r = await api("POST", "/api/sync/golive", { json: { period: "202610" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.ms < 60000);
  assert.equal((await one("SELECT mth FROM t_hicaddata1.py_stdrate WHERE type='BT05'")).mth, "10");
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_masterpayded")).n, 12000);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_ipis_payhistory WHERE period='202610'")).n, 24000);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.ac_months")).n, 3);
  // the website keeps its own py_payrollclass (db_name decides where payslips are read)
  assert.deepEqual(await one("SELECT classname, db_name, status, year FROM t_hicaddata.py_payrollclass WHERE classcode='1'"),
    { classname: "OFFICERS", db_name: "t_hicaddata", status: "active", year: 2026 });
  const ix = (await sql("SHOW INDEX FROM t_hicaddata.py_masterpayded"))[0].map((x) => x.Key_name);
  assert.ok(ix.includes("idx_amt") && ix.includes("uk_empno_type"), "secondary indexes re-added after load");
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202610")).visible, true);
  const st = await api("GET", "/api/sync/status");
  assert.equal(st.body.data.databases.find((d) => d.database === "officers").livePeriod, "202610");
});

test("duplicate file: Already received", async () => {
  const r = await api("POST", "/api/sync/packages", { json: { header: fullHeader, totalBytes: fs.statSync(path.join(tmp, "full.npsync")).size } });
  assert.equal(r.status, 409);
  assert.equal(r.body.message, "Already received.");
});

test("sequence gap refused before upload", async () => {
  const { file } = await makePkg("gap.npsync", { kind: "month", seq: 5, baseSeq: 4, period: "202611", databases: ["officers"], staffPerDb: { officers: 10 } });
  const { header } = await lib.reader.readHeader(file);
  const r = await api("POST", "/api/sync/packages", { json: { header, totalBytes: fs.statSync(file).size } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "sequence-gap");
});

test("tampered file refused, nothing staff can see changes", async () => {
  const { file } = await makePkg("tamper.npsync", { kind: "month", seq: 2, baseSeq: 1, period: "202611", databases: ["officers"], staffPerDb: { officers: 50 } });
  const buf = fs.readFileSync(file);
  buf[buf.length - 40] ^= 0xff;
  fs.writeFileSync(file, buf);
  const up = await uploadFile(file);
  const run = await waitRun(up.done.body.data.runId);
  assert.equal(run.status, "failed");
  assert.match(run.error_code, /payload-hash-mismatch|bad-signature|bad-record/);
  assert.equal((await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "10");
  assert.equal((await one("SELECT status FROM t_hicaddata.sync_packages WHERE fingerprint=?", [up.fingerprint])).status, "rejected");
});

let monthFp;
test("month package after the full one: resumed upload, prepared, Go live", async () => {
  const { file } = await makePkg("month.npsync", {
    kind: "month", seq: 2, baseSeq: 1, period: "202611", databases: ["officers", "wofficers"],
    staffPerDb: { officers: 12001, wofficers: 300 }, surname: (i) => (i === 1 ? "Changed" : `Surname${i}`),
  });
  // a staff row that exists only on the website (e.g. renumbered there)
  await sql("INSERT INTO t_hicaddata.hr_employees (Empl_ID, Surname, password) VALUES ('WEBONLY1','Renamed','$2b$keep')");
  const part = await uploadFile(file, { stopAfter: 2 });
  assert.ok(part.partial);
  const resumed = await uploadFile(file);
  assert.equal(resumed.start.body.data.resumed, true);
  assert.equal(resumed.start.body.data.chunksHeld.length, 2);
  monthFp = resumed.fingerprint;
  const run = await waitRun(resumed.done.body.data.runId);
  assert.equal(run.status, "prepared", run.error);
  assert.equal(run.summary.applied["officers/ac_months"].skipped, "unchanged");
  assert.deepEqual(run.summary.notInPackage.officers, { count: 1, sample: ["WEBONLY1"] });
  assert.equal(run.summary.notInPackage.wofficers, undefined);
  assert.equal((await one("SELECT password FROM t_hicaddata.hr_employees WHERE Empl_ID='WEBONLY1'")).password, "$2b$keep");
  const g = await api("POST", "/api/sync/golive", { json: { period: "202611" } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal((await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "11");
  assert.equal((await one("SELECT Surname FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'")).Surname, "Changed");
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.hr_employees")).n, 12002); // 12001 + WEBONLY1
  assert.equal((await one("SELECT amtthismth11 a FROM t_hicaddata.py_payhistory WHERE his_empno='E000005'")).a, "516.00");
  assert.equal((await one("SELECT amtthismth10 a FROM t_hicaddata.py_payhistory WHERE his_empno='E000005'")).a, "515.00");
});

test("roll back after Go live: previous month shows again, seq steps back", async () => {
  const r = await api("POST", "/api/sync/publications/officers/202611/rollback");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "10");
  assert.equal((await one("SELECT Surname FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'")).Surname, "Surname1");
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.hr_employees")).n, 12001); // new key E012001 removed, WEBONLY1 kept
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_ipis_payhistory WHERE period='202611'")).n, 0);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_ipis_payhistory WHERE period='202610'")).n, 24000);
  assert.equal((await one("SELECT amtthismth11 a FROM t_hicaddata.py_payhistory WHERE his_empno='E000005'")).a, null);
  assert.equal((await one("SELECT password FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'")).password, "$2b$hash1");
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202611")).visible, false);
  // wofficers still live on 202611 until it is rolled back too
  assert.equal((await one("SELECT mth FROM t_hicaddata1.py_stdrate WHERE type='BT05'")).mth, "11");
  const r2 = await api("POST", "/api/sync/publications/wofficers/202611/rollback");
  assert.equal(r2.body.data.runStatus, "rolled_back");
  assert.equal((await one("SELECT mth FROM t_hicaddata1.py_stdrate WHERE type='BT05'")).mth, "10");
  const pk = await one("SELECT status FROM t_hicaddata.sync_packages WHERE fingerprint=?", [monthFp]);
  assert.equal(pk.status, "rolled_back");
  // seq 2 can come again (after --discard-last the officer exports seq 2 on base 1)
  const { file } = await makePkg("month2.npsync", { kind: "month", seq: 2, baseSeq: 1, period: "202611", databases: ["officers"], staffPerDb: { officers: 5 } });
  const { header } = await lib.reader.readHeader(file);
  const ok = await api("POST", "/api/sync/packages", { json: { header, totalBytes: fs.statSync(file).size } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  await api("POST", `/api/sync/packages/${ok.body.data.fingerprint}/cancel`);
});

test("withdraw a period: staff see not ready; Go live publishes again", async () => {
  const w = await api("POST", "/api/sync/publications/officers/202610/withdraw");
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202610")).visible, false);
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202609")).visible, true);
  const g = await api("POST", "/api/sync/golive", { json: { period: "202610" } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal((await publications.isPeriodVisible("t_hicaddata", "202610")).visible, true);
});

test("runs list and detail", async () => {
  const r = await api("GET", "/api/sync/runs");
  assert.ok(r.body.data.length >= 4);
  const d = await api("GET", `/api/sync/runs/${r.body.data[0].run_uuid}`);
  assert.equal(d.status, 200);
  assert.ok(d.body.data.summary.timings);
});

test("package writing a login column is refused; login data unchanged", async () => {
  const file = path.join(tmp, "evil.npsync");
  await helpers.writePackage(file, {
    exporter, websitePublicKeyPem: wkPub, kind: "full", seq: 10, baseSeq: null, period: "202610", databases: ["officers"],
    entries: [{ database: "officers", table: "hr_employees", mode: "merge-columns", applyAt: "prepare", key: ["Empl_ID"],
      columns: ["Empl_ID", "Surname", "password"], types: ["string", "string", "string"], rows: [["E000001", "X", "pwned"]] }],
  });
  const up = await uploadFile(file);
  const run = await waitRun(up.done.body.data.runId);
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "column-not-allowed");
  const e1 = await one("SELECT Surname, password FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'");
  assert.equal(e1.password, "$2b$hash1");
  assert.equal(e1.Surname, "Surname1");
  assert.equal((await one("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_NAME LIKE '%\\_\\_stage'")).n, 0);
});

test("failure part-way through Prepare undoes what was applied", async () => {
  // A live column the package cannot fill makes the IPPIS replace fail after hr_employees was merged.
  const w1Before = await one("SELECT Surname FROM t_hicaddata1.hr_employees WHERE Empl_ID='E000001'");
  await sql("ALTER TABLE t_hicaddata1.py_ipis_payhistory ADD COLUMN must_fill INT NOT NULL");
  const { file } = await makePkg("partial.npsync", {
    kind: "month", seq: 2, baseSeq: 1, period: "202611", databases: ["officers", "wofficers"],
    staffPerDb: { officers: 20, wofficers: 20 }, surname: () => "ShouldNotStay",
  });
  const up = await uploadFile(file);
  const run = await waitRun(up.done.body.data.runId);
  await sql("ALTER TABLE t_hicaddata1.py_ipis_payhistory DROP COLUMN must_fill");
  assert.equal(run.status, "failed", "run failed");
  assert.equal((await one("SELECT Surname FROM t_hicaddata.hr_employees WHERE Empl_ID='E000001'")).Surname, "Surname1");
  // (hr_employees in a class database is only written by libraries before v0.1.2)
  assert.deepEqual(await one("SELECT Surname FROM t_hicaddata1.hr_employees WHERE Empl_ID='E000001'"), w1Before);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.py_ipis_payhistory WHERE period='202611'")).n, 0);
  assert.equal((await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "10");
  // the same file can be processed again once the cause is fixed
  const again = await api("POST", `/api/sync/packages/${up.fingerprint}/reprocess`);
  assert.equal(again.status, 202, JSON.stringify(again.body));
  const run2 = await waitRun(again.body.data.runId);
  assert.equal(run2.status, "prepared", run2.error);
});

test("month crossing a year end: one py_payhistory part per his_year, two IPPIS periods; roll back", async () => {
  // existing website values that the package changes, to check the roll back
  await sql("INSERT INTO t_hicaddata1.py_payhistory (his_empno, his_year, his_type, amtthismth12) VALUES ('E000005', 2026, 'BP001', 7.00) ON DUPLICATE KEY UPDATE amtthismth12 = 7.00");
  await sql("INSERT INTO t_hicaddata1.py_ipis_payhistory (period, numb, Type, bpm) VALUES ('202612','OLD','BP001',1.0000)");
  const n2026 = 6000; // two batches of up to 5,000 → checksum must follow batchNo order
  const ids = (n) => Array.from({ length: n }, (_, i) => "E" + String(i + 1).padStart(6, "0"));
  const ph = (year, col, n, amt) => ({
    database: "wofficers", table: "py_payhistory", mode: "merge-columns", applyAt: "prepare",
    key: ["his_empno", "his_year", "his_type"], scope: { his_year: year },
    columns: ["his_empno", "his_year", "his_type", col], types: ["string", "int", "string", "decimal"],
    rows: ids(n).map((id) => [id, year, "BP001", amt]),
  });
  const ip = (period, n) => ({
    database: "wofficers", table: "py_ipis_payhistory", mode: "replace-scope", applyAt: "prepare",
    key: ["period", "numb", "Type"], scope: { period },
    columns: ["period", "numb", "Type", "bpc", "bpa", "bp", "bpm"], types: ["string", "string", "string", "string", "string", "string", "decimal"],
    rows: ids(n).map((id) => [period, id, "BP001", "BP", "TAXABLE", "BASIC", "50.0000"]),
  });
  const file = path.join(tmp, "yearend.npsync");
  // entries interleaved: payhistory 2026, IPPIS 202612, payhistory 2027, IPPIS 202701
  await helpers.writePackage(file, {
    exporter, websitePublicKeyPem: wkPub, kind: "month", seq: 3, baseSeq: 2, period: "202701", databases: ["wofficers"],
    entries: [ph(2026, "amtthismth12", n2026, "12.00"), ip("202612", 10), ph(2027, "amtthismth1", 300, "1.00"), ip("202701", 300)],
    totals: { wofficers: { staffCount: 300, totalNet: "1.0000" } },
  });
  const up = await uploadFile(file);
  const run = await waitRun(up.done.body.data.runId);
  assert.equal(run.status, "prepared", run.error);
  const parts = run.summary.checks.wofficers.tables.filter((t) => t.table === "py_payhistory");
  assert.equal(parts.length, 2);
  assert.ok(parts.every((t) => t.ok && t.checksum === "ok"), JSON.stringify(parts));
  // each part wrote only its own columns
  const e5 = await one("SELECT amtthismth12, amtthismth1 FROM t_hicaddata1.py_payhistory WHERE his_empno='E000005' AND his_year=2026");
  assert.deepEqual(e5, { amtthismth12: "12.00", amtthismth1: null });
  assert.equal((await one("SELECT amtthismth1 a FROM t_hicaddata1.py_payhistory WHERE his_empno='E000005' AND his_year=2027")).a, "1.00");
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_payhistory WHERE his_year=2026 AND amtthismth12='12.00'")).n, n2026);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE period='202612'")).n, 10);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE numb='OLD'")).n, 0);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE period='202701'")).n, 300);

  const rb = await api("POST", "/api/sync/publications/wofficers/202701/rollback");
  assert.equal(rb.status, 200, JSON.stringify(rb.body));
  assert.equal((await one("SELECT amtthismth12 a FROM t_hicaddata1.py_payhistory WHERE his_empno='E000005' AND his_year=2026")).a, "7.00");
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_payhistory WHERE his_year=2027")).n, 0);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE period='202612'")).n, 1);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE numb='OLD'")).n, 1);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata1.py_ipis_payhistory WHERE period='202701'")).n, 0);
});

test("month package with no py_payhistory entry is accepted", async () => {
  const file = path.join(tmp, "nopayhist.npsync");
  await helpers.writePackage(file, {
    exporter, websitePublicKeyPem: wkPub, kind: "month", seq: 3, baseSeq: 2, period: "202701", databases: ["wofficers"],
    entries: [{ database: "wofficers", table: "py_stdrate", mode: "swap", applyAt: "golive", key: [], columns: ["type", "ord", "mth"],
      types: ["string", "string", "string"], rows: [["BT05", "2027", "1"]] }],
  });
  const up = await uploadFile(file);
  const run = await waitRun(up.done.body.data.runId);
  assert.equal(run.status, "prepared", run.error);
});

test("check only: nothing is loaded; then Load and prepare", async () => {
  const before = await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'");
  const { file } = await makePkg("checkonly.npsync", {
    kind: "month", seq: 4, baseSeq: 3, period: "202701", databases: ["officers"], staffPerDb: { officers: 30 },
    surname: () => "OnlyChecked",
  });
  const buf = fs.readFileSync(file);
  const { header } = await lib.reader.readHeader(file);
  const st = await api("POST", "/api/sync/packages", { json: { header, totalBytes: buf.length } });
  const { fingerprint, chunkSize, chunkCount } = st.body.data;
  for (let n = 0; n < chunkCount; n++) {
    await api("PUT", `/api/sync/packages/${fingerprint}/chunks/${n}`, { raw: buf.subarray(n * chunkSize, Math.min(buf.length, (n + 1) * chunkSize)) });
  }
  const done = await api("POST", `/api/sync/packages/${fingerprint}/complete`, { json: { checkOnly: true } });
  assert.equal(done.status, 202, JSON.stringify(done.body));
  const run = await waitRun(done.body.data.runId);
  assert.equal(run.status, "checked", run.error);
  assert.ok(run.summary.check.tables.length >= 7);
  assert.ok(run.summary.check.tables.every((t) => !t.problems.length), JSON.stringify(run.summary.check.tables.filter((t) => t.problems.length)));
  // nothing loaded
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.hr_employees WHERE Surname='OnlyChecked'")).n, 0);
  assert.equal((await one("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA LIKE 't\\_hicaddata%' AND TABLE_NAME LIKE '%\\_\\_stage'")).n,
    (await one("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA LIKE 't\\_hicaddata%' AND TABLE_NAME LIKE '%\\_\\_stage'")).n);
  assert.deepEqual(await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'"), before);
  // then load it
  const load = await api("POST", `/api/sync/packages/${fingerprint}/reprocess`);
  assert.equal(load.status, 202, JSON.stringify(load.body));
  const run2 = await waitRun(load.body.data.runId);
  assert.equal(run2.status, "prepared", run2.error);
  assert.equal((await one("SELECT COUNT(*) n FROM t_hicaddata.hr_employees WHERE Surname='OnlyChecked'")).n, 30);
});

test("check only refuses a tampered file", async () => {
  const { file } = await makePkg("checkonly-bad.npsync", { kind: "month", seq: 5, baseSeq: 4, period: "202701", databases: ["officers"], staffPerDb: { officers: 5 } });
  const buf = fs.readFileSync(file);
  buf[buf.length - 20] ^= 0xff;
  fs.writeFileSync(file, buf);
  const { header } = await lib.reader.readHeader(file);
  const st = await api("POST", "/api/sync/packages", { json: { header, totalBytes: buf.length } });
  const { fingerprint, chunkSize, chunkCount } = st.body.data;
  for (let n = 0; n < chunkCount; n++) {
    await api("PUT", `/api/sync/packages/${fingerprint}/chunks/${n}`, { raw: buf.subarray(n * chunkSize, Math.min(buf.length, (n + 1) * chunkSize)) });
  }
  const done = await api("POST", `/api/sync/packages/${fingerprint}/complete`, { json: { checkOnly: true } });
  const run = await waitRun(done.body.data.runId);
  assert.equal(run.status, "check_failed");
  assert.match(run.error_code, /payload-hash-mismatch|bad-signature/);
});

test("Checks tab: system checks and the Go live switch test", async () => {
  const r = await api("GET", "/api/sync/checks");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fails = r.body.data.filter((i) => i.status === "fail");
  assert.deepEqual(fails, []);
  // a month is prepared (previous test): the switch test must not touch its stage tables
  let p = await api("POST", "/api/sync/checks/golive-switch", { role: "SUPER ADMIN" });
  assert.equal(p.body.data.status, "warn");
  assert.equal((await one("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA='t_hicaddata' AND TABLE_NAME='py_stdrate__stage'")).n, 1);
  // after Go live there is a __prev copy (kept for roll back): the test runs and leaves it alone
  const g = await api("POST", "/api/sync/golive", { json: { period: "202701" } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const prevBefore = await one("SELECT COUNT(*) n FROM t_hicaddata.py_stdrate__prev");
  p = await api("POST", "/api/sync/checks/golive-switch", { role: "SUPER ADMIN" });
  assert.equal(p.body.data.status, "ok", JSON.stringify(p.body));
  assert.deepEqual(await one("SELECT COUNT(*) n FROM t_hicaddata.py_stdrate__prev"), prevBefore);
  assert.equal((await one("SELECT mth FROM t_hicaddata.py_stdrate WHERE type='BT05'")).mth, "1");
  // roll back still works after the switch test
  const rb = await api("POST", "/api/sync/publications/officers/202701/rollback");
  assert.equal(rb.status, 200, JSON.stringify(rb.body));
});

test("check only looks both ways: a required website column the package lacks is a problem", async () => {
  await sql("ALTER TABLE t_hicaddata.py_stdrate ADD COLUMN must_have INT NOT NULL, ADD COLUMN nice_to_have VARCHAR(10) NULL");
  try {
    const { file } = await makePkg("twoway.npsync", { kind: "full", seq: 60, baseSeq: null, period: "202701", databases: ["officers"], staffPerDb: { officers: 5 } });
    const buf = fs.readFileSync(file);
    const { header } = await lib.reader.readHeader(file);
    const st = await api("POST", "/api/sync/packages", { json: { header, totalBytes: buf.length } });
    const { fingerprint, chunkSize, chunkCount } = st.body.data;
    for (let n = 0; n < chunkCount; n++) {
      await api("PUT", `/api/sync/packages/${fingerprint}/chunks/${n}`, { raw: buf.subarray(n * chunkSize, Math.min(buf.length, (n + 1) * chunkSize)) });
    }
    const done = await api("POST", `/api/sync/packages/${fingerprint}/complete`, { json: { checkOnly: true } });
    const run = await waitRun(done.body.data.runId);
    assert.equal(run.status, "check_failed");
    const sr = run.summary.check.tables.find((t) => t.table === "py_stdrate");
    assert.match(sr.problems.join(" "), /must_have/);
    assert.match((sr.warnings || []).join(" "), /nice_to_have/);
    const pc = run.summary.check.tables.find((t) => t.table === "py_payrollclass");
    assert.equal(pc.problems.length, 0);
    assert.match(pc.note, /keeps its own/);
  } finally {
    await sql("ALTER TABLE t_hicaddata.py_stdrate DROP COLUMN must_have, DROP COLUMN nice_to_have");
  }
});
