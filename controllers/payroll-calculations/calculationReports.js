const pool = require('../../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  company: {
    name: 'Nigerian Navy (Naval Headquarters)',
    address: '123 Business Street, City, Country',
    phone: '+234 XXX XXX XXXX',
    email: 'hr@company.com'
  },
  colors: {
    primary: '1F4E79',
    secondary: '2E75B6',
    header: 'D6DCE5',
    altRow: 'F2F2F2'
  }
};

// ============================================
// EXISTING HELPER FUNCTIONS
// ============================================
async function checkCalculationsComplete() {
  const [bt05] = await pool.query("SELECT sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
  if (!bt05.length || bt05[0].sun < 999) {
    throw new Error('Payroll calculations must be completed first');
  }
  return bt05[0];
}

async function getCurrentPeriod() {
  const [period] = await pool.query("SELECT ord as year, mth as month FROM py_stdrate WHERE type='BT05' LIMIT 1");
  return period[0] || {};
}

function getMonthName(month) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month] || month;
}

function formatMoney(amount) {
  const num = parseFloat(amount);
  const parts = num.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// ============================================
// UNIFIED EXPORT HANDLER
// Route: GET /:reportType/export/:format
// Examples: /bank/export/excel, /tax/export/pdf
// ============================================
exports.exportReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const { reportType, format } = req.params;
    const period = await getCurrentPeriod();

    if (format === 'excel') {
      return await generateExcelReport(req, res, reportType, period);
    } else if (format === 'pdf') {
      return await generatePDFReport(req, res, reportType, period);
    } else {
      throw new Error('Invalid format. Use "excel" or "pdf"');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXCEL EXPORT
// ============================================
async function generateExcelReport(req, res, reportType, period) {
  try {

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payroll System';
    workbook.created = new Date();

    switch (reportType) {
      case 'allowances':
        await createAllowancesExcel(workbook, period);
        break;
      case 'bank':
        await createBankExcel(workbook, period);
        break;
      case 'deductions':
        await createDeductionsExcel(workbook, period);
        break;
      case 'tax':
        await createTaxExcel(workbook, period);
        break;
      case 'department':
        await createDepartmentExcel(workbook, period);
        break;
      case 'grade':
        await createGradeExcel(workbook, period);
        break;
      case 'exceptions':
        await createExceptionsExcel(workbook, period);
        break;
      case 'summary':
        await createSummaryExcel(workbook, period);
        break;
      default:
        throw new Error('Invalid report type');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}_report_${period.year}_${period.month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXCEL HELPER FUNCTIONS
// ============================================
function addExcelHeader(ws, title, period, columnCount) {
  ws.mergeCells(1, 1, 1, columnCount);
  ws.mergeCells(2, 1, 2, columnCount);
  ws.mergeCells(3, 1, 3, columnCount);

  const companyCell = ws.getCell('A1');
  companyCell.value = CONFIG.company.name;
  companyCell.font = { size: 16, bold: true, color: { argb: CONFIG.colors.primary } };
  companyCell.alignment = { horizontal: 'center' };

  const titleCell = ws.getCell('A2');
  titleCell.value = title;
  titleCell.font = { size: 12, bold: true };
  titleCell.alignment = { horizontal: 'center' };

  const periodCell = ws.getCell('A3');
  periodCell.value = `Period: ${getMonthName(period.month)} ${period.year}`;
  periodCell.font = { size: 10, italic: true };
  periodCell.alignment = { horizontal: 'center' };

  return 5; // Starting row for data
}

function styleHeaderRow(ws, row, columnCount) {
  for (let i = 1; i <= columnCount; i++) {
    const cell = ws.getRow(row).getCell(i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.primary } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  }
  ws.getRow(row).height = 22;
}

function addDataRows(ws, data, columns, startRow) {
  data.forEach((item, idx) => {
    const row = ws.getRow(startRow + idx);
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = col.transform ? col.transform(item[col.key], item) : item[col.key];
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.border = {
        top: { style: 'thin', color: { argb: 'DDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'DDDDDD' } }
      };
    });
    // Alternate row colors
    if (idx % 2 === 0) {
      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.altRow } };
      }
    }
  });
  return startRow + data.length;
}

function addTotalsRow(ws, row, totals, columnCount) {
  const totalRow = ws.getRow(row);
  totalRow.getCell(1).value = 'TOTALS:';
  totalRow.getCell(1).font = { bold: true };
  
  Object.entries(totals).forEach(([colIdx, value]) => {
    const cell = totalRow.getCell(parseInt(colIdx));
    cell.value = value;
    cell.font = { bold: true };
    cell.numFmt = '#,##0.00';
  });

  for (let i = 1; i <= columnCount; i++) {
    totalRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIG.colors.header } };
    totalRow.getCell(i).border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
  }
}

// ============================================
// ALLOWANCES REPORT - EXCEL
// ============================================
async function createAllowancesExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mp.his_type,
      et.elmDesc as allowance_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'PT' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `);

  const ws = workbook.addWorksheet('Allowances Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Code', key: 'his_type', width: 10 },
    { header: 'Allowance Name', key: 'allowance_name', width: 30 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Total (₦)', key: 'total_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Average (₦)', key: 'average_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Min (₦)', key: 'min_amount', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Max (₦)', key: 'max_amount', width: 12, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'ALLOWANCES SUMMARY REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totalAllowances = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  addTotalsRow(ws, endRow + 1, { 5: totalAllowances }, columns.length);
}

// ============================================
// BANK REPORT EXCEL
// ============================================
async function createBankExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno AS employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.bankcode,
      we.bankbranch,
      we.bankacnumber,
      ROUND(mc.his_netmth, 2) AS net_pay,
      ROUND(mc.his_grossmth, 2) AS gross_pay
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY we.bankcode, we.Surname
  `, [period.month]);

  const ws = workbook.addWorksheet('Bank Schedule', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Employee ID', key: 'employee_id', width: 12 },
    { header: 'Full Name', key: 'full_name', width: 30 },
    { header: 'Bank Code', key: 'bankcode', width: 12 },
    { header: 'Branch', key: 'bankbranch', width: 15 },
    { header: 'Account Number', key: 'bankacnumber', width: 18 },
    { header: 'Net Pay (₦)', key: 'net_pay', width: 15, align: 'right', numFmt: '#,##0.00' }
  ];

  // Set column widths
  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'BANK PAYMENT SCHEDULE', period, columns.length);

  // Add headers
  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  // Add serial numbers and data
  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  // Totals
  const totalNet = data.reduce((sum, d) => sum + parseFloat(d.net_pay || 0), 0);
  addTotalsRow(ws, endRow + 1, { 7: totalNet }, columns.length);

  // Record count
  ws.getCell(`A${endRow + 3}`).value = `Total Records: ${data.length}`;
  ws.getCell(`A${endRow + 3}`).font = { italic: true };
}

// ============================================
// DEDUCTIONS REPORT EXCEL
// ============================================
async function createDeductionsExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mp.his_type,
      et.elmDesc as deduction_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'PR' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `);

  const ws = workbook.addWorksheet('Deductions Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Code', key: 'his_type', width: 10 },
    { header: 'Deduction Name', key: 'deduction_name', width: 30 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Total (₦)', key: 'total_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Average (₦)', key: 'average_amount', width: 15, align: 'right', numFmt: '#,##0.00' },
    { header: 'Min (₦)', key: 'min_amount', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Max (₦)', key: 'max_amount', width: 12, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'DEDUCTIONS SUMMARY REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totalDeductions = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  addTotalsRow(ws, endRow + 1, { 5: totalDeductions }, columns.length);
}

// ============================================
// TAX REPORT EXCEL
// ============================================
async function createTaxExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.gradelevel,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_taxfreepaytodate, 2) as tax_free_pay,
      ROUND(mc.his_taxabletodate, 2) as taxable_income,
      ROUND(mc.his_taxmth, 2) as tax_deducted,
      ROUND(mc.his_taxtodate, 2) as cumulative_tax
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY mc.his_taxmth DESC
  `, [period.month]);

  const ws = workbook.addWorksheet('PAYE Tax Report', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Emp ID', key: 'employee_id', width: 10 },
    { header: 'Full Name', key: 'full_name', width: 28 },
    { header: 'Grade', key: 'gradelevel', width: 10, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'gross_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax Free (₦)', key: 'tax_free_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Taxable (₦)', key: 'taxable_income', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'PAYE (₦)', key: 'tax_deducted', width: 12, align: 'right', numFmt: '#,##0.00' },
    { header: 'Cum. Tax (₦)', key: 'cumulative_tax', width: 14, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'PAYE TAX SCHEDULE', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    5: data.reduce((sum, d) => sum + parseFloat(d.gross_pay || 0), 0),
    7: data.reduce((sum, d) => sum + parseFloat(d.taxable_income || 0), 0),
    8: data.reduce((sum, d) => sum + parseFloat(d.tax_deducted || 0), 0)
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// DEPARTMENT REPORT EXCEL
// ============================================
async function createDepartmentExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      we.Location as department,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_taxmth), 2) as total_tax,
      ROUND(SUM(mc.his_netmth), 2) as total_net,
      ROUND(AVG(mc.his_netmth), 2) as average_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.Location
    ORDER BY total_net DESC
  `, [period.month]);

  const ws = workbook.addWorksheet('Department Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const totalNet = data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0);

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Department/Location', key: 'department', width: 25 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'total_gross', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax (₦)', key: 'total_tax', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'total_net', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Avg Net (₦)', key: 'average_net', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: '% of Total', key: 'percentage', width: 10, align: 'center',
      transform: (_, item) => ((parseFloat(item.total_net) / totalNet) * 100).toFixed(1) + '%' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'DEPARTMENTAL PAYROLL SUMMARY', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    3: data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0),
    4: data.reduce((sum, d) => sum + parseFloat(d.total_gross || 0), 0),
    5: data.reduce((sum, d) => sum + parseFloat(d.total_tax || 0), 0),
    6: totalNet
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// GRADE REPORT EXCEL
// ============================================
async function createGradeExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      we.gradelevel as grade,
      we.gradetype,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_taxmth), 2) as total_tax,
      ROUND(SUM(mc.his_netmth), 2) as total_net,
      ROUND(AVG(mc.his_netmth), 2) as average_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.gradelevel, we.gradetype
    ORDER BY we.gradelevel
  `, [period.month]);

  const ws = workbook.addWorksheet('Grade Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Grade Level', key: 'grade', width: 12 },
    { header: 'Grade Type', key: 'gradetype', width: 15 },
    { header: 'Employees', key: 'employee_count', width: 12, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'total_gross', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Tax (₦)', key: 'total_tax', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'total_net', width: 16, align: 'right', numFmt: '#,##0.00' },
    { header: 'Avg Net (₦)', key: 'average_net', width: 14, align: 'right', numFmt: '#,##0.00' }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'GRADE-WISE PAYROLL SUMMARY', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  const endRow = addDataRows(ws, dataWithSN, columns, startRow + 1);

  const totals = {
    4: data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0),
    5: data.reduce((sum, d) => sum + parseFloat(d.total_gross || 0), 0),
    6: data.reduce((sum, d) => sum + parseFloat(d.total_tax || 0), 0),
    7: data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0)
  };
  addTotalsRow(ws, endRow + 1, totals, columns.length);
}

// ============================================
// EXCEPTIONS REPORT EXCEL
// ============================================
async function createExceptionsExcel(workbook, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.gradelevel,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_netmth, 2) as net_pay,
      CASE
        WHEN mc.his_netmth <= 0 THEN 'Zero or Negative Pay'
        WHEN mc.his_grossmth <= 0 THEN 'Zero Gross Pay'
        WHEN mc.his_netmth > mc.his_grossmth THEN 'Net Exceeds Gross'
        WHEN mc.his_taxmth < 0 THEN 'Negative Tax'
        ELSE 'Other Exception'
      END as exception_type
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
      AND (mc.his_netmth <= 0 OR mc.his_grossmth <= 0 OR mc.his_netmth > mc.his_grossmth OR mc.his_taxmth < 0)
    ORDER BY exception_type, full_name
  `, [period.month]);

  const ws = workbook.addWorksheet('Exceptions Report', {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  const columns = [
    { header: 'S/N', key: 'sn', width: 6, align: 'center' },
    { header: 'Employee ID', key: 'employee_id', width: 12 },
    { header: 'Full Name', key: 'full_name', width: 28 },
    { header: 'Grade', key: 'gradelevel', width: 10, align: 'center' },
    { header: 'Gross Pay (₦)', key: 'gross_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Net Pay (₦)', key: 'net_pay', width: 14, align: 'right', numFmt: '#,##0.00' },
    { header: 'Exception Type', key: 'exception_type', width: 22 }
  ];

  columns.forEach((col, idx) => { ws.getColumn(idx + 1).width = col.width; });

  const startRow = addExcelHeader(ws, 'PAYROLL EXCEPTIONS REPORT', period, columns.length);

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, idx) => { headerRow.getCell(idx + 1).value = col.header; });
  styleHeaderRow(ws, startRow, columns.length);

  const dataWithSN = data.map((item, idx) => ({ ...item, sn: idx + 1 }));
  addDataRows(ws, dataWithSN, columns, startRow + 1);

  // Summary by exception type
  const summaryRow = startRow + data.length + 3;
  ws.getCell(`A${summaryRow}`).value = 'Summary by Exception Type:';
  ws.getCell(`A${summaryRow}`).font = { bold: true };

  const exceptionCounts = data.reduce((acc, d) => {
    acc[d.exception_type] = (acc[d.exception_type] || 0) + 1;
    return acc;
  }, {});

  let row = summaryRow + 1;
  Object.entries(exceptionCounts).forEach(([type, count]) => {
    ws.getCell(`A${row}`).value = type;
    ws.getCell(`B${row}`).value = count;
    row++;
  });
}

// ============================================
// SUMMARY REPORT EXCEL
// ============================================
async function createSummaryExcel(workbook, period) {
  // Get summary data
  const [[summary]] = await pool.query(`
    SELECT 
      COUNT(DISTINCT his_empno) AS total_employees,
      ROUND(SUM(his_grossmth), 2) AS total_gross,
      ROUND(SUM(his_taxmth), 2) AS total_tax,
      ROUND(COALESCE(SUM(his_netmth), 0), 2) AS total_net,
      ROUND(AVG(his_netmth), 2) AS average_net_pay
    FROM py_mastercum WHERE his_type = ?
  `, [period.month]);

  const [[payded]] = await pool.query(`
    SELECT 
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 2) AS total_deductions,
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) AS total_allowances
    FROM py_masterpayded
  `);

  const ws = workbook.addWorksheet('Payroll Summary', {
    pageSetup: { paperSize: 9, orientation: 'portrait' }
  });

  addExcelHeader(ws, 'PAYROLL SUMMARY REPORT', period, 4);

  // Summary cards
  const summaryData = [
    ['Total Employees', summary.total_employees],
    ['Total Gross Pay', formatMoney(summary.total_gross)],
    ['Total Allowances', formatMoney(payded.total_allowances)],
    ['Total Deductions', formatMoney(payded.total_deductions)],
    ['Total Tax (PAYE)', formatMoney(summary.total_tax)],
    ['Total Net Pay', formatMoney(summary.total_net)],
    ['Average Net Pay', formatMoney(summary.average_net_pay)]
  ];

  let row = 6;
  summaryData.forEach(([label, value]) => {
    ws.getCell(`B${row}`).value = label;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`C${row}`).value = value;
    ws.getCell(`C${row}`).alignment = { horizontal: 'right' };
    ws.getCell(`C${row}`).border = { bottom: { style: 'thin', color: { argb: 'DDDDDD' } } };
    row++;
  });

  ws.getColumn(2).width = 25;
  ws.getColumn(3).width = 20;
}

// ============================================
// PDF EXPORT
// ============================================
async function generatePDFReport(req, res, reportType, period) {
  try {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}_report_${period.year}_${period.month}.pdf`);
    doc.pipe(res);

    switch (reportType) {
      case 'allowances':
        await generateAllowancesPDF(doc, period);
        break;
      case 'bank':
        await generateBankPDF(doc, period);
        break;
      case 'deductions':
        await generateDeductionsPDF(doc, period);
        break;
      case 'tax':
        await generateTaxPDF(doc, period);
        break;
      case 'department':
        await generateDepartmentPDF(doc, period);
        break;
      case 'grade':
        await generateGradePDF(doc, period);
        break;
      case 'exceptions':
        await generateExceptionsPDF(doc, period);
        break;
      case 'summary':
        await generateSummaryPDF(doc, period);
        break;
      default:
        throw new Error('Invalid report type');
    }

    // Add page numbers
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#666666');
      doc.text(`Page ${i + 1} of ${pages.count}`, 50, doc.page.height - 30, { align: 'center' });
    }

    doc.end();
  } catch (error) {
    throw error;
  }
}

// ============================================
// PDF HELPER FUNCTIONS
// ============================================
function addPDFHeader(doc, title, period) {
  doc.fontSize(16).fillColor('#1F4E79').font('Helvetica-Bold')
     .text(CONFIG.company.name, { align: 'center' });
  doc.fontSize(9).fillColor('#666666').font('Helvetica')
     .text(CONFIG.company.address, { align: 'center' })
     .text(`Tel: ${CONFIG.company.phone} | Email: ${CONFIG.company.email}`, { align: 'center' });

  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#000000').font('Helvetica-Bold')
     .text(title, { align: 'center' });
  doc.fontSize(10).font('Helvetica')
     .text(`Period: ${getMonthName(period.month)} ${period.year}`, { align: 'center' });

  doc.moveDown(0.3);
  doc.strokeColor('#1F4E79').lineWidth(1.5)
     .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  return doc.y;
}

function drawPDFTable(doc, headers, data, options = {}) {
  const { startY = doc.y, rowHeight = 18 } = options;
  const pageWidth = doc.page.width - 100;
  const colWidths = headers.map(h => h.width);
  
  let currentY = startY;
  const startX = 50;

  // Draw header background
  doc.fillColor('#1F4E79').rect(startX, currentY, pageWidth, rowHeight + 2).fill();

  // Draw header text
  doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
  let xPos = startX;
  headers.forEach((header) => {
    doc.text(header.label, xPos + 3, currentY + 4, {
      width: header.width - 6,
      align: header.align || 'left'
    });
    xPos += header.width;
  });
  currentY += rowHeight + 2;

  // Draw data rows
  doc.font('Helvetica').fontSize(7);
  data.forEach((row, rowIdx) => {
    // Check for page break
    if (currentY > doc.page.height - 70) {
      doc.addPage();
      currentY = 50;

      // Redraw header on new page
      doc.fillColor('#1F4E79').rect(startX, currentY, pageWidth, rowHeight + 2).fill();
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
      xPos = startX;
      headers.forEach((header) => {
        doc.text(header.label, xPos + 3, currentY + 4, { width: header.width - 6, align: header.align || 'left' });
        xPos += header.width;
      });
      currentY += rowHeight + 2;
      doc.font('Helvetica').fontSize(7);
    }

    // Alternate row background
    if (rowIdx % 2 === 0) {
      doc.fillColor('#F5F5F5').rect(startX, currentY, pageWidth, rowHeight).fill();
    }

    // Draw row data
    doc.fillColor('#000000');
    xPos = startX;
    headers.forEach((header) => {
      const value = row[header.key] !== undefined ? String(row[header.key]) : '';
      doc.text(value, xPos + 3, currentY + 4, {
        width: header.width - 6,
        align: header.align || 'left'
      });
      xPos += header.width;
    });
    currentY += rowHeight;
  });

  return currentY;
}

function addPDFTotals(doc, y, labels) {
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#1F4E79').font('Helvetica-Bold');
  labels.forEach((label, idx) => {
    doc.text(label, 50, y + (idx * 15));
  });
  doc.font('Helvetica');
}

function addSignatureSection(doc) {
  const y = doc.y + 40;
  doc.fontSize(9).fillColor('#000000');
  doc.text('Prepared By: _______________________', 50, y);
  doc.text('Approved By: _______________________', 300, y);
  doc.text('Date: _____________', 50, y + 25);
  doc.text('Date: _____________', 300, y + 25);
}

// ===== HELPER FUNCTION: Text Truncation =====
function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}


// ============================================
// ALLOWANCES REPORT - PDF
// ============================================
async function generateAllowancesPDF(doc, period) {
  // Fetch allowances data with comprehensive metrics
  const [data] = await pool.query`
    SELECT 
      mp.his_type,
      et.elmDesc as allowance_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'PT' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `;

  // ===== DOCUMENT HEADER =====
  addPDFHeader(doc, 'ALLOWANCES SUMMARY REPORT', period);
  
  let currentY = doc.y + 15;

  // ===== EXECUTIVE SUMMARY SECTION =====
  const totalAllowances = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  const totalEmployees = data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0);
  const allowanceTypes = data.length;

  doc.fontSize(11)
     .font('Helvetica-Bold')
     .fillColor('#2c3e50')
     .text('EXECUTIVE SUMMARY', 50, currentY);
  
  currentY += 20;

  // Summary boxes with professional styling
  const summaryMetrics = [
    { label: 'Total Allowance Types', value: allowanceTypes, icon: '▪' },
    { label: 'Total Employees Affected', value: totalEmployees.toLocaleString(), icon: '▪' },
    { label: 'Total Allowances Paid', value: `₦${formatMoney(totalAllowances)}`, icon: '▪' },
    { label: 'Average per Employee', value: `₦${formatMoney(totalAllowances / totalEmployees)}`, icon: '▪' }
  ];

  doc.fontSize(9).font('Helvetica');
  
  summaryMetrics.forEach((metric, idx) => {
    const xPos = 50 + (idx % 2) * 260;
    const yPos = currentY + Math.floor(idx / 2) * 35;
    
    // Background box
    doc.rect(xPos, yPos, 240, 28)
       .fillAndStroke('#f8f9fa', '#dee2e6');
    
    // Icon
    doc.fillColor('#3498db')
       .font('Helvetica-Bold')
       .text(metric.icon, xPos + 10, yPos + 8);
    
    // Label
    doc.fillColor('#6c757d')
       .font('Helvetica')
       .text(metric.label, xPos + 25, yPos + 6, { width: 150 });
    
    // Value
    doc.fillColor('#2c3e50')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(metric.value, xPos + 25, yPos + 16, { width: 200 });
  });

  currentY += 85;

  // ===== DETAILED BREAKDOWN SECTION =====
  doc.fontSize(11)
     .font('Helvetica-Bold')
     .fillColor('#2c3e50')
     .text('DETAILED BREAKDOWN BY ALLOWANCE TYPE', 50, currentY);
  
  currentY += 20;

  // Table headers with professional design
  const headers = [
    { label: 'S/N', key: 'sn', width: 35, align: 'center' },
    { label: 'Code', key: 'his_type', width: 55, align: 'center' },
    { label: 'Allowance Name', key: 'allowance_name', width: 150 },
    { label: 'Employees', key: 'employee_count', width: 60, align: 'center' },
    { label: 'Total Amount (₦)', key: 'total_amount', width: 90, align: 'right' },
    { label: 'Average (₦)', key: 'average_amount', width: 75, align: 'right' },
    { label: 'Range (₦)', key: 'range', width: 80, align: 'center' }
  ];

  // Enhanced table data with range information
  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    his_type: item.his_type,
    allowance_name: truncateText(item.allowance_name || 'Unknown', 30),
    employee_count: item.employee_count.toLocaleString(),
    total_amount: formatMoney(item.total_amount),
    average_amount: formatMoney(item.average_amount),
    range: `${formatMoney(item.min_amount)}-${formatMoney(item.max_amount)}`
  }));

  const endY = drawPDFTable(doc, headers, tableData, currentY);

  // ===== FOOTER SECTION WITH TOTALS =====
  const footerY = endY + 20;
  
  // Horizontal divider
  doc.moveTo(50, footerY)
     .lineTo(545, footerY)
     .strokeColor('#dee2e6')
     .lineWidth(1)
     .stroke();

  // Summary totals box
  doc.rect(350, footerY + 10, 195, 60)
     .fillAndStroke('#e8f4f8', '#3498db');
  
  doc.fontSize(9)
     .fillColor('#2c3e50')
     .font('Helvetica-Bold')
     .text('REPORT SUMMARY', 360, footerY + 18);

  const summaryLines = [
    `Allowance Categories: ${allowanceTypes}`,
    `Total Disbursed: ₦${formatMoney(totalAllowances)}`,
    `Average per Type: ₦${formatMoney(totalAllowances / allowanceTypes)}`
  ];

  doc.font('Helvetica').fontSize(8);
  summaryLines.forEach((line, idx) => {
    doc.text(line, 360, footerY + 33 + (idx * 10));
  });

  // Report metadata
  doc.fontSize(7)
     .fillColor('#95a5a6')
     .text(`Generated: ${new Date().toLocaleString()}`, 50, footerY + 50)
     .text(`Period: ${period}`, 50, footerY + 60);
}


// ============================================
// BANK REPORT PDF
// ============================================
async function generateBankPDF(doc, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno AS employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.bankcode,
      we.bankacnumber,
      ROUND(mc.his_netmth, 2) AS net_pay
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY we.bankcode, we.Surname
  `, [period.month]);

  addPDFHeader(doc, 'BANK PAYMENT SCHEDULE', period);

  const headers = [
    { label: 'S/N', key: 'sn', width: 30, align: 'center' },
    { label: 'Emp ID', key: 'employee_id', width: 55 },
    { label: 'Full Name', key: 'full_name', width: 160 },
    { label: 'Bank Code', key: 'bankcode', width: 70 },
    { label: 'Account No.', key: 'bankacnumber', width: 90 },
    { label: 'Net Pay (₦)', key: 'net_pay', width: 90, align: 'right' }
  ];

  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    employee_id: item.employee_id,
    full_name: item.full_name,
    bankcode: item.bankcode || 'N/A',
    bankacnumber: item.bankacnumber || 'N/A',
    net_pay: formatMoney(item.net_pay)
  }));

  const endY = drawPDFTable(doc, headers, tableData);

  const totalNet = data.reduce((sum, d) => sum + parseFloat(d.net_pay || 0), 0);
  addPDFTotals(doc, endY + 10, [
    `Total Records: ${data.length}`,
    `Total Net Pay: ₦${formatMoney(totalNet)}`
  ]);

  addSignatureSection(doc);
}

// ============================================
// DEDUCTIONS REPORT - PROFESSIONAL PDF FORMAT
// ============================================
async function generateDeductionsPDF(doc, period) {
  // Fetch deductions data
  const [data] = await pool.query(`
    SELECT 
      mp.his_type,
      et.elmDesc as deduction_name,
      COUNT(DISTINCT mp.his_empno) as employee_count,
      ROUND(SUM(mp.amtthismth), 2) as total_amount,
      ROUND(AVG(mp.amtthismth), 2) as average_amount,
      ROUND(MIN(mp.amtthismth), 2) as min_amount,
      ROUND(MAX(mp.amtthismth), 2) as max_amount
    FROM py_masterpayded mp
    INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
    WHERE LEFT(mp.his_type, 2) = 'DT' AND mp.amtthismth > 0
    GROUP BY mp.his_type, et.elmDesc
    ORDER BY total_amount DESC
  `);

  const totalDeductions = data.reduce((sum, d) => sum + parseFloat(d.total_amount || 0), 0);
  const totalEmployees = data.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0);
  const deductionTypes = data.length;

  // Page setup
  const margin = 35;
  const pageWidth = 595.28;
  const usableWidth = pageWidth - (margin * 2);
  let y = 40;

  // ===== HEADER =====
  doc.fontSize(11)
     .font('Helvetica-Bold')
     .fillColor('#000000')
     .text('NIGERIAN NAVY (NAVAL HEADQUARTERS)', margin, y);

  // Page number (top right)
  doc.fontSize(9)
     .font('Helvetica')
     .text(`Page 1`, pageWidth - margin - 50, y, { width: 50, align: 'right' });

  y += 35;

  // Report title and period on same line
  doc.fontSize(11)
     .font('Helvetica-Bold')
     .text('DEDUCTIONS SUMMARY REPORT', margin, y);

  doc.fontSize(9)
     .font('Helvetica')
     .text(`BETWEEN`, 280, y)
     .text(`AND`, 390, y)
     .text(`PRODUCED`, 460, y);

  y += 15;

  // Second line with values
  doc.fontSize(9)
     .font('Helvetica-Bold')
     .text('S/No', margin, y)
     .text('DESCRIPTION', 80, y);

  doc.font('Helvetica')
     .text(period, 280, y)
     .text(period, 390, y)
     .text(new Date().toLocaleDateString('en-GB'), 460, y);

  y += 25;

  // ===== TABLE HEADER =====
  const tableTop = y;
  const colWidths = {
    sno: 40,
    code: 60,
    description: 150,
    employees: 70,
    total: 100,
    average: 85,
    range: 90
  };

  // Draw header row background
  doc.rect(margin, y, usableWidth, 20)
     .fillAndStroke('#f0f0f0', '#000000')
     .lineWidth(0.5);

  // Header text
  doc.fontSize(9)
     .font('Helvetica-Bold')
     .fillColor('#000000');

  let xPos = margin + 5;
  doc.text('S/NO', xPos, y + 6, { width: colWidths.sno - 10, align: 'center' });
  xPos += colWidths.sno;
  
  doc.text('CODE', xPos, y + 6, { width: colWidths.code - 10, align: 'center' });
  xPos += colWidths.code;
  
  doc.text('DESCRIPTION', xPos, y + 6, { width: colWidths.description - 10 });
  xPos += colWidths.description;
  
  doc.text('EMPLOYEES', xPos, y + 6, { width: colWidths.employees - 10, align: 'center' });
  xPos += colWidths.employees;
  
  doc.text('TOTAL AMOUNT', xPos, y + 6, { width: colWidths.total - 10, align: 'right' });
  xPos += colWidths.total;
  
  doc.text('AVERAGE', xPos, y + 6, { width: colWidths.average - 10, align: 'right' });
  xPos += colWidths.average;
  
  doc.text('RANGE', xPos, y + 6, { width: colWidths.range - 10, align: 'right' });

  y += 20;

  // ===== TABLE ROWS =====
  doc.fontSize(8).font('Helvetica');

  data.forEach((item, idx) => {
    // Check for page break
    if (y > 720) {
      doc.addPage();
      y = 40;
    }

    // Draw row borders
    doc.rect(margin, y, usableWidth, 18)
       .stroke('#000000')
       .lineWidth(0.3);

    // Row data
    xPos = margin + 5;
    
    doc.text(String(idx + 1), xPos, y + 5, { width: colWidths.sno - 10, align: 'center' });
    xPos += colWidths.sno;
    
    doc.text(item.his_type || '', xPos, y + 5, { width: colWidths.code - 10 });
    xPos += colWidths.code;
    
    doc.text(truncate(item.deduction_name || 'Unknown', 35), xPos, y + 5, { width: colWidths.description - 10 });
    xPos += colWidths.description;
    
    doc.text(String(item.employee_count), xPos, y + 5, { width: colWidths.employees - 10, align: 'center' });
    xPos += colWidths.employees;
    
    doc.text(formatCurrency(item.total_amount), xPos, y + 5, { width: colWidths.total - 10, align: 'right' });
    xPos += colWidths.total;
    
    doc.text(formatCurrency(item.average_amount), xPos, y + 5, { width: colWidths.average - 10, align: 'right' });
    xPos += colWidths.average;
    
    const range = `${formatCurrency(item.min_amount)}-${formatCurrency(item.max_amount)}`;
    doc.text(range, xPos, y + 5, { width: colWidths.range - 10, align: 'right' });

    y += 18;
  });

  // ===== FOOTER SUMMARY =====
  y += 15;

  // Summary box
  const summaryBoxWidth = 200;
  const summaryBoxHeight = 60;
  const summaryX = pageWidth - margin - summaryBoxWidth;

  doc.rect(summaryX, y, summaryBoxWidth, summaryBoxHeight)
     .strokeColor('#000000')
     .lineWidth(1)
     .stroke();

  // Summary header
  doc.fontSize(9)
     .font('Helvetica-Bold')
     .fillColor('#000000')
     .text('SUMMARY', summaryX + 10, y + 8);

  y += 22;

  // Summary details
  doc.fontSize(8)
     .font('Helvetica')
     .text(`Total Deduction Types: ${deductionTypes}`, summaryX + 10, y);
  
  y += 12;
  doc.text(`Total Employees: ${totalEmployees}`, summaryX + 10, y);
  
  y += 12;
  doc.text(`Total Deducted: ${formatCurrency(totalDeductions)}`, summaryX + 10, y);

  // Footer metadata
  const footerY = 750;
  doc.fontSize(7)
     .font('Helvetica')
     .fillColor('#666666')
     .text(`Generated: ${new Date().toLocaleString('en-GB')}`, margin, footerY)
     .text(`Period: ${period}`, margin, footerY + 10);
}

// ============================================
// TAX REPORT PDF
// ============================================
async function generateTaxPDF(doc, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_taxabletodate, 2) as taxable_income,
      ROUND(mc.his_taxmth, 2) as tax_deducted
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    ORDER BY mc.his_taxmth DESC
  `, [period.month]);

  addPDFHeader(doc, 'PAYE TAX SCHEDULE', period);

  const headers = [
    { label: 'S/N', key: 'sn', width: 30, align: 'center' },
    { label: 'Emp ID', key: 'employee_id', width: 55 },
    { label: 'Full Name', key: 'full_name', width: 165 },
    { label: 'Gross Pay (₦)', key: 'gross_pay', width: 85, align: 'right' },
    { label: 'Taxable (₦)', key: 'taxable_income', width: 85, align: 'right' },
    { label: 'PAYE (₦)', key: 'tax_deducted', width: 75, align: 'right' }
  ];

  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    employee_id: item.employee_id,
    full_name: item.full_name,
    gross_pay: formatMoney(item.gross_pay),
    taxable_income: formatMoney(item.taxable_income),
    tax_deducted: formatMoney(item.tax_deducted)
  }));

  const endY = drawPDFTable(doc, headers, tableData);

  const totals = {
    gross: data.reduce((sum, d) => sum + parseFloat(d.gross_pay || 0), 0),
    taxable: data.reduce((sum, d) => sum + parseFloat(d.taxable_income || 0), 0),
    tax: data.reduce((sum, d) => sum + parseFloat(d.tax_deducted || 0), 0)
  };

  addPDFTotals(doc, endY + 10, [
    `Total Employees: ${data.length}`,
    `Total Gross: ₦${formatMoney(totals.gross)}`,
    `Total Taxable: ₦${formatMoney(totals.taxable)}`,
    `Total PAYE: ₦${formatMoney(totals.tax)}`
  ]);

  addSignatureSection(doc);
}

// ============================================
// DEPARTMENT REPORT PDF
// ============================================
async function generateDepartmentPDF(doc, period) {
  const [data] = await pool.query(`
    SELECT 
      we.Location as department,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_taxmth), 2) as total_tax,
      ROUND(SUM(mc.his_netmth), 2) as total_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.Location
    ORDER BY total_net DESC
  `, [period.month]);

  addPDFHeader(doc, 'DEPARTMENTAL PAYROLL SUMMARY', period);

  const grandTotal = data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0);

  const headers = [
    { label: 'S/N', key: 'sn', width: 30, align: 'center' },
    { label: 'Department/Location', key: 'department', width: 140 },
    { label: 'Staff', key: 'employee_count', width: 45, align: 'center' },
    { label: 'Gross (₦)', key: 'total_gross', width: 90, align: 'right' },
    { label: 'Tax (₦)', key: 'total_tax', width: 80, align: 'right' },
    { label: 'Net Pay (₦)', key: 'total_net', width: 90, align: 'right' },
    { label: '%', key: 'percentage', width: 40, align: 'center' }
  ];

  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    department: item.department || 'Unassigned',
    employee_count: item.employee_count,
    total_gross: formatMoney(item.total_gross),
    total_tax: formatMoney(item.total_tax),
    total_net: formatMoney(item.total_net),
    percentage: ((parseFloat(item.total_net) / grandTotal) * 100).toFixed(1) + '%'
  }));

  const endY = drawPDFTable(doc, headers, tableData);

  addPDFTotals(doc, endY + 10, [
    `Total Departments: ${data.length}`,
    `Total Employees: ${data.reduce((sum, d) => sum + parseInt(d.employee_count), 0)}`,
    `Grand Total Net Pay: ₦${formatMoney(grandTotal)}`
  ]);
}

// ============================================
// GRADE REPORT PDF
// ============================================
async function generateGradePDF(doc, period) {
  const [data] = await pool.query(`
    SELECT 
      we.gradelevel as grade,
      we.gradetype,
      COUNT(DISTINCT mc.his_empno) as employee_count,
      ROUND(SUM(mc.his_grossmth), 2) as total_gross,
      ROUND(SUM(mc.his_netmth), 2) as total_net,
      ROUND(AVG(mc.his_netmth), 2) as average_net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
    GROUP BY we.gradelevel, we.gradetype
    ORDER BY we.gradelevel
  `, [period.month]);

  addPDFHeader(doc, 'GRADE-WISE PAYROLL SUMMARY', period);

  const headers = [
    { label: 'S/N', key: 'sn', width: 30, align: 'center' },
    { label: 'Grade', key: 'grade', width: 60 },
    { label: 'Type', key: 'gradetype', width: 80 },
    { label: 'Staff', key: 'employee_count', width: 50, align: 'center' },
    { label: 'Gross (₦)', key: 'total_gross', width: 95, align: 'right' },
    { label: 'Net Pay (₦)', key: 'total_net', width: 95, align: 'right' },
    { label: 'Avg Net (₦)', key: 'average_net', width: 85, align: 'right' }
  ];

  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    grade: item.grade || 'N/A',
    gradetype: item.gradetype || 'N/A',
    employee_count: item.employee_count,
    total_gross: formatMoney(item.total_gross),
    total_net: formatMoney(item.total_net),
    average_net: formatMoney(item.average_net)
  }));

  const endY = drawPDFTable(doc, headers, tableData);

  const grandTotal = data.reduce((sum, d) => sum + parseFloat(d.total_net || 0), 0);
  addPDFTotals(doc, endY + 10, [
    `Total Grade Levels: ${data.length}`,
    `Total Employees: ${data.reduce((sum, d) => sum + parseInt(d.employee_count), 0)}`,
    `Grand Total Net Pay: ₦${formatMoney(grandTotal)}`
  ]);
}

// ============================================
// EXCEPTIONS REPORT PDF
// ============================================
async function generateExceptionsPDF(doc, period) {
  const [data] = await pool.query(`
    SELECT 
      mc.his_empno as employee_id,
      CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
      we.gradelevel,
      ROUND(mc.his_grossmth, 2) as gross_pay,
      ROUND(mc.his_netmth, 2) as net_pay,
      CASE
        WHEN mc.his_netmth <= 0 THEN 'Zero/Negative Pay'
        WHEN mc.his_grossmth <= 0 THEN 'Zero Gross'
        WHEN mc.his_netmth > mc.his_grossmth THEN 'Net > Gross'
        WHEN mc.his_taxmth < 0 THEN 'Negative Tax'
        ELSE 'Other'
      END as exception_type
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ?
      AND (mc.his_netmth <= 0 OR mc.his_grossmth <= 0 OR mc.his_netmth > mc.his_grossmth OR mc.his_taxmth < 0)
    ORDER BY exception_type, full_name
  `, [period.month]);

  addPDFHeader(doc, 'PAYROLL EXCEPTIONS REPORT', period);

  if (data.length === 0) {
    doc.fontSize(12).fillColor('#70AD47').text('No exceptions found for this period.', { align: 'center' });
    return;
  }

  const headers = [
    { label: 'S/N', key: 'sn', width: 30, align: 'center' },
    { label: 'Emp ID', key: 'employee_id', width: 55 },
    { label: 'Full Name', key: 'full_name', width: 150 },
    { label: 'Grade', key: 'gradelevel', width: 50, align: 'center' },
    { label: 'Gross (₦)', key: 'gross_pay', width: 80, align: 'right' },
    { label: 'Net (₦)', key: 'net_pay', width: 80, align: 'right' },
    { label: 'Exception', key: 'exception_type', width: 80 }
  ];

  const tableData = data.map((item, idx) => ({
    sn: idx + 1,
    employee_id: item.employee_id,
    full_name: item.full_name,
    gradelevel: item.gradelevel || 'N/A',
    gross_pay: formatMoney(item.gross_pay),
    net_pay: formatMoney(item.net_pay),
    exception_type: item.exception_type
  }));

  const endY = drawPDFTable(doc, headers, tableData);

  // Exception summary
  const exceptionCounts = data.reduce((acc, d) => {
    acc[d.exception_type] = (acc[d.exception_type] || 0) + 1;
    return acc;
  }, {});

  doc.moveDown();
  doc.fontSize(10).fillColor('#1F4E79').font('Helvetica-Bold').text('Exception Summary:', 50, endY + 15);
  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  
  let summaryY = endY + 30;
  Object.entries(exceptionCounts).forEach(([type, count]) => {
    doc.text(`• ${type}: ${count} employee(s)`, 60, summaryY);
    summaryY += 12;
  });
}

// ============================================
// SUMMARY REPORT PDF
// ============================================
async function generateSummaryPDF(doc, period) {
  const [[summary]] = await pool.query(`
    SELECT 
      COUNT(DISTINCT his_empno) AS total_employees,
      ROUND(SUM(his_grossmth), 2) AS total_gross,
      ROUND(SUM(his_taxmth), 2) AS total_tax,
      ROUND(COALESCE(SUM(his_netmth), 0), 2) AS total_net,
      ROUND(AVG(his_netmth), 2) AS average_net_pay
    FROM py_mastercum WHERE his_type = ?
  `, [period.month]);

  const [[payded]] = await pool.query(`
    SELECT 
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 2) AS total_deductions,
      ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) AS total_allowances
    FROM py_masterpayded
  `);

  const [deptData] = await pool.query(`
    SELECT we.Location as department, COUNT(DISTINCT mc.his_empno) as count, ROUND(SUM(mc.his_netmth), 2) as net
    FROM py_mastercum mc
    INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
    WHERE mc.his_type = ? GROUP BY we.Location ORDER BY net DESC LIMIT 5
  `, [period.month]);

  addPDFHeader(doc, 'PAYROLL SUMMARY REPORT', period);

  // Summary Cards
  const cardData = [
    { label: 'Total Employees', value: summary.total_employees, color: '#4472C4' },
    { label: 'Total Gross Pay', value: `₦${formatMoney(summary.total_gross)}`, color: '#70AD47' },
    { label: 'Total Deductions', value: `₦${formatMoney(payded.total_deductions)}`, color: '#FFC000' },
    { label: 'Total Net Pay', value: `₦${formatMoney(summary.total_net)}`, color: '#1F4E79' }
  ];

  let cardX = 50;
  const cardY = doc.y + 10;
  const cardWidth = 120;
  const cardHeight = 50;

  cardData.forEach((card) => {
    doc.fillColor(card.color).roundedRect(cardX, cardY, cardWidth, cardHeight, 5).fill();
    doc.fillColor('#FFFFFF').fontSize(8).text(card.label, cardX + 8, cardY + 8, { width: cardWidth - 16 });
    doc.fontSize(11).font('Helvetica-Bold').text(String(card.value), cardX + 8, cardY + 25, { width: cardWidth - 16 });
    doc.font('Helvetica');
    cardX += cardWidth + 10;
  });

  doc.y = cardY + cardHeight + 25;

  // Additional metrics
  doc.fillColor('#000000').fontSize(10);
  doc.text(`Total Allowances: ₦${formatMoney(payded.total_allowances)}`, 50);
  doc.text(`Total Tax (PAYE): ₦${formatMoney(summary.total_tax)}`, 50);
  doc.text(`Average Net Pay: ₦${formatMoney(summary.average_net_pay)}`, 50);

  // Top departments
  if (deptData.length > 0) {
    doc.moveDown();
    doc.fontSize(11).fillColor('#1F4E79').font('Helvetica-Bold').text('Top 5 Departments by Net Pay:', 50);
    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    
    deptData.forEach((dept, idx) => {
      doc.text(`${idx + 1}. ${dept.department || 'Unassigned'}: ${dept.count} staff, ₦${formatMoney(dept.net)}`, 60);
    });
  }

  // Footer
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#666666');
  doc.text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });

  addSignatureSection(doc);
}


// Helper function to check if calculations are complete
async function checkCalculationsComplete() {
  const [bt05] = await pool.query("SELECT sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
  if (!bt05.length || bt05[0].sun < 999) {
    throw new Error('Payroll calculations must be completed first');
  }
  return bt05[0];
}

// Get current period info
async function getCurrentPeriod() {
  const [period] = await pool.query("SELECT ord as year, mth as month FROM py_stdrate WHERE type='BT05' LIMIT 1");
  return period[0] || {};
}

// 3. Payroll Summary Report
exports.getPayrollSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
          mc_totals.total_employees,
          mc_totals.total_gross,
          mc_totals.total_tax,
          mc_totals.total_net,
          mp_totals.total_deductions,
          mp_totals.total_allowances,
          mc_totals.average_net_pay
      FROM (
          SELECT 
              COUNT(DISTINCT his_empno) AS total_employees,
              ROUND(SUM(his_grossmth), 2) AS total_gross,
              ROUND(SUM(his_taxmth), 2) AS total_tax,
              ROUND(COALESCE(SUM(his_netmth), 0), 2) AS total_net,
              ROUND(AVG(his_netmth), 2) AS average_net_pay
          FROM py_mastercum
          WHERE his_type = ?
      ) mc_totals
      CROSS JOIN (
          SELECT 
              ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 2) AS total_deductions,
              ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) AS total_allowances
          FROM py_masterpayded
      ) mp_totals
    `;

    const [summary] = await pool.query(query, [period.month, period.month]);

    res.json({
      success: true,
      data: {
        period: { month: period.month },
        summary: summary[0]
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Payment by Bank Report
exports.getBankReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
          mc.his_empno AS employee_id,
          CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
          we.bankcode,
          we.bankbranch,
          we.bankacnumber,
          ROUND(mc.his_netmth, 2) AS net_pay,
          ROUND(mc.his_grossmth, 2) AS gross_pay
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we 
          ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      ORDER BY we.bankcode, full_name;
    `;

    const [bankData] = await pool.query(query, [period.month]);

    // Group by bank
    const byBank = {};
    let grandTotal = 0;

    bankData.forEach(row => {
      const bank = row.bankcode || 'UNASSIGNED';
      if (!byBank[bank]) {
        byBank[bank] = { employees: [], total: 0, count: 0 };
      }
      byBank[bank].employees.push(row);
      byBank[bank].total += parseFloat(row.net_pay);
      byBank[bank].count++;
      grandTotal += parseFloat(row.net_pay);
    });

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        byBank,
        grandTotal,
        totalEmployees: bankData.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Deductions Summary
exports.getDeductionsSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mp.his_type,
        et.elmDesc as deduction_name,
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount,
        ROUND(AVG(mp.amtthismth), 2) as average_amount,
        ROUND(MIN(mp.amtthismth), 2) as min_amount,
        ROUND(MAX(mp.amtthismth), 2) as max_amount
      FROM py_masterpayded mp
      INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
      WHERE LEFT(mp.his_type, 2) = 'PR'
        AND mp.amtthismth > 0
      GROUP BY mp.his_type, et.elmDesc
      ORDER BY total_amount DESC
    `;

    const [deductions] = await pool.query(query);

    const totalDeductions = deductions.reduce((sum, d) => sum + parseFloat(d.total_amount), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        deductions,
        totalDeductions,
        deductionCount: deductions.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 6. Tax Report (PAYE)
exports.getTaxReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mc.his_empno as employee_id,
        CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
        we.gradelevel,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND(mc.his_taxfreepaytodate, 2) as tax_free_pay,
        ROUND(mc.his_taxabletodate, 2) as taxable_income,
        ROUND(mc.his_taxmth, 2) as tax_deducted,
        ROUND(mc.his_taxtodate, 2) as cumulative_tax
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      ORDER BY mc.his_taxmth DESC
    `;

    const [taxData] = await pool.query(query, [period.month]);

    const summary = {
      totalEmployees: taxData.length,
      totalTaxCollected: taxData.reduce((sum, t) => sum + parseFloat(t.tax_deducted), 0),
      totalTaxableIncome: taxData.reduce((sum, t) => sum + parseFloat(t.taxable_income), 0),
      totalGrossPay: taxData.reduce((sum, t) => sum + parseFloat(t.gross_pay), 0),
      employeesWithTax: taxData.filter(t => parseFloat(t.tax_deducted) > 0).length
    };

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        taxData,
        summary
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 7. Department-wise Summary
exports.getDepartmentSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        we.Location as department,
        COUNT(DISTINCT mc.his_empno) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        ROUND(AVG(mc.his_netmth), 2) as average_net
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      GROUP BY we.Location
      ORDER BY total_net DESC
    `;

    const [departments] = await pool.query(query, [period.month]);

    const grandTotal = departments.reduce((sum, d) => sum + parseFloat(d.total_net), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        departments,
        grandTotal,
        departmentCount: departments.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 8. Grade-wise Summary
exports.getGradeSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        we.gradelevel as grade,
        we.gradetype,
        COUNT(DISTINCT mc.his_empno) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        ROUND(AVG(mc.his_netmth), 2) as average_net
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
      GROUP BY we.gradelevel, we.gradetype
      ORDER BY we.gradelevel
    `;

    const [grades] = await pool.query(query, [period.month]);

    const grandTotal = grades.reduce((sum, g) => sum + parseFloat(g.total_net), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        grades,
        grandTotal,
        gradeCount: grades.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 9. Exception Report
exports.getExceptionReport = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mc.his_empno as employee_id,
        CONCAT(we.Surname, ' ', IFNULL(we.OtherName, '')) AS full_name,
        we.gradelevel,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND(mc.his_netmth, 2) as net_pay,
        CASE
          WHEN mc.his_netmth <= 0 THEN 'Zero or Negative Pay'
          WHEN mc.his_grossmth <= 0 THEN 'Zero Gross Pay'
          WHEN mc.his_netmth > mc.his_grossmth THEN 'Net Exceeds Gross'
          WHEN mc.his_taxmth < 0 THEN 'Negative Tax'
          ELSE 'Other Exception'
        END as exception_type
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type = ?
        AND (
          mc.his_netmth <= 0 OR
          mc.his_grossmth <= 0 OR
          mc.his_netmth > mc.his_grossmth OR
          mc.his_taxmth < 0
        )
      ORDER BY exception_type, full_name
    `;

    const [exceptions] = await pool.query(query, [period.month]);

    const byType = {};
    exceptions.forEach(ex => {
      if (!byType[ex.exception_type]) {
        byType[ex.exception_type] = [];
      }
      byType[ex.exception_type].push(ex);
    });

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        exceptions,
        byType,
        totalExceptions: exceptions.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
//10.  ALLOWANCES REPORT - DATA ENDPOINT
// ============================================
exports.getAllowancesSummary = async (req, res) => {
  try {
    await checkCalculationsComplete();
    const period = await getCurrentPeriod();

    const query = `
      SELECT 
        mp.his_type,
        et.elmDesc as allowance_name,
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount,
        ROUND(AVG(mp.amtthismth), 2) as average_amount,
        ROUND(MIN(mp.amtthismth), 2) as min_amount,
        ROUND(MAX(mp.amtthismth), 2) as max_amount
      FROM py_masterpayded mp
      INNER JOIN py_elementtype et ON et.PaymentType = mp.his_type
      WHERE LEFT(mp.his_type, 2) = 'PT'
        AND mp.amtthismth > 0
      GROUP BY mp.his_type, et.elmDesc
      ORDER BY total_amount DESC
    `;

    const [allowances] = await pool.query(query);

    const totalAllowances = allowances.reduce((sum, a) => sum + parseFloat(a.total_amount), 0);

    res.json({
      success: true,
      data: {
        period: { year: period.year, month: period.month },
        allowances,
        totalAllowances,
        allowanceCount: allowances.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Helper functions
function getColumnsForReport(reportType) {
  const columns = {
    bank: [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Bank Code', key: 'bankcode', width: 15 },
      { header: 'Account Number', key: 'bankacnumber', width: 20 },
      { header: 'Net Pay', key: 'net_pay', width: 15 }
    ],
    // ... other report columns
  };
  return columns[reportType] || [];
}


module.exports = exports;