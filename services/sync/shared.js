// ============================================================
// Payslip Sync — the shared library from navy-payslip-sync
// services/sync/shared.js
//
// Everything about the package file (format, crypto, manifest) comes
// from Dev A's repo, installed as a dependency pinned to a tag:
//   "navy-payslip-sync": "github:hicadsystems/navy-payslip-sync#v0.1.2"
//
// SYNC_SHARED_MODULE can point at another module path (tests only).
// ============================================================

let _lib = null;

function lib() {
  if (_lib) return _lib;
  const id = process.env.SYNC_SHARED_MODULE || "navy-payslip-sync";
  try {
    _lib = require(id);
  } catch (e) {
    const err = new Error(
      `Payslip sync library '${id}' is not installed. Run npm install ` +
        `(package.json pins navy-payslip-sync to a tag). ${e.message}`,
    );
    err.code = "sync-lib-missing";
    throw err;
  }
  return _lib;
}

/** For tests: replace the library. */
function _setLib(l) {
  _lib = l;
}

/**
 * Table definition from the shared manifest, matched case-insensitively.
 * Returns null for a table the manifest does not list.
 */
function manifestTable(name) {
  const m = lib().manifest;
  if (typeof m.findTable === "function") return m.findTable(name) || null;
  const n = String(name).toLowerCase();
  return (m.TABLES || []).find((t) => String(t.table || t.name).toLowerCase() === n) || null;
}

/**
 * A table's definition resolved for one database and package kind
 * ({ name, key, mode, applyAt, scope, rollback }), via manifest.tablesFor().
 * Falls back to the raw manifest entry.
 */
function tableDef(name, dbKey, kind) {
  const m = lib().manifest;
  const n = String(name).toLowerCase();
  if (typeof m.tablesFor === "function" && dbKey && kind) {
    try {
      const plan = kind === "dryrun" ? "month" : kind;
      const t = m.tablesFor(dbKey, plan).find((x) => String(x.name || x.table).toLowerCase() === n);
      if (t) return t;
    } catch (_) {}
  }
  return manifestTable(name);
}

/** Tables Go live swaps for a package kind. */
function goliveTables(kind) {
  const m = lib().manifest;
  const list = m.goliveTables(kind) || [];
  return list.map((t) => (typeof t === "string" ? t : t.table || t.name));
}

function hrEmployeesPayrollColumns() {
  return (lib().manifest.HR_EMPLOYEES_PAYROLL_COLUMNS || []).map((c) =>
    String(c).toLowerCase(),
  );
}

/** "9F3A-71C2-0B8E" from a payload hash. */
function fingerprint(payloadSha256) {
  const f = lib().format;
  if (f && typeof f.fingerprint === "function") return f.fingerprint(payloadSha256);
  const h = String(payloadSha256).slice(0, 12).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

module.exports = {
  lib,
  _setLib,
  manifestTable,
  tableDef,
  goliveTables,
  hrEmployeesPayrollColumns,
  fingerprint,
};
