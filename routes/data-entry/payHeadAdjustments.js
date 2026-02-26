const express = require("express");
const multer = require("multer");
const ExcelJS = require('exceljs');
const XLSX = require("xlsx");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const pool = require("../../config/db"); // mysql2 pool
const verifyToken = require("../../middware/authentication");
const config = require("../../config");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      "batch-adjustments-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({
  storage,
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

// converts keys to lowercase and spaces to _
function normalize(row) {
  const normalized = {};

  for (const key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;

    const lowerKey = key.trim().toLowerCase().replace(/\s+/g, "_");
    normalized[lowerKey] = row[key];
  }

  return normalized;
}

const PAYCLASS_MAPPING = {
  1: config.databases.officers,
  2: config.databases.wofficers,
  3: config.databases.ratings,
  4: config.databases.ratingsA,
  5: config.databases.ratingsB,
  6: config.databases.juniorTrainee,
};

// Helper function to parse Excel file(multi-sheet)
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const allData = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const sheetData = XLSX.utils.sheet_to_json(worksheet);

    // Tag each row with its source sheet
    const dataWithSheet = sheetData.map((row) => ({
      ...row,
      _sourceSheet: sheetName,
    }));

    allData.push(...dataWithSheet);
  }

  return allData;
}

// Helper function to parse CSV file
function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error));
  });
}

function rowSignature(row) {
  const sortedKeys = Object.keys(row).sort();
  const normalized = {};

  for (const key of sortedKeys) {
    const value = row[key];
    normalized[key] = typeof value === "string" ? value.trim() : value;
  }

  return JSON.stringify(normalized);
}

function deduplicate(rows) {
  const seen = new Set();
  const cleaned = [];
  const duplicates = [];

  for (const row of rows) {
    const sig = rowSignature(row);
    if (!seen.has(sig)) {
      seen.add(sig);
      cleaned.push(row);
    } else {
      duplicates.push(row);
    }
  }

  return { cleaned, duplicates };
}

router.post("/", verifyToken, upload.single("file"), async (req, res) => {
  try {
    let filePath = null;
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const createdBy = req.user_fullname || "SYSTEM";

    // Parse file
    let rawData;
    if (fileExt === ".csv") {
      rawData = (await parseCSVFile(filePath)).map(normalize);
    } else {
      rawData = parseExcelFile(filePath).map(normalize);
    }

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ error: "File is empty or invalid" });
    }
    rawData = rawData?.filter((row) => Object.keys(row).length > 0);

    const { cleaned, duplicates } = deduplicate(rawData);

    const query = `SELECT Empl_id, gradelevel FROM hr_employees WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')`;

    const [rows] = await pool.query(query);

    const activeEmployeeSet = new Set(rows.map((r) => r.Empl_id));

    const filtered = cleaned.filter((row) =>
      activeEmployeeSet.has(row.numb?.trim()),
    );

    const employeeMap = new Map(
      rows.map((e) => [e.Empl_id.trim().toLowerCase(), e.gradelevel]),
    );

    for (const row of filtered) {
      const level = employeeMap.get(row.numb?.trim().toLowerCase());
      if (level) row.level = level.slice(0, 2);
    }

    const payclassMap = new Map();
    for (const row of filtered) {
      const payclass = row.payclass;
      if (!payclassMap.has(payclass)) {
        payclassMap.set(payclass, []);
      }
      payclassMap.get(payclass).push(row);
    }

    const results = {
      totalUniqueRecords: cleaned.length,
      inactive: cleaned.length - filtered.length, //deduplicated vs active(active is used for the rest of the way)
      uploaded: 0,
      existing: 0,
      duplicates: duplicates.length,
    };

    const insertRecords = [];
    for (const [payclass, rows] of payclassMap.entries()) {
      const db = PAYCLASS_MAPPING[payclass];
      if (!db) {
        console.warn(`No database mapping for payclass ${payclass}, skipping`);
        continue;
      }

      const connection = await pool.getConnection();
      await connection.query(`USE ??`, [db]);

      const bpDescriptions = [...new Set(rows.map((r) => r.bp))];

      const query = `
        SELECT
          e.PaymentType,
          e.elmDesc,
          e.perc,
          e.Status,
          p.*
          FROM py_elementType e
          LEFT JOIN py_payperrank p
          ON p.one_type = e.PaymentType
          WHERE LOWER(e.elmDesc) IN (${bpDescriptions.map(() => "?").join(",")})
          `;

      const [payperrankRows] = await connection.query(
        query,
        bpDescriptions.map((b) => b.toLowerCase().trim()),
      );

      const payperrankMap = new Map();

      for (const ppr of payperrankRows) {
        const key = `${ppr.elmDesc}`.toLowerCase().trim();
        payperrankMap.set(key, ppr);
      }

      for (const row of rows) {
        const ppr = payperrankMap.get(row.bp.toLowerCase().trim());

        if (!ppr) continue;

        row.code = ppr.PaymentType;

        if (
          !row.bpm &&
          ppr.Status.toLowerCase().trim() === "active" &&
          ppr.perc === "R"
        ) {
          row.bpm = ppr[`one_amount${row.level}`] || 0;
        }

        insertRecords.push({
          "SVC. No.": row.numb,
          "Payment Type": row.code,
          "Amount Payable": row.bpm,
          "Payment Indicator": "T",
          "Ternor": 1,
          _sourceSheet: row._sourceSheet || row._sourcesheet || "Sheet1",
        });
      }

      if (insertRecords.length === 0) {
        continue;
      }
    }

    // NEW: Group records by source sheet
    const recordsBySheet = {};
    for (const record of insertRecords) {
      const sheetName = record._sourceSheet || "Sheet1";

      if (!recordsBySheet[sheetName]) {
        recordsBySheet[sheetName] = [];
      }

      // Remove _sourceSheet before adding to output
      const { _sourceSheet, ...cleanRecord } = record;
      recordsBySheet[sheetName].push(cleanRecord);
    }

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    for (const [sheetName, records] of Object.entries(recordsBySheet)) {
      if (!records.length) continue;
      const worksheet = workbook.addWorksheet(sheetName || 'Sheet 1', {
        views: [{ state: 'frozen', ySplit: 4 }] // Freeze first 4 rows
      });

      // Add main header - Row 1
      worksheet.mergeCells('A1:E1');
      const mainHeader = worksheet.getCell('A1');
      mainHeader.value = 'Nigerian Navy (Naval Headquarters)';
      mainHeader.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
      mainHeader.alignment = { horizontal: 'center', vertical: 'middle' };
      mainHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E78' } // Dark navy blue
      };
      mainHeader.border = {
        bottom: { style: 'thin', color: { argb: 'FF000000' } }
      };
      worksheet.getRow(1).height = 22;

      // Add sub header - Row 2
      worksheet.mergeCells('A2:E2');
      const subHeader = worksheet.getCell('A2');
      subHeader.value = 'CENTRAL PAY OFFICE, 23 POINT ROAD, APAPA';
      subHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF000000' } };
      subHeader.alignment = { horizontal: 'center', vertical: 'middle' };
      subHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' } // Medium gray
      };
      subHeader.border = {
        bottom: { style: 'thin', color: { argb: 'FF000000' } }
      };
      worksheet.getRow(2).height = 18;

      // Empty row 3
      worksheet.getRow(3).height = 5;
      //headers comes from record

      const headers = Object?.keys(records[0])

      const headerRow = worksheet.getRow(4);
      headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E5C8A' } // Darker blue
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
        };
      });
      headerRow.height = 19.5;



      //add records Array<Record<any,any>>

     
      let currentRowNumber = 5;

      records.forEach((record) => {
        const row = worksheet.getRow(currentRowNumber);

        headers.forEach((header, colIndex) => {
          const cell = row.getCell(colIndex + 1);
          cell.value = record[header];

       
          if (header === "Amount Payable" || header === "Amount To Date") {
            cell.numFmt = '"₦"#,##0.00';
            cell.alignment = { horizontal: "right", vertical: "middle" };
          }

          // Border for clean table look
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
          };
        });

        row.height = 18;
        currentRowNumber++;

      });

      // Add data validation
      // Payment Indicator column (D)
      worksheet.getCell('D5').dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"T,P"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Payment Indicator',
        error: 'Please select T (Temporary) or P (Permanent)'
      };

      worksheet.columns.forEach((column) => {
       column.width = 18
      });


    }

    const buffer = await workbook.xlsx.writeBuffer()
    // Clean up file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Shape of Summary
    // { totalUniqueRecords: '', inactive: 0, Uploaded:'', existing:'', duplicates:''}

    return res.status(200).json({
      message: "Batch adjustment upload completed",
      summary: results,
      file: {
        filename: "pay_head-adjustments.xlsx",
        data: buffer.toString("base64"),
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    console.error("Error processing adjustments:", error);
    res.status(500).json({
      success: false,
      message: "Error processing adjustments",
      error: error.message,
    });
  }
});

// GET: Download sample template
router.get("/template", verifyToken, (req, res) => {
  // Create sample data
  const sampleData = [
    {
      Numb: "NN001",
      title: "Lt",
      Surname: "Dabrinze",
      "Other Names": "Nihinkea",
      BPC: "BP",
      BP: "REVISED CONSOLIDATED PAY",
      BPA: "TAXABLE PAYMENT",
      BPM: "237007.92",
      Payclass: "1",
    },
  ];

  // Create workbook
  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Payment-Adjustments-Sample",
  );

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  // Send file
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=payment-Adjustments_template.xlsx",
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buffer);
});

// Error handling middleware
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File size exceeds 10MB limit" });
    }
    return res.status(400).json({ error: error.message });
  }

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  next();
});

module.exports = router;
