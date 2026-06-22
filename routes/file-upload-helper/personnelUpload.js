// batchUploadRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const pool = require("../../config/db"); // mysql2 pool
const verifyToken = require("../../middware/authentication");
const { logEmployeeHistory } = require("../helpers/emplHistoryLogger");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "batch-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [".xlsx", ".xls", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, and .csv files are allowed"));
    }
  },
});

// =============================================================================
// HELPER FUNCTION: Get Payroll Class from Current Database
// =============================================================================
async function getPayrollClassFromDb(dbName) {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      "SELECT classcode FROM py_payrollclass WHERE db_name = ?",
      [dbName],
    );
    const result = rows.length > 0 ? rows[0].classcode : null;
    console.log("🔍 Database:", dbName, "→ Payroll Class:", result);
    return result;
  } finally {
    connection.release();
  }
}

// =============================================================================
// FIELD MAPPING: Excel/CSV header → DB column name
// Shared by both INSERT and UPDATE routes.
// =============================================================================
const FIELD_MAPPING = {
  "Svc. No.": "Empl_ID",
  Rank: "Title",
  Surname: "Surname",
  "Other Name": "OtherName",
  "Date of Birth": "Birthdate",
  "State Of Origin": "StateofOrigin",
  "Local Government": "LocalGovt",
  Town: "town",
  "Residential Address": "HOMEADDR",
  "Email Address": "email",
  "GSM Number": "gsm_number",
  Sex: "Sex",
  "Marital Status": "MaritalStatus",
  Religion: "religion",
  "Date Joined": "DateEmpl",
  "Date Commissioned": "dateconfirmed",
  "Entry Mode": "entry_mode",
  "Date Left": "DateLeft",
  "Exit Mode": "exittype",
  Taxed: "taxed",
  "TaxID No": "TaxCode",
  "Tax State": "state",
  "RSA Code": "NSITFcode",
  "PFA Code": "pfacode",
  "Payroll Class": "payrollclass",
  "Salary Grade": "gradelevel",
  "Salary Group": "gradetype",
  "Bank Branch": "bankbranch",
  "Account Number": "BankACNumber",
  "Seniority Date": "datepmted",
  Location: "Location",
  Factory: "Factory",
  Command: "command",
  Specialisation: "specialisation",
  "Job Title": "Jobtitle",
  Award: "award",
  "Emolument Form": "emolumentform",
  "NHF Code": "NHFcode",
  "Bank Code": "Bankcode",
  "IPPIS NO": "InternalACNo",
  Country: "Country",
  "Accommodation Type": "accomm_type",
  "Rent Subsidy": "rent_subsidy",
  "Emol. Form": "emolumentform",
};

// Columns that must never be modified through a batch UPDATE
const BATCH_UPDATE_PROTECTED = new Set([
  "payrollclass",
  "passport",
  "createdby",
  "datecreated",
]);

// Date columns that need formatting
const DATE_COLUMNS = new Set([
  "Birthdate",
  "DateEmpl",
  "datepmted",
  "DateLeft",
  "dateconfirmed",
]);

// =============================================================================
// DATE HELPERS
// =============================================================================
function excelDateToYYYYMMDD(serial) {
  if (!serial || isNaN(serial)) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(excelEpoch.getTime() + serial * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDateToYYYYMMDD(dateValue) {
  if (!dateValue) return null;
  try {
    if (typeof dateValue === "number") return excelDateToYYYYMMDD(dateValue);

    if (typeof dateValue === "string") {
      const trimmed = dateValue.trim();
      if (/^\d{8}$/.test(trimmed)) return trimmed; // already YYYYMMDD

      const ddmm = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
      if (ddmm)
        return `${ddmm[3]}${ddmm[2].padStart(2, "0")}${ddmm[1].padStart(2, "0")}`;

      const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // YYYY-MM-DD
      if (iso)
        return `${iso[1]}${iso[2].padStart(2, "0")}${iso[3].padStart(2, "0")}`;
    }

    console.warn("⚠️ Could not parse date:", dateValue);
    return null;
  } catch (error) {
    console.error("❌ Date formatting error:", error);
    return null;
  }
}

// =============================================================================
// FILE PARSERS
// =============================================================================
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const allData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  const headers = allData[3]; // Row 4 (0-indexed: 3)
  if (!headers || headers.length === 0)
    throw new Error("No headers found in row 4");

  console.log("📋 Detected headers:", headers);

  const data = allData
    .slice(4) // Data starts at row 5
    .filter(
      (row) =>
        row &&
        row.length > 0 &&
        row.some((c) => c !== null && c !== undefined && c !== ""),
    )
    .map((row) => {
      const obj = {};
      headers.forEach((header, idx) => {
        if (header && header.toString().trim() !== "") {
          const cell = row[idx];
          obj[header.toString().trim()] =
            cell !== null && cell !== undefined ? cell : "";
        }
      });
      return obj;
    });

  console.log("✅ Parsed data rows:", data.length);
  return data;
}

function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (d) => results.push(d))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
}

// =============================================================================
// FIELD MAPPERS
// =============================================================================

/** For INSERT: maps all fields, injects createdby / payrollclass / datecreated */
function mapFields(row, createdBy, payrollClass) {
  const mappedRow = {};
  Object.keys(row).forEach((key) => {
    const dbField = FIELD_MAPPING[key.trim()];
    if (!dbField) return;

    let value = row[key];
    if (typeof value === "string") value = value.trim();
    if (DATE_COLUMNS.has(dbField)) value = formatDateToYYYYMMDD(value);
    mappedRow[dbField] = value || null;
  });
  mappedRow.createdby = createdBy;
  mappedRow.payrollclass = payrollClass;
  mappedRow.datecreated = new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  return mappedRow;
}

/**
 * For UPDATE: extracts Empl_ID separately; skips protected columns and blanks.
 * Returns { emplId, updateData }.
 */
function mapFieldsForUpdate(row) {
  let emplId = null;
  const updateData = {};

  Object.keys(row).forEach((key) => {
    const trimmedKey = key.trim();
    const dbField = FIELD_MAPPING[trimmedKey];
    if (!dbField) return;

    if (dbField === "Empl_ID") {
      emplId = row[key] ? row[key].toString().trim() : null;
      return; // Empl_ID is the WHERE key, not a SET field
    }

    if (BATCH_UPDATE_PROTECTED.has(dbField)) return;

    let value = row[key];
    if (typeof value === "string") value = value.trim();
    if (!value && value !== 0) return; // skip empty cells

    if (DATE_COLUMNS.has(dbField)) {
      value = formatDateToYYYYMMDD(value);
      if (!value) return;
    }

    updateData[dbField] = value;
  });

  return { emplId, updateData };
}

// =============================================================================
// VALIDATORS
// =============================================================================
function validateRow(row, rowIndex) {
  const errors = [];
  ["Empl_ID", "Surname", "OtherName"].forEach((field) => {
    if (!row[field] || row[field].toString().trim() === "") {
      errors.push(`Row ${rowIndex + 5}: Missing required field "${field}"`);
    }
  });
  return errors;
}

function validateUpdateRow(emplId, rowIndex) {
  if (!emplId || emplId.toString().trim() === "") {
    return [`Row ${rowIndex + 5}: Missing required field "Svc. No." (Empl_ID)`];
  }
  return [];
}

// =============================================================================
// DB HELPERS
// =============================================================================
async function checkDuplicates(personnelList) {
  if (!personnelList.length) return [];
  const emplIds = personnelList.map((p) => p.Empl_ID);
  const placeholders = emplIds.map(() => "?").join(",");
  const [results] = await pool.query(
    `SELECT Empl_ID FROM hr_employees WHERE Empl_ID IN (${placeholders})`,
    emplIds,
  );
  return results.map((r) => r.Empl_ID);
}

async function insertPersonnel(data) {
  const fields = Object.keys(data);
  const values = Object.values(data);
  const placeholders = fields.map(() => "?").join(", ");
  const [result] = await pool.query(
    `INSERT INTO hr_employees (${fields.join(", ")}) VALUES (${placeholders})`,
    values,
  );
  return result;
}

// =============================================================================
// ROUTE: POST /batch-upload  (INSERT new personnel)
// =============================================================================
router.post(
  "/batch-upload",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();
      const createdBy = req.user_fullname || "SYSTEM";
      const userId = req.user_id;
      const currentDb = pool.getCurrentDatabase(userId.toString());
      const payrollClass = await getPayrollClassFromDb(currentDb);

      console.log(
        "📊 Batch INSERT — database:",
        currentDb,
        "| payroll class:",
        payrollClass,
      );

      const rawData =
        fileExt === ".csv"
          ? await parseCSVFile(filePath)
          : parseExcelFile(filePath);

      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "File is empty or invalid" });
      }
      console.log("📊 Total rows parsed:", rawData.length);

      const validationErrors = [];
      const mappedData = rawData.map((row, index) => {
        const mapped = mapFields(row, createdBy, payrollClass);
        if (index === 0) console.log("🔍 First mapped row:", mapped);
        validationErrors.push(...validateRow(mapped, index));
        return mapped;
      });

      if (validationErrors.length > 0) {
        return res
          .status(400)
          .json({ error: "Validation failed", details: validationErrors });
      }

      const duplicateKeys = await checkDuplicates(mappedData);
      const uniqueData = mappedData.filter(
        (r) => !duplicateKeys.includes(r.Empl_ID),
      );

      const results = {
        totalRecords: mappedData.length,
        duplicates: duplicateKeys,
        inserted: uniqueData.length,
        successful: 0,
        failed: 0,
        errors: [],
        payrollClass,
        database: currentDb,
      };

      for (let i = 0; i < uniqueData.length; i++) {
        try {
          await insertPersonnel(uniqueData[i]);
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 5,
            serviceNumber: uniqueData[i].Empl_ID,
            error: error.message,
          });
          console.error(
            `❌ Failed to insert ${uniqueData[i].Empl_ID}:`,
            error.message,
          );
        }
      }

      results.failed += results.duplicates.length;
      if (results.duplicates.length > 0) {
        results.errors.push(
          ...results.duplicates.map((id) => ({
            row: null,
            serviceNumber: id,
            error: "Already exists (duplicate)",
          })),
        );
      }

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      console.log("✅ Batch INSERT complete:", results);

      return res.status(200).json({
        message: "Batch personnel upload completed",
        summary: results,
      });
    } catch (error) {
      console.error("Batch INSERT error:", error);
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res
        .status(500)
        .json({ error: "Batch upload failed", details: error.message });
    }
  },
);

// =============================================================================
// ROUTE: POST /batch-update  (UPDATE existing personnel)
// =============================================================================
// • Uses the same 4-row header template structure as batch-upload.
// • Column "Svc. No." (Empl_ID) is mandatory in every row — used as the lookup key.
// • Protected columns (payrollclass, passport, createdby, datecreated) are skipped.
// • Blank cells are skipped so sparse sheets only touch the supplied columns.
// • exittype = '2210' → all py_payded rows for that employee are deleted first,
//   allowing the payroll engine to re-apply only the restricted allowances.
// =============================================================================
router.post(
  "/batch-update",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      console.log("=== BATCH UPDATE ===");
      console.log("File:", req.file.originalname, "|", req.file.size, "bytes");

      const rawData =
        fileExt === ".csv"
          ? await parseCSVFile(filePath)
          : parseExcelFile(filePath);

      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "File is empty or invalid" });
      }
      console.log("📊 Batch UPDATE — rows parsed:", rawData.length);

      const results = {
        totalRows: rawData.length,
        updated: [],
        notFound: [],
        skipped: [],
        paydedCleared: [], // employees whose py_payded was wiped (exittype=2210)
        errors: [],
      };

      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        const rowNum = i + 5; // rows 1-4 are headers in the template

        // Map headers → DB columns, separate Empl_ID
        const { emplId, updateData } = mapFieldsForUpdate(row);

        // Validate: Empl_ID required
        const rowErrors = validateUpdateRow(emplId, i);
        if (rowErrors.length) {
          results.skipped.push({ row: rowNum, reason: rowErrors[0] });
          continue;
        }

        if (Object.keys(updateData).length === 0) {
          results.skipped.push({
            row: rowNum,
            Empl_ID: emplId,
            reason: "No updatable fields after filtering",
          });
          continue;
        }

        try {
          // ── EMPLOYEE HISTORY LOGGING ──────────────────────────────────────────
          // Must run BEFORE the UPDATE below — captures the true pre-update state.
          // Also tells us, for free, whether this Empl_ID exists at all.
          const historyResult = await logEmployeeHistory(emplId);
          if (!historyResult.logged) {
            // No existing hr_employees row for this Empl_ID — not an error,
            // just nothing to update (and nothing to snapshot).
            results.notFound.push({ row: rowNum, Empl_ID: emplId });
            continue;
          }
          // ── END EMPLOYEE HISTORY LOGGING ──────────────────────────────────────

          // ── 2210 HANDLING ────────────────────────────────────────────────────
          // Retired-but-restricted status: wipe all existing py_payded rows so
          // the payroll run can rebuild with only the permitted allowances.
          if (updateData.exittype === "2210") {
            const [delResult] = await pool.query(
              "DELETE FROM py_payded WHERE Empl_ID = ?",
              [emplId],
            );
            results.paydedCleared.push(emplId);
            console.log(
              `🔔 [Row ${rowNum}] exittype=2210 → deleted ${delResult.affectedRows} py_payded row(s) for ${emplId}`,
            );
          }
          // ── END 2210 HANDLING ────────────────────────────────────────────────

          const fields = Object.keys(updateData);
          const values = Object.values(updateData);
          const setClause = fields.map((f) => `\`${f}\` = ?`).join(", ");

          const [result] = await pool.query(
            `UPDATE hr_employees SET ${setClause} WHERE Empl_ID = ?`,
            [...values, emplId],
          );

          if (result.affectedRows === 0) {
            results.notFound.push({ row: rowNum, Empl_ID: emplId });
          } else {
            results.updated.push(emplId);
          }
        } catch (rowErr) {
          console.error(`❌ Row ${rowNum} (${emplId}):`, rowErr.message);
          results.errors.push({
            row: rowNum,
            Empl_ID: emplId,
            error: rowErr.message,
          });
        }
      }

      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

      const allFailed = results.updated.length === 0 && rawData.length > 0;
      console.log(
        `✅ Batch UPDATE done — updated: ${results.updated.length}, notFound: ${results.notFound.length}, skipped: ${results.skipped.length}, paydedCleared: ${results.paydedCleared.length}, errors: ${results.errors.length}`,
      );

      return res.status(allFailed ? 422 : 200).json({
        message: `Batch update complete. ${results.updated.length} updated, ${results.notFound.length} not found, ${results.skipped.length} skipped, ${results.errors.length} errors.`,
        summary: results,
      });
    } catch (error) {
      console.error("Batch UPDATE error:", error);
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res
        .status(500)
        .json({ error: "Batch update failed", details: error.message });
    }
  },
);

// =============================================================================
// ROUTE: GET /batch-template  (Download INSERT template)
// =============================================================================
router.get("/batch-template", verifyToken, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Personnel", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    // Row 1 — main header
    worksheet.mergeCells("A1:N1");
    const mainHeader = worksheet.getCell("A1");
    mainHeader.value = "Nigerian Navy (Naval Headquarters)";
    mainHeader.font = {
      name: "Arial",
      size: 13,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    mainHeader.alignment = { horizontal: "center", vertical: "middle" };
    mainHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    mainHeader.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
    worksheet.getRow(1).height = 22;

    // Row 2 — sub header
    worksheet.mergeCells("A2:N2");
    const subHeader = worksheet.getCell("A2");
    subHeader.value = "CENTRAL PAY OFFICE, 23 POINT ROAD, APAPA";
    subHeader.font = { name: "Arial", size: 11, bold: true };
    subHeader.alignment = { horizontal: "center", vertical: "middle" };
    subHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9D9D9" },
    };
    subHeader.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
    worksheet.getRow(2).height = 18;

    // Row 3 — spacer
    worksheet.getRow(3).height = 5;

    // Row 4 — column headers
    const headers = [
      "Svc. No.",
      "Rank",
      "Surname",
      "Other Name",
      "Date of Birth",
      "Sex",
      "Bank Code",
      "Bank Branch",
      "Account Number",
      "Date Joined",
      "Seniority Date",
      "Salary Grade",
      "Salary Group",
      "Emol. Form",
    ];
    const headerRow = worksheet.getRow(4);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2E5C8A" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FFFFFFFF" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FFFFFFFF" } },
      };
    });
    headerRow.height = 19.5;

    // Row 5 — sample data
    const sampleData = [
      "NN001",
      "Lt",
      "Doe",
      "John",
      "15/06/1985",
      "M",
      "BK001",
      "001",
      "1234567890",
      "01/01/2010",
      "01/01/2015",
      "0101",
      "AFSS2000",
      "yes",
    ];
    const dataRow = worksheet.getRow(5);
    sampleData.forEach((v, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.value = v;
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD3D3D3" } },
        left: { style: "thin", color: { argb: "FFD3D3D3" } },
        bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
        right: { style: "thin", color: { argb: "FFD3D3D3" } },
      };
    });
    dataRow.height = 22;

    // Empty rows 6-10 with borders
    for (let r = 6; r <= 10; r++) {
      const emptyRow = worksheet.getRow(r);
      headers.forEach((_, i) => {
        emptyRow.getCell(i + 1).border = {
          top: { style: "thin", color: { argb: "FFD3D3D3" } },
          left: { style: "thin", color: { argb: "FFD3D3D3" } },
          bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
          right: { style: "thin", color: { argb: "FFD3D3D3" } },
        };
      });
      emptyRow.height = 22;
    }

    worksheet.columns = [
      { key: "a", width: 9 },
      { key: "b", width: 7 },
      { key: "c", width: 15 },
      { key: "d", width: 15 },
      { key: "e", width: 12 },
      { key: "f", width: 6 },
      { key: "g", width: 12 },
      { key: "h", width: 12 },
      { key: "i", width: 15 },
      { key: "j", width: 13 },
      { key: "k", width: 13 },
      { key: "l", width: 12 },
      { key: "m", width: 13 },
      { key: "n", width: 14 },
    ];

    // Drop-down validations on sample row
    worksheet.getCell("F5").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"M,F"'],
      showErrorMessage: true,
      errorTitle: "Invalid Sex",
      error: "Please select M or F",
    };
    worksheet.getCell("N5").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"yes,no"'],
      showErrorMessage: true,
      errorTitle: "Invalid Value",
      error: "Please select yes or no",
    };

    // Instructions sheet
    const instrSheet = workbook.addWorksheet("Instructions");
    instrSheet.mergeCells("A1:D1");
    const instrHeader = instrSheet.getCell("A1");
    instrHeader.value =
      "INSTRUCTIONS FOR FILLING THE PERSONNEL UPLOAD TEMPLATE";
    instrHeader.font = { size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    instrHeader.alignment = { horizontal: "center", vertical: "middle" };
    instrHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    instrSheet.getRow(1).height = 25;
    instrSheet.getRow(2).height = 10;

    [
      "1. Do not modify the header rows (rows 1-4).",
      "2. Fill data starting from row 5.",
      "3. Date format should be DD/MM/YYYY (e.g., 15/06/1985).",
      "4. Sex should be either M or F.",
      "5. Emolument Form should be either yes or no.",
      "6. Service Number format: NN followed by numbers (e.g., NN001).",
      "7. All fields are required unless marked optional.",
      "8. Bank Code must match valid bank codes in the system.",
      "9. Account Number should be 10 digits.",
    ].forEach((line, i) => {
      const c = instrSheet.getCell(`A${i + 3}`);
      c.value = line;
      c.font = { name: "Arial", size: 11 };
      c.alignment = { horizontal: "left", vertical: "middle" };
    });
    instrSheet.getColumn("A").width = 65;

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Personnel_Upload_Template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(await workbook.xlsx.writeBuffer());
  } catch (error) {
    console.error("Error generating upload template:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate template" });
  }
});

// =============================================================================
// ROUTE: GET /batch-update-template  (Download UPDATE template)
// =============================================================================
// Amber/gold colour scheme to distinguish it visually from the insert template.
// Column A (Svc. No.) is marked as the mandatory KEY column.
// Includes Exit Mode + Date Left columns for retirement/exit workflows.
// =============================================================================
router.get("/batch-update-template", verifyToken, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("PersonnelUpdate", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    // Row 1 — main header (amber/gold scheme)
    worksheet.mergeCells("A1:P1");
    const mainHeader = worksheet.getCell("A1");
    mainHeader.value =
      "Nigerian Navy (Naval Headquarters) — CENTRAL PAY OFFICE";
    mainHeader.font = {
      name: "Arial",
      size: 13,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    mainHeader.alignment = { horizontal: "center", vertical: "middle" };
    mainHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    mainHeader.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
    worksheet.getRow(1).height = 22;

    // Row 2 — sub header
    worksheet.mergeCells("A2:P2");
    const subHeader = worksheet.getCell("A2");
    subHeader.value =
      "PERSONNEL DATA UPDATE — Use this template to update existing personnel records only";
    subHeader.font = { name: "Arial", size: 10, bold: true };
    subHeader.alignment = { horizontal: "center", vertical: "middle" };
    subHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9D9D9" },
    };
    subHeader.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
    worksheet.getRow(2).height = 18;

    // Row 3 — spacer
    worksheet.getRow(3).height = 5;

    // Row 4 — column headers
    const headers = [
      "Svc. No.", // A  ← KEY column (Empl_ID)
      "Rank", // B
      "Surname", // C
      "Other Name", // D
      "Date of Birth", // E
      "Sex", // F
      "Bank Code", // G
      "Bank Branch", // H
      "Account Number", // I
      "Date Joined", // J
      "Seniority Date", // K
      "Salary Grade", // L
      "Salary Group", // M
      "Exit Mode", // N  ← use '2210' for retired-still-on-payroll
      "Date Left", // O
      "Emol. Form", // P
    ];

    const headerRow = worksheet.getRow(4);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FFFFFFFF" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FFFFFFFF" } },
      };

      // Column A (Svc. No.) gets a gold highlight — it's the required key
      if (i === 0) {
        cell.font = {
          name: "Arial",
          size: 10,
          bold: true,
          color: { argb: "FF000000" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFC000" },
        }; // gold
      } else {
        cell.font = {
          name: "Arial",
          size: 10,
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFC55A11" },
        }; // amber
      }
    });
    headerRow.height = 19.5;

    // Row 5 — sample data
    const sampleData = [
      "NN001", // Svc. No.
      "", // Rank        (leave blank to keep existing value)
      "", // Surname
      "", // Other Name
      "", // Date of Birth
      "", // Sex
      "", // Bank Code
      "", // Bank Branch
      "0987654321", // Account Number  (only this will be updated in the example)
      "", // Date Joined
      "", // Seniority Date
      "", // Salary Grade
      "", // Salary Group
      "", // Exit Mode
      "", // Date Left
      "", // Emol. Form
    ];
    const dataRow = worksheet.getRow(5);
    sampleData.forEach((v, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.value = v;
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      // Highlight the Svc. No. cell in the data rows too
      if (i === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFFFFF" },
        };
        cell.font = { name: "Arial", size: 10, bold: true };
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FFD3D3D3" } },
        left: { style: "thin", color: { argb: "FFD3D3D3" } },
        bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
        right: { style: "thin", color: { argb: "FFD3D3D3" } },
      };
    });
    dataRow.height = 22;

    // Empty rows 6-15 with Svc. No. column highlighted
    for (let r = 6; r <= 15; r++) {
      const emptyRow = worksheet.getRow(r);
      headers.forEach((_, i) => {
        const cell = emptyRow.getCell(i + 1);
        if (i === 0) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFFFFF" },
          };
        }
        cell.border = {
          top: { style: "thin", color: { argb: "FFD3D3D3" } },
          left: { style: "thin", color: { argb: "FFD3D3D3" } },
          bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
          right: { style: "thin", color: { argb: "FFD3D3D3" } },
        };
      });
      emptyRow.height = 22;
    }

    worksheet.columns = [
      { key: "a", width: 10 },
      { key: "b", width: 7 },
      { key: "c", width: 15 },
      { key: "d", width: 15 },
      { key: "e", width: 12 },
      { key: "f", width: 6 },
      { key: "g", width: 12 },
      { key: "h", width: 12 },
      { key: "i", width: 15 },
      { key: "j", width: 13 },
      { key: "k", width: 13 },
      { key: "l", width: 12 },
      { key: "m", width: 13 },
      { key: "n", width: 12 },
      { key: "o", width: 13 },
      { key: "p", width: 13 },
    ];

    // Drop-down validations on sample row
    worksheet.getCell("F5").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"M,F"'],
      showErrorMessage: true,
      errorTitle: "Invalid Sex",
      error: "Please select M or F",
    };
    worksheet.getCell("P5").dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"yes,no"'],
      showErrorMessage: true,
      errorTitle: "Invalid Value",
      error: "Please select yes or no",
    };

    // Instructions sheet
    const instrSheet = workbook.addWorksheet("Instructions");
    instrSheet.mergeCells("A1:D1");
    const instrHeader = instrSheet.getCell("A1");
    instrHeader.value =
      "INSTRUCTIONS FOR FILLING THE PERSONNEL UPDATE TEMPLATE";
    instrHeader.font = { size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    instrHeader.alignment = { horizontal: "center", vertical: "middle" };
    instrHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF7B3F00" },
    };
    instrSheet.getRow(1).height = 25;
    instrSheet.getRow(2).height = 10;

    [
      "1. Do not modify the header rows (rows 1-4).",
      "2. Fill data starting from row 5.",
      "3. Column A (Svc. No.) is MANDATORY — it identifies the personnel record to update.",
      "4. Leave any cell blank to keep the existing value in the database.",
      "5. Date format should be DD/MM/YYYY (e.g., 15/06/1985).",
      "6. Sex should be either M or F.",
      "7. Emolument Form should be either yes or no.",
      '8. Exit Mode "2210" = Retired but still on restricted allowances.',
      "   Setting Exit Mode to 2210 will automatically clear all existing payded entries",
      "   for that personnel, allowing the payroll engine to re-apply only permitted ones.",
      "9. Payroll Class, Passport, and Created-By cannot be changed via this template.",
      "10. Account Number should be 10 digits.",
    ].forEach((line, i) => {
      const c = instrSheet.getCell(`A${i + 3}`);
      c.value = line;
      c.font = {
        name: "Arial",
        size: 11,
        bold: line.includes("MANDATORY") || line.includes("2210"),
      };
      c.alignment = { horizontal: "left", vertical: "middle" };
    });
    instrSheet.getColumn("A").width = 75;

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Personnel_Update_Template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(await workbook.xlsx.writeBuffer());
  } catch (error) {
    console.error("Error generating update template:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate update template" });
  }
});

// =============================================================================
// ROUTE: GET /batch-history
// =============================================================================
router.get("/batch-history", verifyToken, async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT id, filename, total_records, successful_records,
             failed_records, uploaded_by, upload_date, status
      FROM tblBatchUploads
      ORDER BY upload_date DESC
      LIMIT 50
    `);
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("Failed to fetch batch history:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch batch history", details: error.message });
  }
});

// =============================================================================
// MULTER ERROR HANDLER
// =============================================================================
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File size exceeds 10 MB limit" });
    }
    return res.status(400).json({ error: error.message });
  }
  if (error) return res.status(400).json({ error: error.message });
  next();
});

module.exports = router;
