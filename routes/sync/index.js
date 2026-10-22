// Payslip Sync API, mounted at /api/sync in routes/index.js.

const express = require("express");
const runSvc = require("../../services/sync/run.service");

const router = express.Router();
router.use(require("./packages.routes"));
router.use(require("./admin.routes"));

// A restart during processing leaves a run that can never finish.
runSvc.recoverInterruptedRuns().then((n) => {
  if (n) console.log(`⚠️ payslip sync: marked ${n} interrupted run(s) as failed`);
});

module.exports = router;
