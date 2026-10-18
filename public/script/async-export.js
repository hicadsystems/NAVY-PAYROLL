// ============================================================================
// public/script/async-export.js
//
// Load this before any other script that calls fetch().
//
// Adds `X-Async-Export: 1` to same-origin fetches. When the server answers an
// export with `202` + `X-Export-Job`, this polls /async-jobs/:id and resolves
// the ORIGINAL fetch() promise with the finished file's Response, so callers
// that do `response.ok` / `response.blob()` / `response.json()` work unchanged.
// ============================================================================
(function () {
  if (window.__asyncExportInstalled) return;
  window.__asyncExportInstalled = true;

  var nativeFetch = window.fetch.bind(window);
  var POLL_MS = 2000;
  var MAX_WAIT_MS = 35 * 60 * 1000; // a little over the server's job ceiling

  function isSameOrigin(input) {
    try {
      var url = new URL(String(input), window.location.href);
      return url.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function errorResponse(status, text) {
    return new Response(JSON.stringify({ error: text }), {
      status: status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (e) {}
  }

  async function waitForJob(jobId, authHeader, sourceUrl) {
    var headers = {};
    if (authHeader) headers.Authorization = authHeader;

    var statusUrl = "/async-jobs/" + encodeURIComponent(jobId);
    var started = Date.now();
    var networkFailures = 0;

    emit("async-export:pending", { jobId: jobId, url: sourceUrl });

    while (Date.now() - started < MAX_WAIT_MS) {
      await sleep(POLL_MS);

      var status;
      try {
        var r = await nativeFetch(statusUrl, {
          headers: headers,
          cache: "no-store",
        });
        if (r.status === 404) {
          emit("async-export:failed", { jobId: jobId, url: sourceUrl });
          return errorResponse(
            410,
            "The report expired before it could be downloaded. Please generate it again.",
          );
        }
        status = await r.json();
        networkFailures = 0;
      } catch (e) {
        // Short network blip (Wi-Fi, tunnel reconnect) — keep waiting
        if (++networkFailures > 30) {
          return errorResponse(503, "Lost connection while waiting for the report.");
        }
        continue;
      }

      emit("async-export:progress", {
        jobId: jobId,
        url: sourceUrl,
        status: status.status,
        queuePosition: status.queuePosition,
        elapsedMs: status.elapsedMs,
      });

      if (status.status === "done") {
        var result = await nativeFetch(statusUrl + "/result", {
          headers: headers,
          cache: "no-store",
        });
        emit("async-export:done", { jobId: jobId, url: sourceUrl });
        return result;
      }

      if (status.status === "failed") {
        emit("async-export:failed", { jobId: jobId, url: sourceUrl });
        return errorResponse(502, status.error || "Report generation failed.");
      }
    }

    emit("async-export:failed", { jobId: jobId, url: sourceUrl });
    return errorResponse(
      504,
      "The report is taking too long. Try a smaller range or try again later.",
    );
  }

  window.fetch = async function (input, init) {
    // Request objects and cross-origin calls pass straight through
    if (typeof Request !== "undefined" && input instanceof Request) {
      return nativeFetch(input, init);
    }
    if (!isSameOrigin(input)) return nativeFetch(input, init);

    var opts = Object.assign({}, init || {});
    var headers = new Headers(opts.headers || {});
    headers.set("X-Async-Export", "1");
    opts.headers = headers;

    var response = await nativeFetch(input, opts);

    var jobId =
      response.status === 202 ? response.headers.get("X-Export-Job") : null;
    if (!jobId) return response;

    return waitForJob(jobId, headers.get("Authorization"), String(input));
  };
})();
