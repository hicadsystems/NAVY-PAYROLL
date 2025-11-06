const pool = require('../../config/db');
const personnelDetailsService = require('../../services/file-update/personnelData');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * GET: Get available periods for filtering
 */
exports.getAvailablePeriods = async (req, res) => {
  try {
    const periods = await personnelDetailsService.getAvailablePeriods();
    
    res.json({
      status: 'SUCCESS',
      periods
    });
  } catch (err) {
    console.error('Error getting available periods:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Get list of all employees for selection
 */
exports.getEmployeesList = async (req, res) => {
  try {
    const employees = await personnelDetailsService.getEmployeesList();
    
    res.json({
      status: 'SUCCESS',
      totalEmployees: employees.length,
      employees
    });
  } catch (err) {
    console.error('Error getting employees list:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Previous personnel details from py_emplhistory
 */
exports.getPreviousPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 50
    } = req.query;

    // Validate required filters
    if (!startPeriod && !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'At least one period (startPeriod or endPeriod) is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.getPreviousPersonnelDetails(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'PREVIOUS_DETAILS',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting previous personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Current personnel details from hr_employees
 */
exports.getCurrentPersonnelDetails = async (req, res) => {
  try {
    const { 
      employeeId,
      page = 1,
      limit = 50
    } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.getCurrentPersonnelDetails(
      year, 
      month, 
      user, 
      {
        employeeId,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'CURRENT_DETAILS',
      filters: { employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting current personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Comparison between previous and current details
 */
exports.getPersonnelDetailsComparison = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 20
    } = req.query;

    // Validate required filters
    if (!startPeriod && !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'At least one period (startPeriod or endPeriod) is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.getPersonnelDetailsComparison(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'COMPARISON',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting personnel details comparison:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Export previous personnel details to Excel
 */
exports.exportPreviousDetailsExcel = async (req, res) => {
  try {
    const { startPeriod, endPeriod, employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllPreviousDetailsForExport({
      startPeriod,
      endPeriod,
      employeeId
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Previous Personnel Details');

    // Add header
    worksheet.addRow(['PREVIOUS PERSONNEL DETAILS REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([`Filters: Period ${startPeriod || 'N/A'} to ${endPeriod || 'N/A'}${employeeId && employeeId !== 'ALL' ? `, Employee: ${employeeId}` : ', All Employees'}`]);
    worksheet.addRow([]);

    // Define all columns from py_emplhistory
    const columns = [
      { header: 'Period', key: 'period', width: 15 },
      { header: 'Employee ID', key: 'Empl_ID', width: 15 },
      { header: 'Surname', key: 'Surname', width: 20 },
      { header: 'Other Name', key: 'OtherName', width: 25 },
      { header: 'Title', key: 'Title', width: 10 },
      { header: 'Sex', key: 'Sex', width: 8 },
      { header: 'Job Title', key: 'Jobtitle', width: 30 },
      { header: 'Marital Status', key: 'MaritalStatus', width: 15 },
      { header: 'Factory', key: 'Factory', width: 12 },
      { header: 'Location', key: 'Location', width: 15 },
      { header: 'Birth Date', key: 'Birthdate', width: 15 },
      { header: 'Date Employed', key: 'DateEmpl', width: 15 },
      { header: 'Date Left', key: 'DateLeft', width: 15 },
      { header: 'Telephone', key: 'TELEPHONE', width: 15 },
      { header: 'Home Address', key: 'HOMEADDR', width: 40 },
      { header: 'NOK Name', key: 'nok_name', width: 30 },
      { header: 'Bank Code', key: 'Bankcode', width: 12 },
      { header: 'Bank Branch', key: 'bankbranch', width: 15 },
      { header: 'Bank Account', key: 'BankACNumber', width: 20 },
      { header: 'State of Origin', key: 'StateofOrigin', width: 15 },
      { header: 'Local Govt', key: 'LocalGovt', width: 15 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Grade Level', key: 'gradelevel', width: 12 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'PFA Code', key: 'pfacode', width: 15 },
      { header: 'Command', key: 'command', width: 15 },
      { header: 'Specialisation', key: 'specialisation', width: 20 }
    ];

    worksheet.columns = columns;

    // Style header row
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data rows
    records.forEach(record => {
      worksheet.addRow(record);
    });

    // Generate filename
    const filename = `previous_personnel_details_${year}_${month}${startPeriod ? '_' + startPeriod : ''}${endPeriod ? '_to_' + endPeriod : ''}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export current personnel details to Excel
 */
exports.exportCurrentDetailsExcel = async (req, res) => {
  try {
    const { employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllCurrentDetailsForExport({
      employeeId
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Current Personnel Details');

    // Add header
    worksheet.addRow(['CURRENT PERSONNEL DETAILS REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([`Filters: ${employeeId && employeeId !== 'ALL' ? `Employee: ${employeeId}` : 'All Employees'}`]);
    worksheet.addRow([]);

    // Define all columns from hr_employees (extended with additional fields)
    const columns = [
      { header: 'Employee ID', key: 'Empl_ID', width: 15 },
      { header: 'Surname', key: 'Surname', width: 20 },
      { header: 'Other Name', key: 'OtherName', width: 25 },
      { header: 'Title', key: 'Title', width: 10 },
      { header: 'Sex', key: 'Sex', width: 8 },
      { header: 'Job Title', key: 'Jobtitle', width: 30 },
      { header: 'Marital Status', key: 'MaritalStatus', width: 15 },
      { header: 'Factory', key: 'Factory', width: 12 },
      { header: 'Location', key: 'Location', width: 15 },
      { header: 'Birth Date', key: 'Birthdate', width: 15 },
      { header: 'Date Employed', key: 'DateEmpl', width: 15 },
      { header: 'Date Left', key: 'DateLeft', width: 15 },
      { header: 'Telephone', key: 'TELEPHONE', width: 15 },
      { header: 'Home Address', key: 'HOMEADDR', width: 40 },
      { header: 'NOK Name', key: 'nok_name', width: 30 },
      { header: 'Bank Code', key: 'Bankcode', width: 12 },
      { header: 'Bank Branch', key: 'bankbranch', width: 15 },
      { header: 'Bank Account', key: 'BankACNumber', width: 20 },
      { header: 'State of Origin', key: 'StateofOrigin', width: 15 },
      { header: 'Local Govt', key: 'LocalGovt', width: 15 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Grade Level', key: 'gradelevel', width: 12 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'GSM Number', key: 'gsm_number', width: 15 },
      { header: 'NOK Phone', key: 'nokphone', width: 15 },
      { header: 'Religion', key: 'religion', width: 15 },
      { header: 'PFA Code', key: 'pfacode', width: 15 },
      { header: 'Command', key: 'command', width: 15 },
      { header: 'Specialisation', key: 'specialisation', width: 20 }
    ];

    worksheet.columns = columns;

    // Style header row
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data rows
    records.forEach(record => {
      worksheet.addRow(record);
    });

    // Generate filename
    const filename = `current_personnel_details_${year}_${month}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export previous personnel details to PDF
 */
exports.exportPreviousDetailsPDF = async (req, res) => {
  try {
    const { startPeriod, endPeriod, employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllPreviousDetailsForExport({
      startPeriod,
      endPeriod,
      employeeId
    });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    const filename = `previous_personnel_details_${year}_${month}${startPeriod ? '_' + startPeriod : ''}${endPeriod ? '_to_' + endPeriod : ''}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('PREVIOUS PERSONNEL DETAILS REPORT', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.text(`Period Range: ${startPeriod || 'N/A'} to ${endPeriod || 'N/A'}`, { align: 'center' });
    doc.moveDown(2);

    // Summary
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(10).font('Helvetica').text(`Total Records: ${records.length}`);
    doc.moveDown(1);

    // Records list
    doc.fontSize(12).font('Helvetica-Bold').text('Personnel Details');
    doc.moveDown(0.5);

    records.forEach((record, index) => {
      if (doc.y > 700) {
        doc.addPage();
      }

      doc.fontSize(10).font('Helvetica-Bold')
        .text(`${index + 1}. ${record.Surname} ${record.OtherName || ''} (${record.Empl_ID})`, { underline: true });
      
      doc.fontSize(9).font('Helvetica')
        .text(`   Period: ${record.period}`)
        .text(`   Location: ${record.Location || 'N/A'} | Factory: ${record.Factory || 'N/A'}`)
        .text(`   Job Title: ${record.Jobtitle || 'N/A'}`)
        .text(`   Grade Level: ${record.gradelevel || 'N/A'} | Status: ${record.Status || 'N/A'}`)
        .text(`   Bank: ${record.Bankcode || 'N/A'} | Account: ${record.BankACNumber || 'N/A'}`)
        .text(`   Email: ${record.email || 'N/A'} | Date Employed: ${record.DateEmpl || 'N/A'}`);
      
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export current personnel details to PDF
 */
exports.exportCurrentDetailsPDF = async (req, res) => {
  try {
    const { employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllCurrentDetailsForExport({
      employeeId
    });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    const filename = `current_personnel_details_${year}_${month}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('CURRENT PERSONNEL DETAILS REPORT', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Summary
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(10).font('Helvetica').text(`Total Records: ${records.length}`);
    doc.moveDown(1);

    // Records list
    doc.fontSize(12).font('Helvetica-Bold').text('Personnel Details');
    doc.moveDown(0.5);

    records.forEach((record, index) => {
      if (doc.y > 700) {
        doc.addPage();
      }

      doc.fontSize(10).font('Helvetica-Bold')
        .text(`${index + 1}. ${record.Surname} ${record.OtherName || ''} (${record.Empl_ID})`, { underline: true });
      
      doc.fontSize(9).font('Helvetica')
        .text(`   Location: ${record.Location || 'N/A'} | Factory: ${record.Factory || 'N/A'}`)
        .text(`   Job Title: ${record.Jobtitle || 'N/A'}`)
        .text(`   Grade Level: ${record.gradelevel || 'N/A'} | Status: ${record.Status || 'N/A'}`)
        .text(`   Bank: ${record.Bankcode || 'N/A'} | Account: ${record.BankACNumber || 'N/A'}`)
        .text(`   Email: ${record.email || 'N/A'} | GSM: ${record.gsm_number || 'N/A'}`)
        .text(`   Date Employed: ${record.DateEmpl || 'N/A'} | Date Left: ${record.DateLeft || 'N/A'}`);
      
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};