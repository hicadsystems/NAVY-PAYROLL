/**
 * FILE: routes/user-dashboard/emolument/do/do.reports.routes.js
 *
 * CONFIRM: assumes do.routes.js exists alongside fo.routes.js with the
 * same "/ship/:ship/..." mounting convention and its own verifyToken +
 * requireEmolRole("DO") already in place. Adjust mountPath if DO's routes
 * are shaped differently.
 *
 * Mount from do.routes.js, after its existing `router.use(verifyToken)`:
 *
 *   router.use(require("./do.reports.routes"));
 *
 * Produces:
 *   GET /do/ship/:ship/reports/:stage?format=pdf|excel|json
 *   stage ∈ pending | reviewed | rejected   (see emolument-reports.config.js)
 */

"use strict";

const { requireEmolRole } = require("../../../../middware/emolumentAuth");
const { buildReportRoutes } = require("../form-reports/reports.routes");

module.exports = buildReportRoutes({
  role: "DO",
  requireEmolRole,
  mountPath: "/ship/:ship/reports",
});