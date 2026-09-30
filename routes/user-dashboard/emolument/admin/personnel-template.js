/**
 * FILE: routes/user-dashboard/emolument/admin/personnel-template.js
 *
 * Builds the styled bulk-upload template (.xlsx) for the Batch Personnel
 * Upload panel. Same visual pattern as ship-users-template.js — banner
 * rows, boxed grid, dropdown validation, Instructions sheet.
 * Requires: npm i exceljs
 *
 * Column order/headers match PERSONNEL_HEADER_ALIASES in admin.routes.js,
 * and the banner rows sit above the header row (parseXlsxBuffer scans the
 * first 10 rows for the real header, so this is safe).
 */

"use strict";

const ExcelJS = require("exceljs");

const LAST_DATA_ROW = 500;
const COLS = 13;

const THIN = { style: "thin", color: { argb: "FF000000" } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const FONT = "Arial";

function boxRange(ws, fromRow, toRow, cols) {
  for (let r = fromRow; r <= toRow; r++)
    for (let c = 1; c <= cols; c++) ws.getCell(r, c).border = BOX;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function buildPersonnelTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "E-Emolument";

  /* ───────── Sheet 1: Personnel ───────── */
  const ws = wb.addWorksheet("Personnel", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  ws.columns = [
    { width: 16 }, // serviceNumber
    { width: 16 }, // surname
    { width: 20 }, // otherName
    { width: 10 }, // rank
    { width: 26 }, // email
    { width: 16 }, // phoneNumber
    { width: 18 }, // accountNo
    { width: 12 }, // bankCode
    { width: 20 }, // ship
    { width: 16 }, // payrollclass
    { width: 10 }, // classes
    { width: 20 }, // dateOfBirth
    { width: 20 }, // dateOfJoining
  ];

  const lastCol = colLetter(COLS);

  ws.mergeCells(`A1:${lastCol}1`);
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

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell("A2").value = "PERSONNEL BATCH UPLOAD";
  ws.getCell("A2").font = { name: FONT, bold: true, size: 12 };
  ws.getCell("A2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 22;

  // Row 3 is a spacer.

  const headers = [
    "Service Number",
    "Surname",
    "Other Name(s)",
    "Rank",
    "Email",
    "Phone Number",
    "Account No.",
    "Bank Code",
    "Ship",
    "Payroll Class (1-5)",
    "Classes",
    "Date of Birth (YYYY-MM-DD)",
    "Date of Joining (YYYY-MM-DD)",
  ];
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E5C8A" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });
  ws.getRow(4).height = 34;

  const samples = [
    [
      "NN/1234A",
      "OKAFOR",
      "CHIDI JOHN",
      "LT",
      "c.okafor@navy.mil.ng",
      "08012345678",
      "0123456789",
      "058",
      "NNS BEECROFT",
      "1",
      "1",
      "1990-04-12",
      "2015-09-01",
    ],
  ];
  samples.forEach((row, i) => {
    row.forEach((v, c) => {
      ws.getCell(5 + i, c + 1).value = v;
    });
  });

  // Keep leading zeros/plus-signs in phone + account numbers intact
  ws.getColumn(6).numFmt = "@"; // phoneNumber
  ws.getColumn(7).numFmt = "@"; // accountNo

  // Fonts + alignment for every data row, plus dropdown validation
  for (let r = 5; r <= LAST_DATA_ROW; r++) {
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: FONT };
      cell.alignment = { vertical: "middle" };
    }
    ws.getCell(r, 10).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"1,2,3,4,5"'],
      showErrorMessage: true,
      errorTitle: "Invalid payroll class",
      error: "Payroll class must be 1, 2, 3, 4, or 5.",
    };
  }

  // Box every cell: banners, header, samples and all empty data rows
  boxRange(ws, 1, 2, COLS);
  boxRange(ws, 4, LAST_DATA_ROW, COLS);

  /* ───────── Sheet 2: Instructions ───────── */
  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ width: 100 }];

  ins.getCell("A1").value =
    "INSTRUCTIONS FOR FILLING THE PERSONNEL BATCH UPLOAD TEMPLATE";
  ins.getCell("A1").font = {
    name: FONT,
    bold: true,
    size: 12,
    color: { argb: "FFFFFFFF" },
  };
  ins.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  ins.getCell("A1").alignment = { vertical: "middle" };
  ins.getRow(1).height = 24;

  const lines = [
    "1. Do not modify the header rows (rows 1-4).",
    "2. Fill data starting from row 5.",
    "3. Service Number and Surname are required for every row.",
    "4. If the Service Number already exists, the record is UPDATED. If it does not exist, a new record is CREATED.",
    "5. Payroll Class must be one of: 1 (Officers), 2 (W/Officers), 3 (Rate A), 4 (Rate B), 5 (Rate C).",
    "6. Dates must be entered as YYYY-MM-DD (e.g., 1990-04-12).",
    "7. IMPORTANT — for an EXISTING Service Number, a blank cell in any column (Rank, Email, Ship, etc.) will CLEAR that field on the record. Re-enter the current value if you do not want to change it; do not leave it blank just because it is unchanged.",
    "8. Do not leave blank rows between entries.",
  ];
  lines.forEach((t, i) => {
    const cell = ins.getCell(3 + i, 1);
    cell.value = t;
    cell.font = { name: FONT };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  ins.getRow(9).height = 56; // extra room for the wrapped warning line
  boxRange(ins, 1, 10, 1);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildPersonnelTemplate };
