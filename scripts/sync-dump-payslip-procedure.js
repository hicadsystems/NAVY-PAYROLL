// Saves the source of py_generate_combined_payslip from every payroll
// database into config/sql/procedures/, so the "compare year as well as
// month" fix can be made, reviewed and shipped as a normal migration.
//
//   node scripts/sync-dump-payslip-procedure.js
//
// Prints whether the six copies are identical and the lines that compare
// the requested month with the current period (where the year check goes).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const config = require("../config");

const NAME = "py_generate_combined_payslip";

(async () => {
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
  });
  const outDir = path.join(__dirname, "..", "config", "sql", "procedures");
  fs.mkdirSync(outDir, { recursive: true });
  const hashes = {};
  for (const [key, schema] of Object.entries(config.databases)) {
    if (!schema) continue;
    try {
      const [[row]] = await conn.query(`SHOW CREATE PROCEDURE \`${schema}\`.\`${NAME}\``);
      const body = row["Create Procedure"];
      if (!body) {
        console.log(`${key} (${schema}): no permission to read the body (needs SHOW_ROUTINE or ownership)`);
        continue;
      }
      const file = path.join(outDir, `${schema}__${NAME}.sql`);
      fs.writeFileSync(file, `DELIMITER $$\n${body}$$\nDELIMITER ;\n`);
      const h = crypto.createHash("sha256").update(body.replace(/DEFINER=`[^`]+`@`[^`]+`/, "")).digest("hex").slice(0, 12);
      (hashes[h] = hashes[h] || []).push(schema);
      console.log(`${key} (${schema}) → ${path.relative(process.cwd(), file)}`);
      body.split("\n").forEach((line, i) => {
        if (/BT05|\bmth\b|py_stdrate/i.test(line)) console.log(`    ${String(i + 1).padStart(4)}: ${line.trim()}`);
      });
    } catch (e) {
      console.log(`${key} (${schema}): ${e.message}`);
    }
  }
  const groups = Object.values(hashes);
  console.log(groups.length <= 1 ? "\nAll copies are identical." : `\nCopies differ: ${groups.map((g) => g.join(", ")).join(" | ")}`);
  await conn.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
