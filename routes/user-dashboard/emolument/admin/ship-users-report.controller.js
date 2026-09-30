"use strict";

const path = require("path");
const BaseReportController = require("../../../../controllers/Reports/reportsFallbackController");
const adminRepository = require("./admin.repository");

const TEMPLATE_PATH = path.join(
  __dirname,
  "../../../../templates/ship-users-report.html",
);

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-NG");
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

function buildPreparedBy(req) {
  return (
    [req.user_rank, req.user_name].filter(Boolean).join(" ") ||
    req.user_fullname ||
    req.user_id ||
    "System User"
  );
}

function buildFilterSummary(query) {
  const summary = [];
  if (query.search) {
    summary.push({ label: "Name or service no", value: query.search });
  }
  if (query.ship) summary.push({ label: "Ship", value: query.ship });
  if (query.role) summary.push({ label: "Role", value: query.role });
  return summary;
}

function matchesSearch(row, query) {
  if (!query) return true;
  const name = `${row.Surname || ""} ${row.OtherName || ""}`.toLowerCase();
  const serviceNumber = String(row.user_id || "").toLowerCase();
  return name.includes(query) || serviceNumber.includes(query);
}

class ShipUsersReportController extends BaseReportController {
  async generate(req, res) {
    const query = {
      search: String(req.query.search ?? "").trim().toLowerCase(),
      ship: String(req.query.ship ?? ""),
      role: String(req.query.role ?? ""),
    };

    if (query.role && !["FO", "CPO"].includes(query.role)) {
      return res.status(400).json({ error: "Invalid ship-user role filter." });
    }

    try {
      const rowsFromRepository = await adminRepository.getAllRoles({
        role: query.role || undefined,
        scope_value: query.ship || undefined,
      });

      // Match the ship-users screen: DO and EMOL_ADMIN assignments are not
      // displayed there. Search covers the same name and service-number fields.
      const rows = rowsFromRepository
        .filter((row) => row.role !== "EMOL_ADMIN" && row.role !== "DO")
        .filter((row) => !query.ship || row.scope_value === query.ship)
        .filter((row) => !query.role || row.role === query.role)
        .filter((row) => matchesSearch(row, query.search));

      if (!rows.length) {
        return res.status(404).json({
          error: "No ship users match the selected filters.",
        });
      }

      const now = new Date();
      const foCount = rows.filter((row) => row.role === "FO").length;
      const cpoCount = rows.filter((row) => row.role === "CPO").length;
      const filterSummary = buildFilterSummary(query);
      const data = rows.map((row, index) => ({
        sn: index + 1,
        name: `${row.Surname || ""} ${row.OtherName || ""}`.trim() || "—",
        rank: row.Rank || "—",
        serviceNumber: row.user_id || "—",
        shipScope:
          row.role === "CPO"
            ? "All (Global)"
            : row.scope_value || row.ship || "—",
        role: row.role || "—",
        roleClass: row.role === "CPO" ? "cpo" : "fo",
      }));
      const viewModel = {
        title: "Ship Users Report",
        producedOn: formatDate(now),
        producedAt: formatTime(now),
        preparedBy: buildPreparedBy(req),
        filterSummary,
        emptyFilterSummary: "All ship users",
        statistics: {
          total: formatCount(rows.length),
          fo: formatCount(foCount),
          cpo: formatCount(cpoCount),
          totalLabel: `${rows.length.toLocaleString("en-NG")} ${rows.length === 1 ? "user" : "users"}`,
        },
        data,
      };

      const pdfBuffer = await this.generatePDFWithFallback(
        TEMPLATE_PATH,
        viewModel,
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
        `inline; filename=ship-users-report-${now.toISOString().slice(0, 10)}.pdf`,
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("❌ ShipUsersReportController.generate:", err);
      if (!res.headersSent) {
        return res.status(500).json({
          error: "Could not generate the filtered ship-users report.",
        });
      }
    }
  }
}

module.exports = new ShipUsersReportController();
