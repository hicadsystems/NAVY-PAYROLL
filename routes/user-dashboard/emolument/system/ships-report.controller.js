"use strict";

const path = require("path");
const BaseReportController = require("../../../../controllers/Reports/reportsFallbackController");
const shipsRepository = require("./ships.repository");

const TEMPLATE_PATH = path.join(
  __dirname,
  "../../../../templates/ships-report.html",
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

function isOpen(value) {
  return value === true || value === 1 || value === "1";
}

function buildPreparedBy(req) {
  return (
    [req.user_rank, req.user_name].filter(Boolean).join(" ") ||
    req.user_fullname ||
    req.user_id ||
    "System User"
  );
}

function buildFilterSummary(query, rows) {
  const summary = [];
  if (query.search) {
    summary.push({ label: "Ship name", value: query.search });
  }
  if (query.commandid) {
    const matchedCommand = rows.find(
      (row) => String(row.commandid) === query.commandid,
    );
    summary.push({
      label: "Command",
      value: matchedCommand?.commandName || `Command ID ${query.commandid}`,
    });
  }
  if (query.openship !== "") {
    summary.push({
      label: "Status",
      value: query.openship === "1" ? "Open" : "Closed",
    });
  }
  return summary;
}

class ShipsReportController extends BaseReportController {
  async generate(req, res) {
    const query = {
      // The ships page does not trim its search input before filtering.
      search: String(req.query.search ?? ""),
      commandid: String(req.query.commandid ?? "").trim(),
      openship: String(req.query.openship ?? "").trim(),
    };

    if (query.commandid && !/^\d+$/.test(query.commandid)) {
      return res.status(400).json({ error: "Invalid command filter." });
    }
    if (query.openship && !["0", "1"].includes(query.openship)) {
      return res.status(400).json({ error: "Invalid ship status filter." });
    }

    try {
      const repositoryFilters = {};
      if (query.commandid) repositoryFilters.commandid = Number(query.commandid);
      if (query.openship !== "") {
        repositoryFilters.openship = query.openship === "1";
      }

      // The repository query is intentionally unpaginated. Search is applied
      // here using the same case-insensitive ship-name substring as the UI.
      const allShips = await shipsRepository.getAllShips(repositoryFilters);
      const needle = query.search.toLowerCase();
      const rows = allShips.filter((ship) =>
        !needle || String(ship.shipName || "").toLowerCase().includes(needle),
      );

      if (!rows.length) {
        return res.status(404).json({
          error: "No ships match the selected filters.",
        });
      }

      const now = new Date();
      const openCount = rows.filter((ship) => isOpen(ship.openship)).length;
      const commandCount = new Set(
        rows.map((ship) => ship.commandid).filter((id) => id != null),
      ).size;
      const data = rows.map((ship, index) => {
        const open = isOpen(ship.openship);
        return {
          sn: index + 1,
          shipName: ship.shipName || "—",
          code: ship.code || "—",
          commandName: ship.commandName || "—",
          commandId: ship.commandid == null ? "—" : String(ship.commandid),
          status: open ? "Open" : "Closed",
          statusClass: open ? "open" : "closed",
        };
      });
      const filterSummary = buildFilterSummary(query, rows);
      const viewModel = {
        title: "Ship Register Report",
        producedOn: formatDate(now),
        producedAt: formatTime(now),
        preparedBy: buildPreparedBy(req),
        filterSummary,
        emptyFilterSummary: "All ships",
        statistics: {
          total: formatCount(rows.length),
          open: formatCount(openCount),
          closed: formatCount(rows.length - openCount),
          commands: formatCount(commandCount),
          totalLabel: `${rows.length.toLocaleString("en-NG")} ${rows.length === 1 ? "ship" : "ships"}`,
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
        `inline; filename=ships-report-${now.toISOString().slice(0, 10)}.pdf`,
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("❌ ShipsReportController.generate:", err);
      if (!res.headersSent) {
        return res.status(500).json({
          error: "Could not generate the filtered ships report.",
        });
      }
    }
  }
}

module.exports = new ShipsReportController();
