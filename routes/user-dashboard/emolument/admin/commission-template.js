/**
 * FILE: routes/user-dashboard/emolument/admin/commission-template.js
 *
 * Builds the styled bulk-upload template (.xlsx) for the Commission
 * Personnel Upload modal. Same visual pattern as ship-users-template.js —
 * banner rows, boxed grid, Instructions sheet.
 * Requires: npm i exceljs
 *
 * Column order/headers match COMMISSION_HEADER_ALIASES in admin.routes.js,
 * and the banner rows sit above the header row (parseXlsxBuffer scans the
 * first 10 rows for the real header, so this is safe).
 */

"use strict";

const ExcelJS = require("exceljs");

const LAST_DATA_ROW = 500;
const COLS = 3;

const THIN = { style: "thin", color: { argb: "FF000000" } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const FONT = "Arial";

function boxRange(ws, fromRow, toRow, cols) {
  for (let r = fromRow; r <= toRow; r++)
    for (let c = 1; c <= cols; c++) ws.getCell(r, c).border = BOX;
}

async function buildCommissionTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "E-Emolument";

  /* ───────── Sheet 1: Commission ───────── */
  const ws = wb.addWorksheet("Commission", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  ws.columns = [{ width: 18 }, { width: 18 }, { width: 36 }];

  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "NIGERIAN NAVY E-EMOLUMENT";
  ws.getCell("A1").font = {
    name: FONT,
    bold: true,
    size: 14,
    color: { argb: "FFFFFFFF" },
  };
  ws.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = "COMMISSION PERSONNEL UPLOAD";
  ws.getCell("A2").font = { name: FONT, bold: true, size: 12 };
  ws.getCell("A2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 22;

  // Row 3 is a spacer.

  const headers = ["Old Service No.", "New Service No.", "Reason"];
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFA9781F" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });
  ws.getRow(4).height = 32;

  const samples = [["NA/0012345", "NN/0054321", "Commissioned from rating"]];
  samples.forEach((row, i) => {
    row.forEach((v, c) => {
      ws.getCell(5 + i, c + 1).value = v;
    });
  });

  // Fonts + alignment for every data row
  for (let r = 5; r <= LAST_DATA_ROW; r++) {
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: FONT };
      cell.alignment = { vertical: "middle" };
    }
  }

  // Box every cell: banners, header, samples and all empty data rows
  boxRange(ws, 1, 2, COLS);
  boxRange(ws, 4, LAST_DATA_ROW, COLS);

  /* ───────── Sheet 2: Instructions ───────── */
  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ width: 90 }];

  ins.getCell("A1").value =
    "INSTRUCTIONS FOR FILLING THE COMMISSION UPLOAD TEMPLATE";
  ins.getCell("A1").font = {
    name: FONT,
    bold: true,
    size: 12,
    color: { argb: "FFFFFFFF" },
  };
  ins.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFC4932A" },
  };
  ins.getCell("A1").alignment = { vertical: "middle" };
  ins.getRow(1).height = 24;

  const lines = [
    "1. Do not modify the header rows (rows 1-4).",
    "2. Fill data starting from row 5.",
    "3. Old Service No. must match an existing personnel record (e.g., NA/0012345).",
    "4. New Service No. must be different from Old Service No.",
    "5. If New Service No. starts with 'N', the record is treated as commissioned and its Payroll Class/Classes will automatically be set to 1.",
    "6. Reason / Authority is optional. It is for your own reference only and is not currently stored against the record.",
    "7. Both service number fields are required for every row.",
    "8. Do not leave blank rows between entries.",
  ];
  lines.forEach((t, i) => {
    const cell = ins.getCell(3 + i, 1);
    cell.value = t;
    cell.font = { name: FONT };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  boxRange(ins, 1, 10, 1);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildCommissionTemplate };
