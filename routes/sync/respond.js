// Shared JSON responses for /api/sync.

function send(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, e) {
  const status = e && e.status ? e.status : e && e.code && !/^ER_/.test(e.code) ? 400 : 500;
  if (status >= 500) console.error("❌ /api/sync:", e);
  const body = {
    success: false,
    code: (e && e.code) || "error",
    message: (e && e.message) || "Something went wrong.",
  };
  for (const k of ["lastAppliedSeq", "missing", "packageId", "packageStatus", "failures", "detail"]) {
    if (e && e[k] !== undefined) body[k] = e[k];
  }
  return res.status(status).json(body);
}

module.exports = { send, fail };
