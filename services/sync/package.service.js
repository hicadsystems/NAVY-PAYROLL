// ============================================================
// Payslip Sync — package checks
// services/sync/package.service.js
//
// Header checks before upload, exporter lookup and approval,
// sequence rule, website key, full verification of an uploaded file.
// The file format and crypto live in navy-payslip-sync (shared.js).
// ============================================================

const fs = require("fs");
const crypto = require("crypto");
const db = require("./db");
const shared = require("./shared");

class SyncError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

// Messages from the shared API's error table (what the sync officer sees).
const MESSAGES = {
  "bad-magic": "This is not a payslip package.",
  "bad-header": "The package header is damaged. Export again.",
  "header-too-large": "The package header is damaged. Export again.",
  "unknown-exporter": "This exporter is not approved yet. A super admin must approve its key.",
  "exporter-key-changed":
    "This exporter's key has changed. A super admin must approve the new key.",
  "bad-signature": "The file was changed after export. Do not use it.",
  truncated: "The file is incomplete. Copy it again.",
  "payload-hash-mismatch": "The file was changed after export. Do not use it.",
  "decrypt-failed": "This package cannot be opened by this website.",
  "bad-record": "The file is damaged. Export again.",
  "missing-end": "The file is damaged. Export again.",
  "sequence-old": "This package is older than the one already applied.",
  "not-applicable": "Dry-run packages are for timing only.",
  duplicate: "Already received.",
};

function messageFor(code, fallback) {
  return MESSAGES[code] || fallback || "The package was refused.";
}

/** Wrap an error from the shared library as a SyncError with the user message. */
function fromLibError(e) {
  if (e instanceof SyncError) return e;
  let code = e && e.code ? e.code : "error";
  // decodeBatch() throws a plain Error on a batch checksum mismatch
  if (code === "error" && e && /checksum mismatch|unsupported batch version/i.test(e.message)) code = "bad-record";
  // sequence-gap carries numbers in its own reason
  const msg = code === "sequence-gap" ? e.message : messageFor(code, e && e.message);
  return new SyncError(code, msg, 400, { detail: e && e.message });
}

// ── Website key ────────────────────────────────────────────

let _websiteKey = null;

/** { privateKeyPem, publicKeyPem, keyId } from SYNC_WEBSITE_PRIVATE_KEY(_FILE). */
function websiteKey() {
  if (_websiteKey) return _websiteKey;
  // SYNC_PRIVATE_KEY (name used by navy-payslip-sync) or SYNC_WEBSITE_PRIVATE_KEY(_FILE):
  // either a path to website-private.pem or the PEM text itself (\n allowed).
  let pem = null;
  const file = process.env.SYNC_WEBSITE_PRIVATE_KEY_FILE;
  const val = process.env.SYNC_PRIVATE_KEY || process.env.SYNC_WEBSITE_PRIVATE_KEY;
  if (file) {
    pem = fs.readFileSync(file, "utf8");
  } else if (val) {
    const text = val.replace(/\\n/g, "\n");
    pem = text.includes("-----BEGIN") ? text : fs.readFileSync(val, "utf8");
  }
  if (!pem) {
    throw new SyncError(
      "website-key-missing",
      "The website's sync private key is not configured (SYNC_PRIVATE_KEY: path to website-private.pem).",
      500,
    );
  }
  const publicKeyPem = crypto
    .createPublicKey(crypto.createPrivateKey(pem))
    .export({ type: "spki", format: "pem" })
    .toString();
  let keyId = null;
  try {
    keyId = shared.lib().crypto.keyId(publicKeyPem);
  } catch (_) {}
  _websiteKey = { privateKeyPem: pem, publicKeyPem, keyId };
  return _websiteKey;
}

function _resetWebsiteKey() {
  _websiteKey = null;
}

// ── Exporters ──────────────────────────────────────────────

/** Approved active key for an exporter id, or null. */
async function findExporter(exporterId) {
  const [rows] = await db.query(
    `SELECT exporter_id, name, key_id, public_key, registered_by, registered_at
     FROM ${db.ctl("sync_exporters")}
     WHERE exporter_id = ? AND active = 1
     ORDER BY registered_at DESC LIMIT 1`,
    [exporterId],
  );
  return rows[0] || null;
}

async function listExporters() {
  const [rows] = await db.query(
    `SELECT exporter_id, name, key_id, registered_by, registered_at, active,
            deactivated_by, deactivated_at
     FROM ${db.ctl("sync_exporters")} ORDER BY exporter_id, registered_at DESC`,
  );
  return rows;
}

function formatKeyId(keyId) {
  try {
    return shared.lib().crypto.formatKeyId(keyId);
  } catch (_) {
    return String(keyId || "")
      .slice(0, 16)
      .toUpperCase()
      .replace(/(.{4})(?=.)/g, "$1-");
  }
}

/**
 * Store an exporter key. Deactivates any other active key for the same
 * exporter id (replacing a key is a deliberate super-admin action).
 */
async function registerExporter({ exporterId, name, publicKeyPem, keyId, by }) {
  if (!exporterId || !publicKeyPem) {
    throw new SyncError("bad-request", "exporterId and publicKeyPem are required.");
  }
  const id = keyId || shared.lib().crypto.keyId(publicKeyPem);
  await db.transaction(async (c) => {
    await c.query(
      `UPDATE ${db.ctl("sync_exporters")}
       SET active = 0, deactivated_by = ?, deactivated_at = NOW()
       WHERE exporter_id = ? AND active = 1 AND key_id <> ?`,
      [by, exporterId, id],
    );
    await c.query(
      `INSERT INTO ${db.ctl("sync_exporters")}
         (exporter_id, name, key_id, public_key, registered_by, registered_at, active)
       VALUES (?, ?, ?, ?, ?, NOW(), 1)
       ON DUPLICATE KEY UPDATE active = 1, public_key = VALUES(public_key),
         name = COALESCE(VALUES(name), name), deactivated_by = NULL, deactivated_at = NULL`,
      [exporterId, name || exporterId, id, publicKeyPem, by],
    );
  });
  return { exporterId, keyId: id, keyIdFormatted: formatKeyId(id) };
}

// ── Sequence ───────────────────────────────────────────────

/** Highest seq applied for this exporter (rolled-back packages do not count). */
async function lastAppliedSeq(exporterId) {
  const [[r]] = await db.query(
    `SELECT MAX(seq) AS s FROM ${db.ctl("sync_packages")}
     WHERE exporter_id = ? AND status = 'applied'`,
    [exporterId],
  );
  return r && r.s != null ? Number(r.s) : null;
}

/** Throws SyncError unless the sequence rule allows this header. */
async function checkSequence(header) {
  const last = await lastAppliedSeq(header.exporterId);
  const res = shared.lib().format.checkSequence(header, last);
  if (!res || res.ok) return { ok: true, lastAppliedSeq: last };
  throw new SyncError(res.code || "sequence-gap", res.reason || messageFor(res.code), 409, {
    lastAppliedSeq: last,
  });
}

// ── Header checks (before upload) ──────────────────────────

function isDryRun(header) {
  return /dry/i.test(String(header.kind || "")) || !!header.dryrunOf;
}

/**
 * Checks done on the header alone, before any bytes are uploaded.
 * Returns { header, fingerprint, exporter, approved, keyIdFormatted }.
 */
async function checkHeader(header) {
  const lib = shared.lib();
  if (!header || typeof header !== "object") {
    throw new SyncError("bad-header", messageFor("bad-header"));
  }
  try {
    lib.format.validateHeaderShape(header);
  } catch (e) {
    throw fromLibError(e);
  }
  if (isDryRun(header)) throw new SyncError("not-applicable", messageFor("not-applicable"));

  // Encrypted for this website?
  const wk = websiteKey();
  const wanted = header.encryption && header.encryption.websiteKeyId;
  if (wanted && wk.keyId && wanted !== wk.keyId) {
    throw new SyncError("decrypt-failed", messageFor("decrypt-failed"), 400, {
      detail: `package is for website key ${wanted}, this website has ${wk.keyId}`,
    });
  }

  const exporter = await findExporter(header.exporterId);
  if (exporter && header.exporterKeyId && header.exporterKeyId !== exporter.key_id) {
    throw new SyncError("exporter-key-changed", messageFor("exporter-key-changed"), 409);
  }
  // Header signature now, if the library offers a header-only check;
  // otherwise verifyPackage() checks it on the whole file after upload.
  if (exporter && lib.reader && typeof lib.reader.verifyHeader === "function") {
    try {
      await lib.reader.verifyHeader(header, { exporterPublicKeyPem: exporter.public_key });
    } catch (e) {
      throw fromLibError(e);
    }
  }

  await checkSequence(header);

  return {
    header,
    fingerprint: shared.fingerprint(header.payloadSha256),
    approved: !!exporter,
    exporter,
  };
}

// ── Full verification (after upload) ───────────────────────

/**
 * Verify an uploaded file. Returns { header, payloadOffset } or, for an
 * exporter that is not approved yet, { needsApproval: true, info }.
 */
async function verifyFile(filePath) {
  const lib = shared.lib();
  let header;
  try {
    ({ header } = await lib.reader.readHeader(filePath));
  } catch (e) {
    throw fromLibError(e);
  }
  if (isDryRun(header)) throw new SyncError("not-applicable", messageFor("not-applicable"));

  const exporter = await findExporter(header.exporterId);
  if (!exporter) {
    let info;
    try {
      info = await lib.reader.inspectNewExporter(filePath);
    } catch (e) {
      throw fromLibError(e);
    }
    return {
      needsApproval: true,
      info: {
        exporterId: info.exporterId,
        keyId: info.keyId,
        keyIdFormatted: info.keyIdFormatted || formatKeyId(info.keyId),
        publicKeyPem: info.publicKeyPem,
      },
      header,
    };
  }
  if (header.exporterKeyId && header.exporterKeyId !== exporter.key_id) {
    throw new SyncError("exporter-key-changed", messageFor("exporter-key-changed"), 409);
  }
  try {
    const out = await lib.reader.verifyPackage(filePath, {
      exporterPublicKeyPem: exporter.public_key,
    });
    return { header: out.header || header, payloadOffset: out.payloadOffset, exporter };
  } catch (e) {
    throw fromLibError(e);
  }
}

/** Async iterator over decrypted records. Call only after verifyFile(). */
function readRecords(filePath, header, payloadOffset) {
  return shared.lib().reader.readRecords(filePath, {
    websitePrivateKeyPem: websiteKey().privateKeyPem,
    header,
    payloadOffset,
  });
}

module.exports = {
  SyncError,
  MESSAGES,
  messageFor,
  fromLibError,
  websiteKey,
  _resetWebsiteKey,
  findExporter,
  listExporters,
  registerExporter,
  formatKeyId,
  lastAppliedSeq,
  checkSequence,
  checkHeader,
  verifyFile,
  readRecords,
  isDryRun,
};
