// ============================================================
// Payslip Sync — who may use /api/sync, and who did what
// middware/syncAuth.js
//
// Contract (navy-payslip-sync docs, security.md): Upload, Go live,
// Withdraw and Roll back need the sync role; approving an exporter
// needs a super admin. Hiding the menu is not enough: the API checks
// the role itself on every call.
//
//   requireSync       payroll login (not a staff payslip login) whose role
//                     has the Payslip Sync menu, or is a sync admin role
//   requireSyncAdmin  a sync admin role only (approve exporter keys)
//
// Settings (.env):
//   SYNC_ADMIN_ROLES  comma list, default "HICAD"
//   SYNC_MENU_KEYS    menu keys that grant the sync role, default "payslip-sync"
//
// Use after verifyToken.
// ============================================================

const db = require("../services/sync/db");

const CACHE_MS = 60 * 1000;
const cache = new Map(); // role name → { ok, at }

function list(v, dflt) {
  return String(v == null || v === "" ? dflt : v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function adminRoles() {
  return list(process.env.SYNC_ADMIN_ROLES, "HICAD");
}

function menuKeys() {
  return list(process.env.SYNC_MENU_KEYS, "payslip-sync");
}

function roleOf(req) {
  return String(req.user_role || "").trim();
}

function isSyncAdmin(req) {
  const r = roleOf(req).toLowerCase();
  return !!r && adminRoles().includes(r);
}

/** Does this role have one of the Payslip Sync menu keys? (cached 60 s) */
async function roleHasSyncMenu(role) {
  const k = role.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  const keys = menuKeys();
  const [rows] = await db.query(
    `SELECT 1 FROM ${db.ctl("roles")} r
       JOIN ${db.ctl("role_menu_permissions")} p ON p.role_id = r.id
       JOIN ${db.ctl("menu_items")} m ON m.id = p.menu_item_id
     WHERE r.name = ? AND m.menu_key IN (${keys.map(() => "?").join(", ")})
     LIMIT 1`,
    [role, ...keys],
  );
  const ok = rows.length > 0;
  cache.set(k, { ok, at: Date.now() });
  return ok;
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

/** A payroll user, not a staff member logged in to print a payslip. */
function payrollLogin(req, res) {
  if (!req.current_class) {
    deny(res, 403, "forbidden", "Payslip Sync needs a payroll login.");
    return false;
  }
  if (!roleOf(req)) {
    deny(res, 403, "forbidden", "Your role could not be read. Log in again.");
    return false;
  }
  return true;
}

async function requireSync(req, res, next) {
  try {
    if (!payrollLogin(req, res)) return;
    if (isSyncAdmin(req) || (await roleHasSyncMenu(roleOf(req)))) {
      await db.refreshClasses(); // payroll classes from py_payrollclass (cached 60 s)
      return next();
    }
    return deny(res, 403, "forbidden", "Your role does not have access to Payslip Sync.");
  } catch (e) {
    console.error("❌ /api/sync role check:", e.message);
    return deny(res, 500, "error", "Could not check your access to Payslip Sync.");
  }
}

async function requireSyncAdmin(req, res, next) {
  if (!payrollLogin(req, res)) return;
  if (!isSyncAdmin(req)) return deny(res, 403, "forbidden", "Only a super admin can approve an exporter.");
  await db.refreshClasses();
  return next();
}

/** Name recorded in the log columns (uploaded_by, published_by, ...). */
function actor(req) {
  return String(req.user_fullname || req.user_name || req.user_id || "unknown").slice(0, 100);
}

/** For the Console: what this user may do. */
function access(req) {
  return { role: roleOf(req) || null, admin: isSyncAdmin(req) };
}

module.exports = { requireSync, requireSyncAdmin, isSyncAdmin, actor, access };
