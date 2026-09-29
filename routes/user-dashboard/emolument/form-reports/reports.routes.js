/**
 * FILE: routes/user-dashboard/emolument/reports/emolument-reports.routes.js
 *
 * Not mounted directly — this exports a factory that each role's thin
 * routes file (fo.reports.routes.js / do.reports.routes.js /
 * cpo.reports.routes.js) calls to build its own router. That thin router
 * is then mounted from inside the role's existing main routes file
 * (fo.routes.js etc.), which already applies verifyToken, so this factory
 * does not apply it again — only the role guard.
 */

"use strict";

const express = require("express");
const controller = require("./reports.controller");

/**
 * @param {string} role - "DO" | "FO" | "CPO"
 * @param {Function} requireEmolRole - same middleware factory fo.routes.js
 *   already uses, e.g. requireEmolRole("FO").
 * @param {string} mountPath - path prefix for :stage, relative to wherever
 *   the returned router gets mounted. Ship-scoped roles (DO/FO) should
 *   include ":ship" here, e.g. "/ship/:ship/reports"; CPO (global) just
 *   uses "/reports".
 */
function buildReportRoutes({ role, requireEmolRole, mountPath }) {
  const router = express.Router({ mergeParams: true });

  // Filter options (commands/ships) only make sense for the global role.
  // DO/FO already know their ship from the route param, same as every
  // other fo.routes.js endpoint.
  if (role === "CPO") {
    router.get(`${mountPath}/filter-options`, requireEmolRole(role), (req, res) =>
      controller.getFilterOptions(req, res, role),
    );
  }

  // GET {mountPath}/:stage?format=pdf|excel|json[&command=&ship=]
  router.get(`${mountPath}/:stage`, requireEmolRole(role), (req, res) =>
    controller.generateReport(req, res, role),
  );

  return router;
}

module.exports = { buildReportRoutes };