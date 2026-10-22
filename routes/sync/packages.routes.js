// ============================================================
// Payslip Sync — resumable package upload
// routes/sync/packages.routes.js   (mounted at /api/sync)
//
// POST /packages                         header JSON → fingerprint, chunks held
// PUT  /packages/:fingerprint/chunks/:n  raw bytes (8 MB)
// POST /packages/:fingerprint/complete   → run id, processing starts
// POST /packages/:fingerprint/cancel     drop an unfinished upload
// POST /packages/:fingerprint/reprocess  run a received package again
// ============================================================

const express = require("express");
const verifyToken = require("../../middware/authentication");
const { actor } = require("../../middware/syncAuth");
const upload = require("../../services/sync/upload.service");
const runSvc = require("../../services/sync/run.service");
const { send, fail } = require("./respond");

const router = express.Router();
const rawChunk = express.raw({ type: () => true, limit: upload.CHUNK_SIZE + 1024 });

router.post("/packages", verifyToken, async (req, res) => {
  try {
    const { header, totalBytes } = req.body || {};
    const out = await upload.startUpload({ header, totalBytes, by: actor(req) });
    return send(res, out, out.resumed ? 200 : 201);
  } catch (e) {
    return fail(res, e);
  }
});

router.put("/packages/:fingerprint/chunks/:n", verifyToken, rawChunk, async (req, res) => {
  try {
    const out = await upload.putChunk(req.params.fingerprint, req.params.n, req.body);
    return send(res, out);
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/packages/:fingerprint/complete", verifyToken, async (req, res) => {
  try {
    const p = await upload.completeUpload(req.params.fingerprint);
    // checkOnly: verify and compare everything, load nothing (Console "Check only")
    const checkOnly = !!(req.body && req.body.checkOnly);
    const r = checkOnly ? await runSvc.startCheck(p.id, actor(req)) : await runSvc.startRun(p.id, actor(req));
    return send(res, { status: "received", packageId: p.id, checkOnly, ...r }, 202);
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/packages/:fingerprint/cancel", verifyToken, async (req, res) => {
  try {
    return send(res, await upload.cancelUpload(req.params.fingerprint));
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/packages/:fingerprint/check", verifyToken, async (req, res) => {
  try {
    const p = await upload.getPackageByFingerprint(req.params.fingerprint);
    if (!p) return fail(res, Object.assign(new Error("Unknown package."), { code: "not-found", status: 404 }));
    if (p.status !== "received") return fail(res, Object.assign(new Error(`Package is ${p.status}.`), { code: "bad-request" }));
    return send(res, { packageId: p.id, ...(await runSvc.startCheck(p.id, actor(req))) }, 202);
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/packages/:fingerprint/reprocess", verifyToken, async (req, res) => {
  try {
    const p = await upload.getPackageByFingerprint(req.params.fingerprint);
    if (!p) return fail(res, Object.assign(new Error("Unknown package."), { code: "not-found", status: 404 }));
    const r = await runSvc.reprocess(p.id, actor(req));
    return send(res, { packageId: p.id, ...r }, 202);
  } catch (e) {
    return fail(res, e);
  }
});

module.exports = router;
