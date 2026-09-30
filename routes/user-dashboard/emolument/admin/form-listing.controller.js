"use strict";

const path = require("path");
const BaseReportController = require("../../../../controllers/Reports/reportsFallbackController");
const adminRepo = require("./admin.repository");

const TEMPLATE_PATH = path.join(
  __dirname,
  "../../../../templates/form-listing.html",
);

const PAYROLL_CLASS_LABELS = {
  1: "Officers",
  2: "Warrant Officers",
  3: "Ratings A",
  4: "Ratings B",
  5: "Ratings C",
  6: "Trainees",
};

// Keep these labels aligned with the Status dropdown in accept-verified.html.
const FILTER_STATUS_LABELS = {
  NotFilled: "Not Filled",
  FO: "Submitted",
  CPO: "FO Approved",
  Verified: "Confirmed",
  Completed: "Completed",
};

// Keep this mapping aligned with STATUS_LBL and renderTable() in the UI.
const TABLE_STATUS_LABELS = {
  Filled: "Submitted",
  FO: "Submitted",
  CPO: "FO Approved",
  Verified: "Confirmed",
};

function formatProducedOn(date) {
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getDisplayStatus(row) {
  return (
    TABLE_STATUS_LABELS[row.Status] ||
    (row.emolumentform === "Yes" ? "Completed" : "Not Filed")
  );
}

function buildFilterSummary(query) {
  const summary = [];

  if (query.search?.trim()) {
    summary.push({ label: "Search", value: query.search.trim() });
  }
  if (query.ship) {
    summary.push({ label: "Ship", value: query.ship });
  }
  if (query.payrollclass) {
    summary.push({
      label: "Payroll Class",
      value: PAYROLL_CLASS_LABELS[query.payrollclass] || query.payrollclass,
    });
  }
  if (query.status) {
    summary.push({
      label: "Status",
      value: FILTER_STATUS_LABELS[query.status] || query.status,
    });
  }

  return summary;
}

class FormListingController extends BaseReportController {
  async generate(req, res) {
    try {
      // The report uses the same fields/semantics as GET /admin/personnel,
      // but intentionally omits pagination so it covers every matching row.
      const filters = {
        serviceNumber: req.query.serviceNumber || undefined,
        surname: req.query.surname?.trim() || undefined,
        ship: req.query.ship || undefined,
        payrollclass: req.query.payrollclass || undefined,
        status: req.query.status !== undefined ? req.query.status : undefined,
      };

      const rows = await adminRepo.getPersonnelForListing(filters);
      const data = rows.map((row, index) => ({
        sn: index + 1,
        fullName: `${row.Surname || ""} ${row.OtherName || ""}`.trim() || "—",
        serviceNumber: row.serviceNumber || "—",
        rank: row.Rank || "—",
        ship: row.ship || "N/A",
        status: getDisplayStatus(row),
      }));

      const preparedBy =
        [req.user_rank, req.user_name].filter(Boolean).join(" ") ||
        req.user_fullname ||
        req.user_id ||
        "Administrator";
      const now = new Date();
      const viewModel = {
        role: "EMOLUMENT ADMIN",
        title: "Personnel Form Listing",
        producedOn: formatProducedOn(now),
        preparedBy,
        filterSummary: buildFilterSummary(req.query),
        emptyFilterSummary: "All personnel records",
        statistics: {
          total: data.length,
          totalLabel: `${data.length.toLocaleString()} ${data.length === 1 ? "form" : "forms"}`,
        },
        data,
      };

      const pdfBuffer = await this.generatePDFWithFallback(
        TEMPLATE_PATH,
        viewModel,
        {
          format: "A4",
          landscape: true,
          marginTop: "6mm",
          marginBottom: "6mm",
          marginLeft: "6mm",
          marginRight: "6mm",
          printBackground: true,
        },
      );

      const stamp = now.toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=form-listing-${stamp}.pdf`,
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("❌ FormListingController.generate:", err);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Could not generate the personnel form listing report.",
        });
      }
    }
  }
}

module.exports = new FormListingController();
