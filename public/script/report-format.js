/**
 * report-format.js
 *
 * Shared "PDF or Excel?" picker for report/print buttons.
 *
 *   const fmt = await chooseReportFormat(buttonEl);   // 'pdf' | 'excel' | null
 *   await downloadReportExcel({ endpoint, params, headers, filename });
 *
 * The Excel download calls the same endpoint as the PDF with ?format=excel.
 */
(function (global) {
  "use strict";
  if (global.chooseReportFormat) return;

  var STYLE_ID = "report-format-style";
  var active = null; // { menu, anchor, done }
  var lastClosedAnchor = null;
  var lastClosedAt = 0;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".rf-menu{position:fixed;z-index:2147483000;min-width:170px;background:#fff;" +
      "border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 10px 25px -5px rgba(15,23,42,.18),0 4px 8px -4px rgba(15,23,42,.12);" +
      "padding:4px;font:600 12px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1e293b}" +
      ".rf-menu-title{padding:6px 10px 4px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8}" +
      ".rf-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:7px;" +
      "background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}" +
      ".rf-menu button:hover,.rf-menu button:focus-visible{background:#eff6ff;outline:none}" +
      ".rf-menu .rf-pdf{color:#dc2626}.rf-menu .rf-xls{color:#16a34a}" +
      ".rf-menu .rf-ico{width:14px;text-align:center}";
    (document.head || document.documentElement).appendChild(style);
  }

  function close(result) {
    if (!active) return;
    var a = active;
    active = null;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);
    if (a.menu.parentNode) a.menu.parentNode.removeChild(a.menu);
    a.done(result);
  }

  function onOutside(e) {
    if (!active || active.menu.contains(e.target)) return;
    if (active.anchor && active.anchor.contains(e.target)) {
      // clicking the same button again just closes the menu
      lastClosedAnchor = active.anchor;
      lastClosedAt = Date.now();
    }
    close(null);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(null); }
  }
  function onDismiss(e) {
    if (active && e && e.target && active.menu.contains(e.target)) return;
    close(null);
  }

  function position(menu, anchor) {
    var r = anchor.getBoundingClientRect();
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function chooseReportFormat(anchor) {
    // Second click on the same button while the menu was open → just close.
    if (anchor && anchor === lastClosedAnchor && Date.now() - lastClosedAt < 400) {
      lastClosedAnchor = null;
      return Promise.resolve(null);
    }
    if (active) close(null);
    ensureStyle();

    return new Promise(function (resolve) {
      var menu = document.createElement("div");
      menu.className = "rf-menu";
      menu.setAttribute("role", "menu");
      menu.innerHTML =
        '<div class="rf-menu-title">Export as</div>' +
        '<button type="button" role="menuitem" data-fmt="pdf"><i class="fas fa-file-pdf rf-ico rf-pdf" aria-hidden="true"></i>PDF (print / preview)</button>' +
        '<button type="button" role="menuitem" data-fmt="excel"><i class="fas fa-file-excel rf-ico rf-xls" aria-hidden="true"></i>Excel (.xlsx)</button>';
      document.body.appendChild(menu);

      if (anchor && anchor.getBoundingClientRect) position(menu, anchor);
      else {
        menu.style.left = "50%";
        menu.style.top = "30%";
        menu.style.transform = "translateX(-50%)";
      }

      active = { menu: menu, anchor: anchor, done: resolve };

      menu.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-fmt]");
        if (btn) close(btn.getAttribute("data-fmt"));
      });
      menu.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        var items = Array.prototype.slice.call(menu.querySelectorAll("[data-fmt]"));
        var i = items.indexOf(document.activeElement);
        var next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      });

      setTimeout(function () {
        document.addEventListener("pointerdown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", onDismiss, true);
        window.addEventListener("scroll", onDismiss, true);
        var first = menu.querySelector("[data-fmt]");
        if (first) first.focus();
      }, 0);
    });
  }

  function filenameFrom(response, fallback) {
    var cd = response.headers.get("Content-Disposition") || "";
    var m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m) return decodeURIComponent(m[1]);
    return (fallback || "report") + "-" + new Date().toISOString().slice(0, 10) + ".xlsx";
  }

  async function downloadReportExcel(opts) {
    var params = new URLSearchParams(opts.params || "");
    params.set("format", "excel");
    var response = await fetch(opts.endpoint + "?" + params.toString(), {
      headers: opts.headers || {},
    });
    if (!response.ok) {
      var err = await response.json().catch(function () { return {}; });
      throw new Error(err.error || err.message || "Could not generate the Excel report.");
    }
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filenameFrom(response, opts.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  global.chooseReportFormat = chooseReportFormat;
  global.downloadReportExcel = downloadReportExcel;
})(window);
