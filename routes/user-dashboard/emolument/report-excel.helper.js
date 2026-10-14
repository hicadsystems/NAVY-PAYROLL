/**
 * FILE: routes/user-dashboard/emolument/report-excel.helper.js
 *
 * Shared Excel output for the emolument admin reports (ships, ship users,
 * form listing, progress). Each report controller already builds its rows
 * for the PDF; when the request carries ?format=excel it hands the same
 * rows here instead of rendering the PDF.
 */

"use strict";

const { GenericExcelExporter } = require("../../../controllers/helpers/excel");

function wantsExcel(req) {
  return String(req.query?.format || "").trim().toLowerCase() === "excel";
}

// GenericExcelExporter blanks 0 values; counts should still show "0".
const showZero = (value) => (value === 0 ? "0" : value);

/**
 * @param {import('express').Response} res
 * @param {object}   opts
 * @param {string}   opts.title              Report title
 * @param {Array}    [opts.filterSummary]    [{ label, value }] filters in use
 * @param {string}   [opts.emptyFilterSummary]
 * @param {string}   [opts.preparedBy]
 * @param {Array}    opts.columns            [{ header, key, width, align, numeric, numFmt }]
 * @param {Array}    opts.data               Row objects keyed by column key
 * @param {object}   [opts.totals]           { label, values: { [colIndex1Based]: value } }
 * @param {string}   opts.filename           Base filename (no extension)
 */
async function sendExcelReport(res, opts) {
  const {
    title,
    filterSummary = [],
    emptyFilterSummary = "All records",
    preparedBy,
    columns,
    data,
    totals,
    filename,
  } = opts;

  const filters = filterSummary.length
    ? filterSummary.map((f) => `${f.label}: ${f.value}`).join(" · ")
    : emptyFilterSummary;

  const subtitle = [
    filters,
    `Total: ${data.length.toLocaleString("en-NG")}`,
    preparedBy ? `Prepared by: ${preparedBy}` : null,
    `Generated: ${new Date().toLocaleString("en-GB")}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const exporter = new GenericExcelExporter();
  const workbook = await exporter.createWorkbook({
    title: `NIGERIAN NAVY — ${String(title).toUpperCase()}`,
    subtitle,
    columns: columns.map((col) =>
      col.numeric
        ? {
            ...col,
            align: col.align || "right",
            numFmt: col.numFmt || "#,##0",
            transform: showZero,
          }
        : col,
    ),
    data,
    totals,
    sheetName: String(title).replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return exporter.exportToResponse(workbook, res, `${filename}-${stamp}.xlsx`);
}

module.exports = { wantsExcel, sendExcelReport };
