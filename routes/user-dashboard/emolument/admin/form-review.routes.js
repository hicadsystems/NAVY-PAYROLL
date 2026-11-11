/**
 * FILE: routes/user-dashboard/emolument/admin/form-review.routes.js
 *
 * Admin "Review & Approve" section — review, approve or reject forms for
 * any ship or command. Mounted at /admin. EMOL_ADMIN only.
 *
 * ─── ROUTE MAP ───────────────────────────────────────────────
 *
 *  GET  /admin/form-review/settings      → { adminCanEditForms }
 *  PUT  /admin/form-review/settings      → Body: { adminCanEditForms: boolean }
 *
 *  GET  /admin/form-review/forms         → alphabetical list, any status
 *                                          ?q=a,b,c  (comma-separated name /
 *                                                     service number terms)
 *                                          &ship= &command= &payrollclass=
 *                                          &page=1 &pageSize=25
 *  GET  /admin/form-review/status?svcno= → one form's stage + next stage
 *
 *  POST /admin/form-review/progress      → move forms ONE stage forward
 *                                          Body: { items: [{ serviceNumber, stage }],
 *                                                  remarks?, allowNotFilled? }
 *  POST /admin/form-review/reject        → reject at any stage after submission
 *                                          Body: { serviceNumber, remarks }
 *  PUT  /admin/form-review/form?svcno=   → save every form field, any status
 *                                          (only while adminCanEditForms is on)
 *                                          Body: same shape as PUT /form/save
 */

"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../../../config/db");
const config = require("../../../../config");
const verifyToken = require("../../../../middware/authentication");
const { requireEmolRole } = require("../../../../middware/emolumentAuth");
const service = require("./form-review.service");

const DB = () => process.env.DB_OFFICERS || config.databases.officers;

router.use("/form-review", (req, res, next) => {
  pool.useDatabase(DB());
  next();
});
router.use("/form-review", verifyToken, requireEmolRole("EMOL_ADMIN"));

const currentUser = (req) => ({
  svcNo: req.user_id,
  name: req.user_name,
  rank: req.user_rank,
});

function send(res, result, { created = false } = {}) {
  if (!result.success) return res.status(result.code || 400).json({ error: result.message });
  if (result.message)
    return res.status(created ? 201 : 200).json({ message: result.message, data: result.data });
  return res.json(result.data);
}

function handle(label, fn) {
  return async (req, res) => {
    try {
      return send(res, await fn(req));
    } catch (err) {
      console.error(`❌ ${label}:`, err);
      if (!res.headersSent) return res.status(500).json({ error: "Server error" });
    }
  };
}

router.get(
  "/form-review/settings",
  handle("GET /admin/form-review/settings", () => service.getSettings()),
);

router.put(
  "/form-review/settings",
  handle("PUT /admin/form-review/settings", (req) =>
    service.updateSettings(req.body, currentUser(req), req.ip),
  ),
);

router.get(
  "/form-review/forms",
  handle("GET /admin/form-review/forms", (req) => service.listForms(req.query)),
);

router.get(
  "/form-review/status",
  handle("GET /admin/form-review/status", (req) =>
    service.getFormStatus(String(req.query.svcno ?? "").trim()),
  ),
);

router.post(
  "/form-review/progress",
  handle("POST /admin/form-review/progress", (req) =>
    service.progressForms(req.body, currentUser(req), req.ip),
  ),
);

router.post(
  "/form-review/reject",
  handle("POST /admin/form-review/reject", (req) =>
    service.rejectForm(req.body, currentUser(req), req.ip),
  ),
);

router.put(
  "/form-review/form",
  handle("PUT /admin/form-review/form", (req) =>
    service.saveForm(String(req.query.svcno ?? "").trim(), req.body, currentUser(req), req.ip),
  ),
);

module.exports = router;
