const pool = require('../../config/db');
const inputVariable = require('../../services/file-update/inputVariable');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');


// POST - Process input variables (first time only, updates stage 775 -> 777)
exports.inputVariableChanges = async (req, res) => {
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
    
    // Validation: Ensure previous stage completed (personnel changes must be ready)
    if (sun < 775) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Personnel changes must be processed first.',
        currentStage: sun,
        requiredStage: 775
      });
    }
    
    // Validation: Prevent re-processing (already processed)
    if (sun > 775) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variable report already processed. Use /view endpoint to retrieve data.',
        currentStage: sun
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    // Call the service to process and save input variable changes
    const result = await inputVariable.getInputVariableChanges(year, month, user);

    // Update BT05 stage marker to 777 (input variables ready)
    await pool.query(
      "UPDATE py_stdrate SET sun = 777, createdby = ? WHERE type = 'BT05'", 
      [user]
    );

    res.json({
      status: 'SUCCESS',
      stage: 777,
      progress: 'Input variable changes processed',
      nextStage: 'Master File Update',
      processedAt: new Date().toISOString(),
      summary: result.summary,
      changes: result.records,
      // Legacy compatibility
      result: {
        totalChanges: result.summary.totalChanges,
        records: result.records
      }
    });
  } catch (err) {
    console.error('Error in input variable comparison:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// GET - View already processed input variables (stage must be >= 777)
exports.getInputVariableChangesView = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED', 
        error: 'BT05 not found' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    // KEY CHANGE: Only fail if the process hasn't reached stage 777
    if (sun < 777) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variables are not ready for viewing (must be stage 777 or higher).',
        currentStage: sun,
        requiredStage: 777
      });
    }

    // Retrieve the data - since data was processed and saved at stage 777,
    // we only need to read the saved results here
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    const result = await inputVariable.getInputVariableChanges(year, month, user, true); // Flag for 'view mode'

    res.json({
      status: 'SUCCESS',
      stage: sun, // Return the actual current stage
      progress: 'Input variable changes retrieved for viewing',
      processedAt: new Date().toISOString(),
      summary: result.summary,
      changes: result.records,
    });
  } catch (err) {
    console.error('Error fetching input variables for view:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

// GET - High-risk input variable changes only
exports.getHighRiskInputChanges = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    // Must be at stage 777 or higher
    if (sun < 777) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variables must be processed first.',
        currentStage: sun,
        requiredStage: 777
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await inputVariable.getInputVariableChangesByRisk('HIGH', year, month, user);

    res.json({
      status: 'SUCCESS',
      riskLevel: 'HIGH',
      totalChanges: result.totalChanges,
      changes: result.records
    });
  } catch (err) {
    console.error('Error getting high-risk input changes:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

// GET - Loan changes only
exports.getLoanChanges = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    // Must be at stage 777 or higher
    if (sun < 777) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Input variables must be processed first.',
        currentStage: sun,
        requiredStage: 777
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await inputVariable.getInputVariableChangesByIndicator('LOAN', year, month, user);

    res.json({
      status: 'SUCCESS',
      indicator: 'LOAN',
      totalChanges: result.totalChanges,
      changes: result.records
    });
  } catch (err) {
    console.error('Error getting loan changes:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

// Export handlers for Excel and PDF
exports.exportInputVariablesExcel = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variable_changes
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name, pay_type
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Input Variable Changes');

    // Header section with proper formatting
    worksheet.mergeCells('A1:W1');
    const titleRow = worksheet.getRow(1);
    titleRow.getCell(1).value = 'INPUT VARIABLE CHANGES REPORT';
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: 'FF0070C0' } };
    titleRow.getCell(1).alignment = { horizontal: 'start', vertical: 'middle' };
    titleRow.height = 30;

    worksheet.mergeCells('A2:W2');
    const periodRow = worksheet.getRow(2);
    periodRow.getCell(1).value = `Period: ${month}/${year}`;
    periodRow.getCell(1).font = { size: 12, bold: true };
    periodRow.getCell(1).alignment = { horizontal: 'start' };

    worksheet.mergeCells('A3:W3');
    const dateRow = worksheet.getRow(3);
    const generatedDate = new Date();
    dateRow.getCell(1).value = `Generated: ${generatedDate.toLocaleDateString('en-NG', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;
    dateRow.getCell(1).font = { size: 10, italic: true };
    dateRow.getCell(1).alignment = { horizontal: 'start' };

    worksheet.addRow([]);

    // Table Headers
    const headerRow = worksheet.addRow([
      'Employee ID',
      'Full Name',
      'Element',
      'Category',
      'Prev Amt (₦)',
      'Curr Amt (₦)',
      'Difference (₦)',
      'Prev Amtad',
      'Curr Amtad',
      'Prev Amttd (₦)',
      'Curr Amttd (₦)',
      'Diff Amttd (₦)',
      'Prev Amtp (₦)',
      'Curr Amtp (₦)',
      'Diff Amtp (₦)',
      'Prev Payind',
      'Curr Payind',
      'Prev Nomth',
      'Curr Nomth',
      'Risk Level'
    ]);

    // Style header row
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    headerRow.alignment = { horizontal: 'start', vertical: 'middle', wrapText: true };
    headerRow.height = 20;

    // Set column widths
    worksheet.columns = [
      { key: 'empl_id', width: 25 },
      { key: 'full_name', width: 25 },
      { key: 'element', width: 20 },
      { key: 'category', width: 20 },
      { key: 'prev_amt', width: 14 },
      { key: 'curr_amt', width: 14 },
      { key: 'diff', width: 14 },
      { key: 'prev_amtad', width: 13 },
      { key: 'curr_amtad', width: 13 },
      { key: 'prev_amttd', width: 14.5 },
      { key: 'curr_amttd', width: 14.5 },
      { key: 'diff_amttd', width: 14.5 },
      { key: 'prev_amtp', width: 14 },
      { key: 'curr_amtp', width: 14 },
      { key: 'diff_amtp', width: 14 },
      { key: 'prev_payind', width: 12 },
      { key: 'curr_payind', width: 12 },
      { key: 'prev_nomth', width: 12 },
      { key: 'curr_nomth', width: 12 },
      { key: 'risk', width: 12 }
    ];

    // Data rows
    let totalImpact = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;

    rows.forEach(row => {
      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      totalImpact += row.amt_difference || 0;
      
      if (row.risk_level === 'HIGH') highRiskCount++;
      else if (row.risk_level === 'MEDIUM') mediumRiskCount++;
      else if (row.risk_level === 'LOW') lowRiskCount++;

      const dataRow = worksheet.addRow({
        empl_id: row.Empl_id,
        full_name: row.full_name,
        element: row.element_name,
        category: row.element_category,
        prev_amt: previous?.amt || 0,
        curr_amt: current?.amt || 0,
        diff: (current?.amt || 0) - (previous?.amt || 0),
        prev_amtad: previous?.amtad || '',
        curr_amtad: current?.amtad || '',
        prev_amttd: previous?.amttd || 0,
        curr_amttd: current?.amttd || 0,
        diff_amttd: (current?.amttd || 0) - (previous?.amttd || 0),
        prev_amtp: previous?.amtp || 0,
        curr_amtp: current?.amtp || 0,
        diff_amtp: (current?.amtp || 0) - (previous?.amtp || 0),
        prev_payind: previous?.payind || '',
        curr_payind: current?.payind || '',
        prev_nomth: previous?.nomth || '',
        curr_nomth: current?.nomth || '',
        risk: row.risk_level
      });

      // Format currency columns
      [5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17].forEach(colNum => {
        dataRow.getCell(colNum).numFmt = '₦#,##0.00';
      });

      // Alternate row colors
      const rowFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: row.risk_level === 'HIGH' ? 'FFFFC7CE' : 'FFF5F5F5' }
      };
      
      dataRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = rowFill;
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
        cell.alignment = { horizontal: 'middle', vertical: 'middle' };
      });

      // Risk level color coding
      const riskCell = dataRow.getCell(22);
      if (row.risk_level === 'HIGH') {
        riskCell.font = { bold: true, color: { argb: 'FF9C0006' } };
      } else if (row.risk_level === 'MEDIUM') {
        riskCell.font = { bold: true, color: { argb: 'FF9C5700' } };
      }
    });

    // Add borders to header
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'medium', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        right: { style: 'medium', color: { argb: 'FF000000' } }
      };
    });

    // Summary section at the bottom
    const summaryStartRow = worksheet.lastRow.number + 3;
    
    worksheet.mergeCells(`A${summaryStartRow}:W${summaryStartRow}`);
    const summaryTitleRow = worksheet.getRow(summaryStartRow);
    summaryTitleRow.getCell(1).value = 'SUMMARY';
    summaryTitleRow.getCell(1).font = { size: 14, bold: true, color: { argb: 'FF0070C0' } };
    summaryTitleRow.getCell(1).alignment = { horizontal: 'start' };
    summaryTitleRow.height = 25;

    const summaryData = [
      ['Total Changes:', rows.length],
      ['High Risk Changes:', highRiskCount],
      ['Medium Risk Changes:', mediumRiskCount],
      ['Low Risk Changes:', lowRiskCount],
    ];

    summaryData.forEach((data, index) => {
      const summaryRow = worksheet.getRow(summaryStartRow + 1 + index);
      summaryRow.getCell(1).value = data[0];
      summaryRow.getCell(1).font = { bold: true };
      summaryRow.getCell(2).value = data[1];
      
      if (index === summaryData.length - 1) {
        summaryRow.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF0070C0' } };
      }
      
      summaryRow.getCell(1).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      summaryRow.getCell(2).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=input_variable_changes_${year}_${month}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.exportInputVariablesPdf = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variable_changes
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name
    `);

    const doc = new PDFDocument({ 
      margin: 20, 
      size: 'A3',
      layout: 'landscape'
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=input_variable_changes_${year}_${month}.pdf`);
    
    doc.pipe(res);

    // Helper function to format currency
    const formatCurrency = (amount) => {
      return `₦${(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Header
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0070C0').text('INPUT VARIABLE CHANGES REPORT', { align: 'center' });
    doc.fillColor('black');
    doc.fontSize(10).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    
    const generatedDate = new Date();
    const formattedDate = generatedDate.toLocaleDateString('en-NG', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.fontSize(8).font('Helvetica-Oblique').text(`Generated: ${formattedDate}`, { align: 'center' });
    doc.moveDown(1);

    // Table setup with all columns
    const tableTop = doc.y;
    const rowHeight = 20;
    const colWidths = [40, 100, 100, 60, 55, 55, 55, 40, 40, 40, 40, 55, 55, 55, 55, 55, 55, 40, 40, 40, 40, 35];
    const colPositions = [];
    let xPos = 20;
    colWidths.forEach(width => {
      colPositions.push(xPos);
      xPos += width;
    });

    // Table headers
    const headers = [
      'ID', 'Name', 'Element', 'Category', 
      'Prev Amt(₦)', 'Curr Amt(₦)', 'Diff(₦)',
      'Prev AMTAD', 'Curr AMTAD',
      'Prev AMTTD(₦)', 'Curr AMTTD(₦)', 'Diff AMTTD(₦)',
      'Prev AMTP(₦)', 'Curr AMTP(₦)', 'Diff AMTP(₦)',
      'Prev PIND', 'Curr PIMD',
      'Prev NMTH', 'Curr NMTH',
      'Risk'
    ];
    
    doc.fontSize(6).font('Helvetica-Bold').fillColor('white');
    doc.rect(20, tableTop, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, 18)
       .fill('#0070C0');
    
    doc.fillColor('white');
    headers.forEach((header, i) => {
      doc.text(header, colPositions[i] + 2, tableTop + 4, {
        width: colWidths[i] - 4,
        align: 'center'
      });
    });

    let currentY = tableTop + 18;

    rows.forEach((row, index) => {
      if (currentY > 520) {
        doc.addPage();
        currentY = 30;
        
        // Redraw header on new page
        doc.fontSize(6).font('Helvetica-Bold').fillColor('white');
        doc.rect(20, currentY, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, 18)
           .fill('#0070C0');
        
        doc.fillColor('white');
        headers.forEach((header, i) => {
          doc.text(header, colPositions[i] + 2, currentY + 4, {
            width: colWidths[i] - 4,
            align: 'center'
          });
        });
        currentY += 18;
      }

      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      // Alternate row background
      const bgColor = row.risk_level === 'HIGH' ? '#FFC7CE' : (index % 2 === 0 ? '#F9F9F9' : '#FFFFFF');
      doc.rect(20, currentY, colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1] - 20, rowHeight)
         .fill(bgColor);

      doc.fillColor('black').font('Helvetica').fontSize(6);

      const cellY = currentY + 6;
      
      // Data array matching header order
      const cellData = [
        { text: row.Empl_id || '', align: 'left' },
        { text: row.full_name || '', align: 'left' },
        { text: row.element_name || '', align: 'left' },
        { text: row.element_category || '', align: 'left' },
        { text: formatCurrency(previous?.amt), align: 'right' },
        { text: formatCurrency(current?.amt), align: 'right' },
        { text: formatCurrency(row.amt_difference), align: 'right' },
        { text: previous?.amtad || '', align: 'left' },
        { text: current?.amtad || '', align: 'left' },
        { text: formatCurrency(previous?.amtt), align: 'right' },
        { text: formatCurrency(current?.amttd), align: 'right' },
        { text: formatCurrency((current?.amttd || 0) - (previous?.amtt || 0)), align: 'right' },
        { text: formatCurrency(previous?.amtp), align: 'right' },
        { text: formatCurrency(current?.amtp), align: 'right' },
        { text: formatCurrency((current?.amtp || 0) - (previous?.amtp || 0)), align: 'right' },
        { text: previous?.payind || '', align: 'left' },
        { text: current?.payind || '', align: 'left' },
        { text: previous?.nomth || '', align: 'left' },
        { text: current?.nomth || '', align: 'left' },
        { text: row.risk_level || '', align: 'center' }
      ];

      // Render each cell
      cellData.forEach((cell, i) => {
        // Risk level color coding
        if (i === cellData.length - 1) {
          doc.font('Helvetica-Bold');
          if (row.risk_level === 'HIGH') {
            doc.fillColor('red');
          } else if (row.risk_level === 'MEDIUM') {
            doc.fillColor('orange');
          } else {
            doc.fillColor('green');
          }
        } else {
          doc.font('Helvetica').fillColor('black');
        }

        doc.text(cell.text, colPositions[i] + 2, cellY, { 
          width: colWidths[i] - 4,
          align: cell.align,
          lineBreak: false
        });
      });

      // Draw cell borders
      doc.strokeColor('#CCCCCC').lineWidth(0.5);
      colPositions.forEach((pos, i) => {
        doc.rect(pos, currentY, colWidths[i], rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};