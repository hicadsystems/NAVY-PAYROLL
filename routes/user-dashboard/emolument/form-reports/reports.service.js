/**
 * FILE: routes/user-dashboard/emolument/reports/emolument-reports.service.js
 *
 * Validates the request, resolves scope per role, fetches rows, and shapes
 * both the tabular data (for Excel) and the Handlebars view-model (for PDF).
 */

"use strict";

const repo = require("./reports.repository");
const { CLASS_NAMES, getStageConfig, getStageMeta, listStages } = require("./reports.config");

const VALID_ROLES = ["DO", "FO", "CPO"];

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(value) {
  const d = new Date(value);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${fmtDate(d)}, ${time}`;
}

// ─────────────────────────────────────────────────────────────
// SCOPE RESOLUTION
//
// DO/FO: ship comes from the route/session — mandatory, single value.
//   (If an officer is ever assigned to more than one ship, the route
//   layer should loop this per-ship or the caller should pass the one
//   currently selected; this service just requires *a* ship string.)
//
// CPO: command/ship are both optional query filters. Per spec, if a
//   command is chosen after a ship, the ship selection should be cleared
//   client-side (enforced in the front end, not here) — this layer just
//   applies whatever combination it's given.
// ─────────────────────────────────────────────────────────────

function validateRequest({ role, stage, ship, command }) {
  if (!VALID_ROLES.includes(role)) {
    return { ok: false, code: 400, message: `Unknown role: ${role}` };
  }
  const stageCfg = getStageConfig(role, stage);
  if (!stageCfg) {
    return {
      ok: false,
      code: 400,
      message: `Unknown report stage '${stage}' for ${role}. Valid: ${listStages(role).join(", ")}`,
    };
  }
  if (stageCfg.scopeMode === "ship" && !ship) {
    return { ok: false, code: 400, message: "Ship is required for this report." };
  }
  return { ok: true, stageCfg };
}

async function fetchReport({ role, stage, ship, command, performedBy }) {
  const validation = validateRequest({ role, stage, ship, command });
  if (!validation.ok) return validation;

  const rows = await repo.getReportRows({ role, stage, ship, command, performedBy });
  if (!rows.length) {
    return {
      ok: false,
      code: 404,
      message: "No forms found for this report. Nothing to generate.",
    };
  }

  return { ok: true, rows, stageCfg: validation.stageCfg };
}

// Flat rows for Excel / JSON — one row per form, ready to hand to
// GenericExcelExporter or res.json().
function toTableRows(rows) {
  return rows.map((r, i) => ({
    sn: i + 1,
    serviceNumber: r.serviceNumber,
    rank: r.Rank || "",
    fullName: `${r.Surname || ""} ${r.OtherName || ""}`.trim(),
    className: CLASS_NAMES[r.classes] || "—",
    ship: r.ship || "",
    command: r.command || "",
    formNumber: r.formNumber || "—",
    formYear: r.FormYear || "—",
    officer: [r.officer_rank, r.officer_name].filter(Boolean).join(" ") || "—",
    officerSvcNo: r.officer_svcno || "",
    actionDate: fmtDate(r.action_date),
    remarks: r.remarks || "",
  }));
}

// Nested view-model for the Handlebars PDF template.
function buildViewModel({ role, stage, scopeLabel, rows, performedByName, performedByRank, performedBySvcNo }) {
  const meta = getStageMeta(role, stage);
  const data = toTableRows(rows);

  const byClass = {};
  rows.forEach((r) => {
    const name = CLASS_NAMES[r.classes] || "Other";
    byClass[name] = (byClass[name] || 0) + 1;
  });

  return {
    title: meta.title,
    dateLabel: meta.dateLabel,
    showRemarks: stage === "rejected",
    scopeLabel, // e.g. ship name, or "All Commands · All Ships" for CPO
    producedOn: fmtDateTime(new Date()),
    preparedBy: [performedByRank, performedByName].filter(Boolean).join(" "),
    preparedBySvcNo: performedBySvcNo,
    data,
    statistics: {
      total: data.length,
      byClass: Object.entries(byClass).map(([name, count]) => ({ name, count })),
    },
  };
}

async function getFilterOptions({ role, command }) {
  if (role === "CPO") {
    const [commands, ships] = await Promise.all([
      repo.getCommands(),
      repo.getShips(command ? { command } : {}),
    ]);
    return { ok: true, data: { commands, ships } };
  }
  // DO/FO don't get a command/ship picker here — the route layer scopes
  // them to their assigned ship(s) directly. Nothing to fetch.
  return { ok: true, data: {} };
}

module.exports = {
  fetchReport,
  toTableRows,
  buildViewModel,
  getFilterOptions,
  fmtDate,
  fmtDateTime,
};