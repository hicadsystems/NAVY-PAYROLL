/**
 * FILE: public/fragments/emolument-reports.js
 *
 * Drives the reports page fragment for DO, FO, and CPO alike. Each role's
 * HTML fragment includes this file and calls EmolReports.init({ role }).
 *
 * CONFIRM: assumes `localStorage.getItem("token")` and, for ship-scoped
 * roles, `sessionStorage.getItem("active_ship")` — the same conventions
 * your existing FO dashboard/approved-list fragments already use.
 */

(function () {
  "use strict";

  const ROLE_UI = {
    DO: {
      subtitle: "Divisional Officer",
      scoped: true,
      basePath: (ship) => `/do/ship/${encodeURIComponent(ship)}/reports`,
      stages: [
        { key: "pending", label: "Pending DO Review", icon: "fa-hourglass-half" },
        { key: "reviewed", label: "Reviewed by Me", icon: "fa-check-circle" },
        { key: "rejected", label: "Rejected by Me", icon: "fa-times-circle" },
      ],
    },
    FO: {
      subtitle: "Financial Officer",
      scoped: true,
      basePath: (ship) => `/fo/ship/${encodeURIComponent(ship)}/reports`,
      stages: [
        { key: "pending", label: "Pending FO Approval", icon: "fa-hourglass-half" },
        { key: "approved", label: "Approved by Me", icon: "fa-check-circle" },
        { key: "rejected", label: "Rejected by Me", icon: "fa-times-circle" },
      ],
    },
    CPO: {
      subtitle: "Central Pay Office",
      scoped: false,
      basePath: () => `/cpo/reports`,
      stages: [
        { key: "pending", label: "Pending CPO Confirmation", icon: "fa-hourglass-half" },
        { key: "confirmed", label: "Confirmed", icon: "fa-check-circle" },
        { key: "rejected", label: "Rejected", icon: "fa-times-circle" },
      ],
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function showMessage(title, message, isError) {
    el("reports-message-icon").innerHTML = isError
      ? '<i class="fas fa-exclamation-circle text-red-500"></i>'
      : '<i class="fas fa-check-circle text-green-500"></i>';
    el("reports-message-title").textContent = title;
    el("reports-message-text").textContent = message;
    el("reports-message-modal").classList.remove("hidden");
  }

  function init({ role }) {
    const cfg = ROLE_UI[role];
    if (!cfg) {
      console.error("EmolReports: unknown role", role);
      return;
    }

    const token = localStorage.getItem("token") || "";
    const ship = cfg.scoped ? sessionStorage.getItem("active_ship") || "" : null;

    let selectedStage = cfg.stages[0].key;
    let commandCode = "";
    let shipFilter = "";
    let currentBlob = null;
    let currentFormat = "pdf";
    let currentBlobUrl = null;

    el("reports-subtitle").textContent = cfg.subtitle + (ship ? ` — ${ship}` : "");

    // ── Stage picker ──────────────────────────────────────────────
    const stageContainer = el("reports-stage-options");
    stageContainer.innerHTML = cfg.stages
      .map(
        (s, i) => `
      <button type="button" data-stage="${s.key}"
        class="stage-btn flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-bold transition-colors text-left
               ${i === 0 ? "border-navy bg-navy text-white" : "border-amber-100 bg-white text-navy hover:border-navy/40"}">
        <i class="fas ${s.icon}"></i> ${s.label}
      </button>`,
      )
      .join("");

    stageContainer.querySelectorAll(".stage-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedStage = btn.dataset.stage;
        stageContainer.querySelectorAll(".stage-btn").forEach((b) => {
          b.classList.remove("border-navy", "bg-navy", "text-white");
          b.classList.add("border-amber-100", "bg-white", "text-navy");
        });
        btn.classList.remove("border-amber-100", "bg-white", "text-navy");
        btn.classList.add("border-navy", "bg-navy", "text-white");
      });
    });

    // ── CPO-only command/ship cascade ───────────────────────────────
    if (!cfg.scoped) {
      el("reports-scope-filters").classList.remove("hidden");
      const commandSelect = el("reports-command-select");
      const shipSelect = el("reports-ship-select");

      async function loadShips(command) {
        shipSelect.innerHTML = '<option value="">All Ships</option>';
        try {
          const qs = command ? `?command=${encodeURIComponent(command)}` : "";
          const res = await fetch(`/cpo/reports/filter-options${qs}`, {
            headers: { Authorization: "Bearer " + token },
          });
          const json = await res.json();
          (json.data?.ships || []).forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s.ship;
            opt.textContent = s.ship;
            shipSelect.appendChild(opt);
          });
        } catch (e) {
          console.error("Failed to load ships:", e);
        }
      }

      async function loadCommands() {
        try {
          const res = await fetch("/cpo/reports/filter-options", {
            headers: { Authorization: "Bearer " + token },
          });
          const json = await res.json();
          (json.data?.commands || []).forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.code;
            opt.textContent = c.name;
            commandSelect.appendChild(opt);
          });
        } catch (e) {
          console.error("Failed to load commands:", e);
        }
      }

      commandSelect.addEventListener("change", () => {
        commandCode = commandSelect.value;
        // Command chosen after a ship was picked → clear the ship
        // selection, per spec (command narrows first).
        shipFilter = "";
        loadShips(commandCode);
      });

      shipSelect.addEventListener("change", () => {
        shipFilter = shipSelect.value;
      });

      loadCommands();
      loadShips("");
    }

    // ── Generate ─────────────────────────────────────────────────
    el("reports-generate-btn").addEventListener("click", async () => {
      if (cfg.scoped && !ship) {
        return showMessage(
          "No Ship Selected",
          "Could not determine your active ship. Please select a ship and try again.",
          true,
        );
      }

      const format = document.querySelector('input[name="reports-format"]:checked')?.value || "pdf";
      currentFormat = format;

      let url = `${cfg.basePath(ship)}/${selectedStage}?format=${format}`;
      if (!cfg.scoped) {
        if (commandCode) url += `&command=${encodeURIComponent(commandCode)}`;
        if (shipFilter) url += `&ship=${encodeURIComponent(shipFilter)}`;
      }

      const btn = el("reports-generate-btn");
      const originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating…';

      try {
        const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to generate report.");
        }

        const blob = await res.blob();
        currentBlob = blob;

        const iframe = el("reports-preview-iframe");
        const dlBtn = el("reports-preview-download");
        const stageMeta = cfg.stages.find((s) => s.key === selectedStage);
        el("reports-preview-title").textContent = stageMeta ? stageMeta.label : "Report Preview";

        if (format === "pdf") {
          if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = URL.createObjectURL(blob);
          iframe.removeAttribute("srcdoc");
          iframe.src = currentBlobUrl + "#toolbar=0";
          dlBtn.textContent = "Download PDF";
        } else {
          iframe.src = "about:blank";
          iframe.srcdoc = `<div style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#555;">
            <p style="font-size:16pt;font-weight:bold;color:#1e40af;margin-bottom:8px;">Excel Report Ready</p>
            <p style="font-size:10pt;">Click <strong>Download Excel</strong> below to save the file.</p>
          </div>`;
          dlBtn.textContent = "Download Excel";
        }

        el("reports-preview-modal").classList.remove("hidden");
      } catch (err) {
        showMessage("Could Not Generate Report", err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
      }
    });

    // ── Preview modal controls ──────────────────────────────────────
    function closePreview() {
      el("reports-preview-modal").classList.add("hidden");
      const iframe = el("reports-preview-iframe");
      iframe.src = "about:blank";
      iframe.removeAttribute("srcdoc");
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }
    }

    el("reports-preview-close").addEventListener("click", closePreview);
    el("reports-preview-cancel").addEventListener("click", closePreview);
    el("reports-preview-download").addEventListener("click", () => {
      if (!currentBlob) return;
      const url = URL.createObjectURL(currentBlob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${role}_${selectedStage}_${stamp}.${currentFormat === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    el("reports-message-close").addEventListener("click", () => {
      el("reports-message-modal").classList.add("hidden");
    });
  }

  window.EmolReports = { init };
})();