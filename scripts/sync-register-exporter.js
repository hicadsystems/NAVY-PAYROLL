// Fallback for approving an exporter without the Console:
// paste the public key printed by `navy-sync-exporter --show-key`.
//
//   node scripts/sync-register-exporter.js <exporterId> <public-key.pem> [name]
//
// Prints the key id; check it against the one on the exporter's screen
// before relying on it.

const fs = require("fs");
const pkg = require("../services/sync/package.service");
const db = require("../services/sync/db");

(async () => {
  const [exporterId, pemFile, name] = process.argv.slice(2);
  if (!exporterId || !pemFile) {
    console.error("Usage: node scripts/sync-register-exporter.js <exporterId> <public-key.pem> [name]");
    process.exit(1);
  }
  const publicKeyPem = fs.readFileSync(pemFile, "utf8");
  const r = await pkg.registerExporter({ exporterId, name, publicKeyPem, by: `script:${process.env.USERNAME || process.env.USER || "admin"}` });
  console.log(`Registered ${r.exporterId}, key id ${r.keyIdFormatted}`);
  console.log("Check this key id against the one shown on the exporter's screen.");
  await db.end();
})().catch(async (e) => {
  console.error("Failed:", e.message);
  await db.end().catch(() => {});
  process.exit(1);
});
