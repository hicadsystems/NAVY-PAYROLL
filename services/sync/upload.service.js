// ============================================================
// Payslip Sync — resumable upload
// services/sync/upload.service.js
//
// POST header → package row + empty file of the right size
// PUT chunk n → written in place at n × chunkSize
// complete    → every chunk present, header in the file matches → received
// ============================================================

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const db = require("./db");
const shared = require("./shared");
const pkg = require("./package.service");
const { SyncError } = pkg;

// 8 MB (contract). SYNC_CHUNK_BYTES overrides it for tests; the server tells the browser.
const CHUNK_SIZE = parseInt(process.env.SYNC_CHUNK_BYTES) || 8 * 1024 * 1024;

function uploadDir() {
  return path.resolve(process.env.SYNC_UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads", "sync"));
}

function filePathFor(fingerprint) {
  if (!/^[0-9A-F-]{6,20}$/i.test(fingerprint)) {
    throw new SyncError("bad-request", "Bad fingerprint.");
  }
  return path.join(uploadDir(), `${fingerprint}.npsync`);
}

function payloadOffset() {
  const f = shared.lib().format;
  return Number(f.PAYLOAD_OFFSET);
}

async function getPackageByFingerprint(fingerprint) {
  const [rows] = await db.query(
    `SELECT * FROM ${db.ctl("sync_packages")} WHERE fingerprint = ?`,
    [fingerprint],
  );
  return rows[0] || null;
}

async function chunksHeld(fingerprint) {
  const [rows] = await db.query(
    `SELECT chunk_no FROM ${db.ctl("sync_upload_chunks")} WHERE fingerprint = ? ORDER BY chunk_no`,
    [fingerprint],
  );
  return rows.map((r) => Number(r.chunk_no));
}

/**
 * Start or resume an upload. Refuses duplicates, bad headers, gaps.
 * Returns { fingerprint, packageId, chunkSize, chunkCount, chunksHeld, approved, resumed }.
 */
async function startUpload({ header, totalBytes, by }) {
  // The same file again is "Already received" (test plan #8), before the sequence rule
  // would call it old.
  if (header && /^[0-9a-f]{64}$/i.test(String(header.payloadSha256 || ""))) {
    const prior = await getPackageByFingerprint(shared.fingerprint(header.payloadSha256));
    if (prior && prior.status !== "uploading" && String(prior.payload_sha256) === String(header.payloadSha256).toLowerCase()) {
      throw new SyncError("duplicate", "Already received.", 409, { packageId: prior.id, packageStatus: prior.status });
    }
  }
  const checked = await pkg.checkHeader(header);
  const fp = checked.fingerprint;

  const expected = payloadOffset() + Number(header.payloadBytes);
  if (totalBytes != null && Number(totalBytes) !== expected) {
    throw new SyncError("truncated", pkg.messageFor("truncated"), 400, {
      detail: `file is ${totalBytes} bytes, header says ${expected}`,
    });
  }
  const chunkCount = Math.max(1, Math.ceil(expected / CHUNK_SIZE));

  const existing = await getPackageByFingerprint(fp);
  if (existing) {
    if (existing.status === "uploading") {
      return {
        fingerprint: fp,
        packageId: existing.id,
        chunkSize: existing.chunk_size,
        chunkCount: existing.chunk_count,
        chunksHeld: await chunksHeld(fp),
        approved: checked.approved,
        resumed: true,
      };
    }
    throw new SyncError("duplicate", "Already received.", 409, {
      packageId: existing.id,
      packageStatus: existing.status,
    });
  }

  await fsp.mkdir(uploadDir(), { recursive: true });
  const file = filePathFor(fp);
  const fh = await fsp.open(file, "w");
  try {
    await fh.truncate(expected);
  } finally {
    await fh.close();
  }

  const [res] = await db.query(
    `INSERT INTO ${db.ctl("sync_packages")}
       (fingerprint, payload_sha256, exporter_id, seq, base_seq, kind, period,
        databases_json, header_json, bytes, chunk_size, chunk_count, file_path,
        uploaded_by, upload_started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'uploading')`,
    [
      fp,
      String(header.payloadSha256).toLowerCase(),
      header.exporterId,
      header.seq,
      header.baseSeq == null ? null : header.baseSeq,
      header.kind,
      header.period || null,
      JSON.stringify(header.databases || []),
      JSON.stringify(header),
      expected,
      CHUNK_SIZE,
      chunkCount,
      file,
      by,
    ],
  );

  return {
    fingerprint: fp,
    packageId: res.insertId,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunksHeld: [],
    approved: checked.approved,
    resumed: false,
  };
}

/** Write one chunk in place. Idempotent. */
async function putChunk(fingerprint, chunkNo, buf) {
  const p = await getPackageByFingerprint(fingerprint);
  if (!p) throw new SyncError("not-found", "Unknown upload.", 404);
  if (p.status !== "uploading") throw new SyncError("duplicate", "Already received.", 409);
  const n = Number(chunkNo);
  if (!Number.isInteger(n) || n < 0 || n >= p.chunk_count) {
    throw new SyncError("bad-request", `Chunk ${chunkNo} is out of range.`);
  }
  const start = n * p.chunk_size;
  const want = Math.min(p.chunk_size, Number(p.bytes) - start);
  if (!Buffer.isBuffer(buf) || buf.length !== want) {
    throw new SyncError("bad-request", `Chunk ${n} should be ${want} bytes, got ${buf ? buf.length : 0}.`);
  }
  const fh = await fsp.open(p.file_path, "r+");
  try {
    await fh.write(buf, 0, buf.length, start);
    await fh.datasync();
  } finally {
    await fh.close();
  }
  await db.query(
    `INSERT INTO ${db.ctl("sync_upload_chunks")} (fingerprint, chunk_no, bytes, received_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE bytes = VALUES(bytes), received_at = NOW()`,
    [fingerprint, n, buf.length],
  );
  return { chunkNo: n, bytes: buf.length };
}

/**
 * All chunks in → check the file's header against the one announced →
 * status received. Returns the package row. The caller starts the run.
 */
async function completeUpload(fingerprint) {
  const p = await getPackageByFingerprint(fingerprint);
  if (!p) throw new SyncError("not-found", "Unknown upload.", 404);
  if (p.status !== "uploading") throw new SyncError("duplicate", "Already received.", 409);

  const held = new Set(await chunksHeld(fingerprint));
  const missing = [];
  for (let i = 0; i < p.chunk_count; i++) if (!held.has(i)) missing.push(i);
  if (missing.length) {
    throw new SyncError("incomplete", `${missing.length} chunk(s) still missing.`, 409, { missing });
  }

  const st = await fsp.stat(p.file_path);
  if (st.size !== Number(p.bytes)) {
    throw new SyncError("truncated", pkg.messageFor("truncated"));
  }

  // The header in the file must be the one checked at the start.
  let fileHeader;
  try {
    ({ header: fileHeader } = await shared.lib().reader.readHeader(p.file_path));
  } catch (e) {
    await reject(p.id, pkg.fromLibError(e));
    throw pkg.fromLibError(e);
  }
  if (String(fileHeader.payloadSha256).toLowerCase() !== p.payload_sha256) {
    const err = new SyncError("bad-header", "The uploaded file does not match the header it announced.");
    await reject(p.id, err);
    throw err;
  }

  await db.query(
    `UPDATE ${db.ctl("sync_packages")}
     SET status = 'received', upload_finished_at = NOW() WHERE id = ?`,
    [p.id],
  );
  await db.query(`DELETE FROM ${db.ctl("sync_upload_chunks")} WHERE fingerprint = ?`, [fingerprint]);
  return { ...p, status: "received" };
}

async function cancelUpload(fingerprint) {
  const p = await getPackageByFingerprint(fingerprint);
  if (!p) return { cancelled: false };
  if (p.status !== "uploading") throw new SyncError("bad-request", "Only an unfinished upload can be cancelled.");
  await db.query(`DELETE FROM ${db.ctl("sync_upload_chunks")} WHERE fingerprint = ?`, [fingerprint]);
  await db.query(`DELETE FROM ${db.ctl("sync_packages")} WHERE id = ?`, [p.id]);
  await fsp.rm(p.file_path, { force: true });
  return { cancelled: true };
}

async function reject(packageId, err) {
  await db.query(
    `UPDATE ${db.ctl("sync_packages")} SET status = 'rejected', reject_reason = ? WHERE id = ?`,
    [`${err.code || "error"}: ${String(err.message).slice(0, 450)}`, packageId],
  );
}

/** Delete the stored file of a package (after Go live the media copy is the record). */
async function removeFile(packageId) {
  const [[p]] = await db.query(`SELECT file_path FROM ${db.ctl("sync_packages")} WHERE id = ?`, [packageId]);
  if (p && p.file_path && fs.existsSync(p.file_path)) await fsp.rm(p.file_path, { force: true });
}

module.exports = {
  CHUNK_SIZE,
  uploadDir,
  getPackageByFingerprint,
  chunksHeld,
  startUpload,
  putChunk,
  completeUpload,
  cancelUpload,
  reject,
  removeFile,
};
