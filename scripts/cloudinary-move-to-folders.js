// Put existing emolument photos into their Media Library folder on Cloudinary
// (emolument/passport, emolument/nok_passport, emolument/alt_nok_passport).
// Only the folder changes: public_id, URLs and the database stay as they are.
//
//   node scripts/cloudinary-move-to-folders.js           dry run: list what would move
//   node scripts/cloudinary-move-to-folders.js --apply   move them
//
// Needs CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET and the
// usual MYSQL_* settings (reads ef_documents in the officers database).

require("dotenv").config();
const cloudinary = require("cloudinary").v2;
const mysql = require("mysql2/promise");
const config = require("../config");

const APPLY = process.argv.includes("--apply");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function main() {
  const db = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.databases.officers,
  });
  const [rows] = await db.query(
    "SELECT service_no, doc_type, cloudinary_id FROM ef_documents WHERE cloudinary_id IS NOT NULL AND cloudinary_id <> '' ORDER BY doc_type, service_no",
  );
  await db.end();
  console.log(`${rows.length} document(s) in ef_documents. ${APPLY ? "Moving." : "Dry run (add --apply)."}\n`);

  let moved = 0, already = 0, missing = 0, failed = 0;
  for (const r of rows) {
    const folder = `emolument/${String(r.doc_type).toLowerCase()}`;
    try {
      const res = await cloudinary.api.resource(r.cloudinary_id, { resource_type: "image" });
      if (res.asset_folder === folder) { already++; continue; }
      console.log(`${r.service_no} ${r.doc_type}: "${res.asset_folder || "(root)"}" -> "${folder}"`);
      if (APPLY) await cloudinary.api.update(r.cloudinary_id, { resource_type: "image", asset_folder: folder });
      moved++;
    } catch (e) {
      const code = e.error && e.error.http_code;
      if (code === 404) { missing++; console.log(`${r.service_no} ${r.doc_type}: not found on Cloudinary (${r.cloudinary_id})`); }
      else if (code === 420) { console.log("Cloudinary rate limit reached; run again later to continue."); break; }
      else { failed++; console.log(`${r.service_no} ${r.doc_type}: ${e.message || (e.error && e.error.message)}`); }
    }
  }
  console.log(`\n${APPLY ? "Moved" : "Would move"}: ${moved}, already in place: ${already}, not on Cloudinary: ${missing}, errors: ${failed}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
