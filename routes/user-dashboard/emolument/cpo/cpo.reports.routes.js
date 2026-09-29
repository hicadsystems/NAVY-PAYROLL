/**
 * FILE: routes/user-dashboard/emolument/cpo/cpo.reports.routes.js
 *
 * CONFIRM: assumes cpo.routes.js exists with its own verifyToken and
 * requireEmolRole("CPO") (or an isEmolAdmin bypass) already wired up,
 * matching fo.routes.js's pattern.
 *
 * Mount from cpo.routes.js, after its existing `router.use(verifyToken)`:
 *
 *   router.use(require("./cpo.reports.routes"));
 *
 * Produces:
 *   GET /cpo/reports/filter-options?command=CODE
 *   GET /cpo/reports/:stage?format=pdf|excel|json&command=CODE&ship=NAME
 *   stage ∈ pending | confirmed | rejected   (see emolument-reports.config.js)
 *
 * command and ship are both optional and independent, EXCEPT: if the
 * front end lets a user pick a ship first and then change command, it
 * must clear the ship selection (enforced client-side — see the report
 * page fragment's JS, not here).
 */

"use strict";

const { requireEmolRole } = require("../../../../middware/emolumentAuth");
const { buildReportRoutes } = require("../form-reports/reports.routes");

module.exports = buildReportRoutes({
  role: "CPO",
  requireEmolRole,
  mountPath: "/reports",
});