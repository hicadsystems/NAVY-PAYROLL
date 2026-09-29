/**
 * FILE: routes/user-dashboard/emolument/reports/emolument-reports.controller.js
 *
 * Mirrors PersonnelReportController's shape (extends BaseReportController,
 * uses this.generatePDFWithFallback + GenericExcelExporter) so the PDF/Excel
 * pipeline is identical to your existing personnel reports.
 *
 * CONFIRM the four require paths below against your actual root layout.
 * They're inferred from personnelReportController.js's own requires
 * ("../Reports/reportsFallbackController", "../helpers/excel") assuming
 * this file sits four directories below your project root, same as
 * fo.repository.js's "../../../../config/db". Adjust if your root/controllers
 * folder is laid out differently.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

const BaseReportController = require("../../../../controllers/Reports/reportsFallbackController"); // CONFIRM path
const { GenericExcelExporter } = require("../../../../controllers/helpers/excel"); // CONFIRM path
const pool = require("../../../../config/db");

const reportsService = require("./reports.service");
const { getStageMeta } = require("./reports.config");

const TEMPLATE_PATH = path.join(__dirname, "../../../../templates", "emolument-form-report.html");

// ─────────────────────────────────────────────────────────────
// Handlebars helpers — registered once, here in Node, NOT inside the
// template file. (Your existing personnel-report.html registers helpers
// in a <script> tag inside the template itself, which only runs if that
// HTML is opened in a browser — it has no effect on server-side Puppeteer
// rendering. Doing it here is the version that actually works.)
// ─────────────────────────────────────────────────────────────

let helpersRegistered = false;
function ensureHelpers() {
  if (helpersRegistered) return;
  Handlebars.registerHelper("eq", (a, b) => a === b);
  helpersRegistered = true;
}

let _template;
function getTemplate() {
  ensureHelpers();
  if (!_template) {
    const src = fs.readFileSync(TEMPLATE_PATH, "utf8");
    _template = Handlebars.compile(src);
  }
  return _template;
}

class EmolumentReportsController extends BaseReportController {
  constructor() {
    super();
  }

  // role: "DO" | "FO" | "CPO" — bound by the thin per-role route files.
  async generateReport(req, res, role) {
    try {
      const { stage } = req.params;
      const { format = "pdf", ship: shipQuery, command } = req.query;

      // DO/FO: ship is scoped by the route (see *.reports.routes.js),
      // available on req.formScope / req.params.ship depending on how
      // your existing middleware attaches it — adjust the fallback chain
      // below to match whichever your requireEmolRole actually sets.
      const ship =
        role === "CPO"
          ? shipQuery || null
          : req.params.ship || req.formScope?.ship || shipQuery || null;

      const performedBy = req.user_id;
      const performedByName = req.user_name;
      const performedByRank = req.user_rank;

      const result = await reportsService.fetchReport({
        role,
        stage,
        ship,
        command: role === "CPO" ? command || null : null,
        performedBy,
      });

      if (!result.ok) {
        return res.status(result.code).json({ success: false, error: result.message });
      }

      const scopeLabel =
        role === "CPO"
          ? [command ? `Command: ${command}` : null, ship ? `Ship: ${ship}` : null]
              .filter(Boolean)
              .join(" · ") || "All Commands · All Ships"
          : ship;

      if (format === "json") {
        return res.json({
          success: true,
          data: reportsService.toTableRows(result.rows),
          total: result.rows.length,
        });
      }

      if (format === "excel") {
        return this.generateExcel(result.rows, { role, stage, scopeLabel }, res);
      }

      return this.generatePdf(result.rows, { role, stage, scopeLabel, performedByName, performedByRank, performedBy }, res);
    } catch (err) {
      console.error(`❌ EmolumentReportsController.generateReport [${role}]:`, err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Server error generating report." });
      }
    }
  }

  async generatePdf(rows, { role, stage, scopeLabel, performedByName, performedByRank, performedBy }, res) {
    const viewModel = reportsService.buildViewModel({
      role,
      stage,
      scopeLabel,
      rows,
      performedByName,
      performedByRank,
      performedBySvcNo: performedBy,
    });

    // Uses the same fallback-capable PDF pipeline as personnel reports.
    // If generatePDFWithFallback expects a template *path* + data object
    // (as in personnelReportController.js), pass TEMPLATE_PATH directly
    // instead of pre-compiling — swap to whichever this.generatePDFWithFallback
    // actually expects in your BaseReportController implementation.
    const pdfBuffer = await this.generatePDFWithFallback(TEMPLATE_PATH, viewModel, {
      format: "A4",
      landscape: true,
      marginTop: "5mm",
      marginBottom: "5mm",
      marginLeft: "5mm",
      marginRight: "5mm",
    });

    const meta = getStageMeta(role, stage);
    const stamp = new Date().toISOString().slice(0, 10);
    const safeScope = String(scopeLabel || role).replace(/[^\w-]+/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${role}_${stage}_${safeScope}_${stamp}.pdf`,
    );
    res.send(pdfBuffer);
  }

  async generateExcel(rows, { role, stage, scopeLabel }, res) {
    const tableRows = reportsService.toTableRows(rows);
    const meta = getStageMeta(role, stage);
    const showRemarks = stage === "rejected";

    const columns = [
      { header: "S/N", key: "sn", width: 6, align: "center" },
      { header: "Svc No.", key: "serviceNumber", width: 15 },
      { header: "Rank", key: "rank", width: 10 },
      { header: "Full Name", key: "fullName", width: 30 },
      { header: "Class", key: "className", width: 12 },
      { header: "Ship", key: "ship", width: 18 },
      ...(role === "CPO" ? [{ header: "Command", key: "command", width: 18 }] : []),
      { header: "Form No.", key: "formNumber", width: 12 },
      { header: "Form Year", key: "formYear", width: 10, align: "center" },
      { header: "Officer", key: "officer", width: 22 },
      { header: meta.dateLabel, key: "actionDate", width: 15 },
      ...(showRemarks ? [{ header: "Remarks", key: "remarks", width: 35 }] : []),
    ];

    const exporter = new GenericExcelExporter();
    const workbook = await exporter.createWorkbook({
      title: `NIGERIAN NAVY — ${meta.title.toUpperCase()}`,
      subtitle: `${scopeLabel || "All"} | Total: ${tableRows.length} | Generated: ${new Date().toLocaleDateString()}`,
      className: role,
      columns,
      data: tableRows,
      summary: {},
      sheetName: meta.title.slice(0, 31),
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const safeScope = String(scopeLabel || role).replace(/[^\w-]+/g, "_");
    return exporter.exportToResponse(workbook, res, `${role}_${stage}_${safeScope}_${stamp}.xlsx`);
  }

  async getFilterOptions(req, res, role) {
    try {
      const { command } = req.query;
      const result = await reportsService.getFilterOptions({ role, command });
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error(`❌ EmolumentReportsController.getFilterOptions [${role}]:`, err);
      res.status(500).json({ success: false, error: "Failed to load filter options." });
    }
  }
}

module.exports = new EmolumentReportsController();