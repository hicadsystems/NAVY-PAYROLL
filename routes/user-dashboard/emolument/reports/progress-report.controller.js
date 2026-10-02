"use strict";

const path = require("path");
const BaseReportController = require("../../../../controllers/Reports/reportsFallbackController");
const reportsService = require("./reports.service");

const TEMPLATE_PATH = path.join(
  __dirname,
  "../../../../templates/progress-report.html",
);

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCount(value) {
  return asNumber(value).toLocaleString("en-NG");
}

function formatPercent(value) {
  return `${asNumber(value).toFixed(1)}%`;
}

function getPercentClass(value) {
  if (asNumber(value) >= 75) return "green";
  if (asNumber(value) >= 40) return "amber";
  return "red";
}

function formatDate(date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function flattenCommands(commands = []) {
  return commands.flatMap((command) =>
    (command.ships || []).map((ship) => ({
      ...ship,
      commandName: command.commandName || "Unassigned",
    })),
  );
}

function filterShips(rows, { search, command }) {
  const needle = search.toLowerCase();
  const commandName = command.toLowerCase();

  return rows.filter((row) => {
    const matchesShip =
      !needle || String(row.ship_name || "").toLowerCase().includes(needle);
    const matchesCommand =
      !commandName ||
      String(row.commandName || "").toLowerCase() === commandName;
    return matchesShip && matchesCommand;
  });
}

function buildViewModel(rows, query, req, now) {
  const totals = rows.reduce(
    (sum, row) => {
      sum.total += asNumber(row.total);
      sum.submitted += asNumber(row.submitted);
      sum.foApproved += asNumber(row.fo_approved);
      sum.cpoConfirmed += asNumber(row.cpo_confirmed);
      sum.completed += asNumber(row.completed);
      sum.notFiled += asNumber(row.not_filed);
      return sum;
    },
    {
      total: 0,
      submitted: 0,
      foApproved: 0,
      cpoConfirmed: 0,
      completed: 0,
      notFiled: 0,
    },
  );

  const overallPercent =
    totals.total > 0 ? (totals.completed / totals.total) * 100 : 0;
  const preparedBy =
    [req.user_rank, req.user_name].filter(Boolean).join(" ") ||
    req.user_fullname ||
    req.user_id ||
    "System User";
  const filterSummary = [];

  if (query.command) {
    filterSummary.push({ label: "Command", value: query.command });
  }
  if (query.search) {
    filterSummary.push({ label: "Ship name", value: query.search });
  }

  return {
    title: "Ship Completion Progress Report",
    producedOn: formatDate(now),
    producedAt: formatTime(now),
    preparedBy,
    filterSummary,
    filterLabel: filterSummary.length
      ? filterSummary
          .map((filter) => `${filter.label}: ${filter.value}`)
          .join(" · ")
      : "All Ships",
    statistics: {
      shipCount: formatCount(rows.length),
      totalPersonnel: formatCount(totals.total),
      submitted: formatCount(totals.submitted),
      completed: formatCount(totals.completed),
      completionPercent: formatPercent(overallPercent),
      notFiled: formatCount(totals.notFiled),
    },
    totals: {
      total: formatCount(totals.total),
      submitted: formatCount(totals.submitted),
      foApproved: formatCount(totals.foApproved),
      cpoConfirmed: formatCount(totals.cpoConfirmed),
      notFiled: formatCount(totals.notFiled),
      completionPercent: formatPercent(overallPercent),
    },
    data: rows.map((row, index) => {
      const total = asNumber(row.total);
      const completed = asNumber(row.completed);
      const percent =
        row.completion_pct !== undefined
          ? asNumber(row.completion_pct)
          : total > 0
            ? (completed / total) * 100
            : 0;

      return {
        sn: index + 1,
        shipName: row.ship_name || "—",
        commandName: row.commandName || "—",
        total: formatCount(total),
        submitted: formatCount(row.submitted),
        foApproved: formatCount(row.fo_approved),
        cpoConfirmed: formatCount(row.cpo_confirmed),
        notFiled: formatCount(row.not_filed),
        completionPercent: formatPercent(percent),
        completionClass: getPercentClass(percent),
      };
    }),
  };
}

class ProgressReportController extends BaseReportController {
  async generate(req, res) {
    try {
      const query = {
        search: String(req.query.search || "").trim(),
        command: String(req.query.command || "").trim(),
      };
      const result = await reportsService.progressReport();
      if (!result.success) {
        return res
          .status(result.code || 500)
          .json({ error: result.message || "Could not load progress report." });
      }

      const rows = filterShips(
        flattenCommands(result.data.commands),
        query,
      );
      if (!rows.length) {
        return res.status(404).json({
          error: "No ships match the selected progress-report filters.",
        });
      }

      const now = new Date();
      const pdfBuffer = await this.generatePDFWithFallback(
        TEMPLATE_PATH,
        buildViewModel(rows, query, req, now),
        {
          format: "A4",
          landscape: true,
          marginTop: "7mm",
          marginBottom: "7mm",
          marginLeft: "7mm",
          marginRight: "7mm",
          printBackground: true,
        },
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=progress-report-${now.toISOString().slice(0, 10)}.pdf`,
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("❌ ProgressReportController.generate:", err);
      if (!res.headersSent) {
        return res.status(500).json({
          error: "Could not generate the filtered progress report.",
        });
      }
    }
  }
}

module.exports = new ProgressReportController();
