// ============================================================
// Payslip Sync — Console API
// routes/sync/admin.routes.js   (mounted at /api/sync)
// ============================================================

const express = require("express");
const verifyToken = require("../../middware/authentication");
const { actor } = require("../../middware/syncAuth");
const db = require("../../services/sync/db");
const runSvc = require("../../services/sync/run.service");
const golive = require("../../services/sync/golive.service");
const publications = require("../../services/sync/publication.service");
const pkgSvc = require("../../services/sync/package.service");
const checks = require("../../services/sync/checks.service");
const { send, fail } = require("./respond");

const router = express.Router();
// Access: logged in; who sees Payslip Sync is set by the app's roles and permissions.
const guard = [verifyToken];

// ── status chips + overview cards ──────────────────────────
router.get("/status", ...guard, async (req, res) => {
  try {
    const [[lastPkg]] = await db.query(
      `SELECT id, fingerprint, exporter_id, seq, kind, period, status, upload_finished_at
       FROM ${db.ctl("sync_packages")} ORDER BY id DESC LIMIT 1`,
    );
    const [applied] = await db.query(
      `SELECT exporter_id, MAX(seq) AS seq FROM ${db.ctl("sync_packages")}
       WHERE status = 'applied' GROUP BY exporter_id`,
    );
    const [pubs] = await db.query(
      `SELECT database_name, period, status, staff_count, total_net, published_at, prepared_at
       FROM ${db.ctl("sync_publications")} ORDER BY period DESC`,
    );
    const [[lastLive]] = await db.query(
      `SELECT run_uuid, live_at, summary FROM ${db.ctl("sync_runs")}
       WHERE live_at IS NOT NULL ORDER BY live_at DESC LIMIT 1`,
    );
    // Only the latest applied run can go live; an older prepared run is stale.
    const latest = await golive.latestEffectiveRun();
    const prepared =
      latest && latest.status === "prepared"
        ? { run_uuid: latest.run_uuid, period: latest.period, seq: latest.seq }
        : null;

    const databases = db.DATABASE_KEYS.map((k) => {
      const mine = pubs.filter((p) => p.database_name === k);
      const live = mine.find((p) => p.status === "published");
      const prep = mine.find((p) => p.status === "prepared");
      return {
        database: k,
        schema: (() => {
          try {
            return db.schemaFor(k);
          } catch (_) {
            return null;
          }
        })(),
        livePeriod: live ? live.period : null,
        liveStaff: live ? live.staff_count : null,
        liveNet: live ? live.total_net : null,
        preparedPeriod: prep && prepared && prep.period === prepared.period ? prep.period : null,
        preparedStaff: prep && prepared && prep.period === prepared.period ? prep.staff_count : null,
        preparedNet: prep && prepared && prep.period === prepared.period ? prep.total_net : null,
      };
    });

    let lastPublish = null;
    if (lastLive) {
      const s = runSvc.parseSummary(lastLive.summary);
      lastPublish = { at: lastLive.live_at, runUuid: lastLive.run_uuid, machineMs: runSvc.machineMs(s.timings || {}) };
    }
    return send(res, {
      lastPackage: lastPkg || null,
      lastAppliedSeq: Object.fromEntries(applied.map((a) => [a.exporter_id, Number(a.seq)])),
      prepared: prepared || null,
      // Only the latest applied run can be rolled back.
      rollbackPeriod: latest && ["prepared", "live", "partly_rolled_back"].includes(latest.status) ? latest.period : null,
      lastPublish,
      databases,
    });
  } catch (e) {
    return fail(res, e);
  }
});

// ── system checks (Checks tab) ─────────────────────────────
router.get("/checks", ...guard, async (req, res) => {
  try {
    return send(res, await checks.systemChecks());
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/checks/golive-switch", ...guard, async (req, res) => {
  try {
    return send(res, await checks.probeGoLiveSwitch());
  } catch (e) {
    return fail(res, e);
  }
});

// ── runs ───────────────────────────────────────────────────
router.get("/runs", ...guard, async (req, res) => {
  try {
    return send(res, await runSvc.listRuns({ limit: req.query.limit }));
  } catch (e) {
    return fail(res, e);
  }
});

router.get("/runs/:runId", ...guard, async (req, res) => {
  try {
    const r = await runSvc.getRun(req.params.runId);
    if (!r) return fail(res, Object.assign(new Error("Unknown run."), { code: "not-found", status: 404 }));
    const s = r.summary || {};
    delete s.approvalKeyPem;
    let header = null;
    try {
      header = JSON.parse(r.header_json);
      delete header.exporterPublicKey;
      delete header.encryption;
    } catch (_) {}
    delete r.header_json;
    return send(res, { ...r, header, machineMs: runSvc.machineMs(s.timings || {}) });
  } catch (e) {
    return fail(res, e);
  }
});

// ── Go live / publications ─────────────────────────────────
router.post("/golive", ...guard, async (req, res) => {
  try {
    return send(res, await golive.goLive({ period: String((req.body || {}).period || ""), by: actor(req) }));
  } catch (e) {
    return fail(res, e);
  }
});

router.get("/publications", ...guard, async (req, res) => {
  try {
    return send(res, await publications.list({ limit: req.query.limit }));
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/publications/:db/:period/withdraw", ...guard, async (req, res) => {
  try {
    return send(res, await golive.withdraw({ dbKey: req.params.db, period: req.params.period, by: actor(req) }));
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/publications/:db/:period/rollback", ...guard, async (req, res) => {
  try {
    return send(res, await golive.rollback({ dbKey: req.params.db, period: req.params.period, by: actor(req) }));
  } catch (e) {
    return fail(res, e);
  }
});

// ── exporters ──────────────────────────────────────────────
router.get("/exporters", ...guard, async (req, res) => {
  try {
    const rows = await pkgSvc.listExporters();
    return send(res, rows.map((r) => ({ ...r, keyIdFormatted: pkgSvc.formatKeyId(r.key_id) })));
  } catch (e) {
    return fail(res, e);
  }
});

/**
 * Approve the exporter that made an uploaded package. The key comes from
 * the package (inspectNewExporter); the super admin confirms the key id
 * read out by the payroll officer. Processing then continues.
 */
router.post("/exporters/approve", ...guard, async (req, res) => {
  try {
    const { fingerprint, keyIdConfirmed } = req.body || {};
    const [[p]] = await db.query(`SELECT * FROM ${db.ctl("sync_packages")} WHERE fingerprint = ?`, [fingerprint]);
    if (!p) return fail(res, Object.assign(new Error("Unknown package."), { code: "not-found", status: 404 }));
    const v = await pkgSvc.verifyFile(p.file_path);
    if (!v.needsApproval) {
      return fail(res, Object.assign(new Error("This exporter is already approved."), { code: "bad-request" }));
    }
    const norm = (s) => String(s || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    if (!keyIdConfirmed || !norm(v.info.keyIdFormatted).startsWith(norm(keyIdConfirmed)) || norm(keyIdConfirmed).length < 16) {
      return fail(
        res,
        Object.assign(new Error("Type the key id shown on the exporter's screen to confirm."), {
          code: "key-id-mismatch",
          status: 400,
        }),
      );
    }
    const reg = await pkgSvc.registerExporter({
      exporterId: v.info.exporterId,
      publicKeyPem: v.info.publicKeyPem,
      keyId: v.info.keyId,
      by: actor(req),
    });
    const r = await runSvc.reprocess(p.id, actor(req));
    return send(res, { ...reg, ...r });
  } catch (e) {
    return fail(res, e);
  }
});

// Reconciliation (after the test day): package totals per database and period.
router.get("/reconciliation", ...guard, async (req, res) => {
  try {
    const params = [];
    let where = "1 = 1";
    if (req.query.db) {
      where += " AND database_name = ?";
      params.push(req.query.db);
    }
    if (req.query.period) {
      where += " AND period = ?";
      params.push(req.query.period);
    }
    const [rows] = await db.query(
      `SELECT database_name, period, status, staff_count, total_net FROM ${db.ctl("sync_publications")}
       WHERE ${where} ORDER BY period DESC, database_name`,
      params,
    );
    return send(res, { packageTotals: rows, note: "Website-side totals come with the Reconciliation tab." });
  } catch (e) {
    return fail(res, e);
  }
});

module.exports = router;
