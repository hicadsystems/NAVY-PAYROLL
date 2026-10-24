// ============================================================
// Payslip Sync — who did what
// middware/syncAuth.js
//
// Access to Payslip Sync is controlled by the app's existing roles and
// permissions (which users see the Payslip Sync screen). The API only
// requires a logged-in user (verifyToken); this file just names the user
// for the log columns (uploaded_by, published_by, registered_by, ...).
// ============================================================

/** Name recorded in the log columns. Use after verifyToken. */
function actor(req) {
  return String(req.user_fullname || req.user_name || req.user_id || "unknown").slice(0, 100);
}

module.exports = { actor };
