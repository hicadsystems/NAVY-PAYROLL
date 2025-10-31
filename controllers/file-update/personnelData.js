const pool = require('../../config/db');
const personnelData = require('../../services/file-update/personnelData');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');


exports.personnelChanges = async (req, res) => {
  try {
    // Get BT05 processing period
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month, sun } = bt05Rows[0];
    
    // Validation: Ensure previous stage completed
    if (sun < 666) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Save payroll files first.',
        currentStage: sun,
        requiredStage: 666
      });
    }
    
    // Validation: Prevent re-processing
    if (sun > 666) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Personnel changes already processed.',
        currentStage: sun
      });
    }

    const user = req.user_fullname || 'System Auto';
    
    // Call the updated service (now returns summary + records)
    const result = await personnelData.getPersonnelChanges(year, month, user);

    // Update BT05 stage marker
    await pool.query(
      "UPDATE py_stdrate SET sun = 775, createdby = ? WHERE type = 'BT05'", 
      [user]
    );

    res.json({
      status: 'SUCCESS',
      stage: 888,
      progress: 'Personnel changes processed',
      nextStage: 'Input Variable Comparison',
      processedAt: new Date().toISOString(),
      summary: result.summary,  // Rich summary stats
      changes: result.records,  // Detailed records
      // Legacy compatibility
      result: {
        totalChanges: result.summary.totalChanges,
        records: result.records
      }
    });
  } catch (err) {
    console.error('Error getting personnel changes:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// Get high-risk personnel changes only (bank/account changes)
exports.getHighRiskPersonnelChanges = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getHighRiskPersonnelChanges(year, month, user);

    res.json({
      status: 'SUCCESS',
      riskLevel: 'HIGH',
      totalChanges: result.totalChanges,
      changes: result.records
    });
  } catch (err) {
    console.error('Error getting high-risk personnel changes:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// Get terminated employees
exports.getTerminatedEmployees = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getPersonnelChangesByCategory('TERMINATED', year, month, user);

    res.json({
      status: 'SUCCESS',
      category: 'TERMINATED',
      totalChanges: result.totalChanges,
      changes: result.records
    });
  } catch (err) {
    console.error('Error getting terminated employees:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// Get new employees
exports.getNewEmployees = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getPersonnelChangesByCategory('NEW_EMPLOYEE', year, month, user);

    res.json({
      status: 'SUCCESS',
      category: 'NEW_EMPLOYEE',
      totalChanges: result.totalChanges,
      changes: result.records
    });
  } catch (err) {
    console.error('Error getting new employees:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

//View 
exports.getPersonnelChangesView = async (req, res) => {
try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ status: 'FAILED', error: 'BT05 not found' });
    }

    const { year, month, sun } = bt05Rows[0];

    // THE KEY CHANGE: Only fail if the process hasn't started (sun < 775)
    if (sun < 775) { 
      // 666 means it's processed, but 775 is the 'changes ready' status.
      return res.status(400).json({ 
      status: 'FAILED',
      error: 'Personnel changes are not ready for viewing (must be stage 775 or higher).',
      currentStage: sun
      });
    }

    // Retrieve the data—since the data was processed and saved at stage 666, 
    // we only need to read the saved results here.
    const user = req.user_fullname || 'System Auto';
    const result = await personnelData.getPersonnelChanges(year, month, user, true); // Use a flag for 'view mode' if necessary

    res.json({
      status: 'SUCCESS',
      stage: sun, // Return the actual current stage
      progress: 'Personnel changes retrieved for viewing',
      processedAt: new Date().toISOString(),
      summary: result.summary,
      changes: result.records,
    });
  } catch (err) {
    console.error('Error fetching personnel changes for view:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
}
};

exports.exportPersonnelChangesExcel = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get data from view
    const [rows] = await pool.query(`
      SELECT 
        Empl_ID,
        full_name,
        Location,
        Factory,
        current_values,
        previous_values,
        change_summary,
        change_category,
        risk_level,
        detected_at
      FROM vw_personnel_changes
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name
    `);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personnel Changes');

    // Add header
    worksheet.addRow(['PERSONNEL CHANGES REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([]);

    // Column headers
    worksheet.columns = [
      { header: 'Employee ID', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Location', key: 'location', width: 15 },
      { header: 'Factory', key: 'factory', width: 15 },
      { header: 'Change Summary', key: 'change_summary', width: 40 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Risk Level', key: 'risk', width: 12 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(5);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data rows
    rows.forEach(row => {
      const newRow = worksheet.addRow({
        empl_id: row.Empl_ID,
        full_name: row.full_name,
        location: row.Location,
        factory: row.Factory,
        change_summary: row.change_summary,
        category: row.change_category,
        risk: row.risk_level
      });

      // Color code by risk level
      if (row.risk_level === 'HIGH') {
        newRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' }
        };
      } else if (row.risk_level === 'MEDIUM') {
        newRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF00' }
        };
      }
    });

    // Add detailed changes sheet
    const detailsSheet = workbook.addWorksheet('Detailed Changes');
    detailsSheet.columns = [
      { header: 'Employee ID', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Field', key: 'field', width: 20 },
      { header: 'Previous Value', key: 'prev', width: 25 },
      { header: 'Current Value', key: 'curr', width: 25 },
    ];

    detailsSheet.getRow(1).font = { bold: true };
    detailsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    rows.forEach(row => {
      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      Object.keys(current).forEach(key => {
        if (current[key] !== previous[key]) {
          detailsSheet.addRow({
            empl_id: row.Empl_ID,
            full_name: row.full_name,
            field: key,
            prev: previous[key] || 'N/A',
            curr: current[key] || 'N/A'
          });
        }
      });
    });

    // Generate file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=personnel_changes_${year}_${month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.exportPersonnelChangesPDF = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get data from view
    const [rows] = await pool.query(`
      SELECT * FROM vw_personnel_changes
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name
    `);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=personnel_changes_${year}_${month}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('PERSONNEL CHANGES REPORT', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Summary section
    const highRisk = rows.filter(r => r.risk_level === 'HIGH').length;
    const mediumRisk = rows.filter(r => r.risk_level === 'MEDIUM').length;
    const lowRisk = rows.filter(r => r.risk_level === 'LOW').length;

    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(10).font('Helvetica')
      .text(`Total Changes: ${rows.length}`)
      .text(`High Risk: ${highRisk}`, { continued: true }).fillColor('red').text(` ⚠️`).fillColor('black')
      .text(`Medium Risk: ${mediumRisk}`)
      .text(`Low Risk: ${lowRisk}`);
    doc.moveDown(2);

    // Table header
    doc.fontSize(12).font('Helvetica-Bold').text('Changes List');
    doc.moveDown(0.5);

    // Table rows
    rows.forEach((row, index) => {
      if (doc.y > 700) {
        doc.addPage();
      }

      const riskColor = row.risk_level === 'HIGH' ? 'red' : 
                        row.risk_level === 'MEDIUM' ? 'orange' : 'green';

      doc.fontSize(10).font('Helvetica-Bold')
        .text(`${index + 1}. ${row.full_name} (${row.Empl_ID})`, { continued: true })
        .fillColor(riskColor).text(` [${row.risk_level}]`).fillColor('black');
      
      doc.fontSize(9).font('Helvetica')
        .text(`   Location: ${row.Location || 'N/A'}`)
        .text(`   Changes: ${row.change_summary}`)
        .text(`   Category: ${row.change_category}`);
      
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};
