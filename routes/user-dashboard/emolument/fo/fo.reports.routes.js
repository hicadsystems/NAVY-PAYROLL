/**
 * FILE: routes/user-dashboard/emolument/fo/fo.reports.routes.js
 *
 * Mount this from fo.routes.js, after its existing `router.use(verifyToken)`:
 *
 *   router.use(require("./fo.reports.routes"));
 *
 * Produces:
 *   GET /fo/ship/:ship/reports/:stage?format=pdf|excel|json
 *   stage ∈ pending | approved | rejected   (see emolument-reports.config.js)
 */

"use strict";

const { requireEmolRole } = require("../../../../middware/emolumentAuth");
const { buildReportRoutes } = require("../form-reports/reports.routes");

module.exports = buildReportRoutes({
  role: "FO",
  requireEmolRole,
  mountPath: "/ship/:ship/reports",
});