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
      summary: result.summary,
      changes: result.records,
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
    const { startDate, endDate, period } = req.query;
    
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getHighRiskPersonnelChanges(
      year, 
      month, 
      user, 
      { startDate, endDate, period }
    );

    res.json({
      status: 'SUCCESS',
      riskLevel: 'HIGH',
      totalChanges: result.totalChanges,
      changes: result.records,
      filters: { startDate, endDate, period }
    });
  } catch (err) {
    console.error('Error getting high-risk personnel changes:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// Get terminated employees
exports.getTerminatedEmployees = async (req, res) => {
  try {
    const { startDate, endDate, period } = req.query;
    
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getPersonnelChangesByCategory(
      'TERMINATED', 
      year, 
      month, 
      user, 
      { startDate, endDate, period }
    );

    res.json({
      status: 'SUCCESS',
      category: 'TERMINATED',
      totalChanges: result.totalChanges,
      changes: result.records,
      filters: { startDate, endDate, period }
    });
  } catch (err) {
    console.error('Error getting terminated employees:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// Get new employees
exports.getNewEmployees = async (req, res) => {
  try {
    const { startDate, endDate, period } = req.query;
    
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user?.fullname || req.user_fullname || 'System Auto';
    
    const result = await personnelData.getPersonnelChangesByCategory(
      'NEW_EMPLOYEE', 
      year, 
      month, 
      user, 
      { startDate, endDate, period }
    );

    res.json({
      status: 'SUCCESS',
      category: 'NEW_EMPLOYEE',
      totalChanges: result.totalChanges,
      changes: result.records,
      filters: { startDate, endDate, period }
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

    // Build dynamic WHERE clause for filters
    let whereConditions = [];
    let queryParams = [];

    if (startDate && endDate) {
      whereConditions.push('detected_at BETWEEN ? AND ?');
      queryParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push('detected_at >= ?');
      queryParams.push(startDate);
    } else if (endDate) {
      whereConditions.push('detected_at <= ?');
      queryParams.push(endDate);
    }

    if (period) {
      whereConditions.push('JSON_EXTRACT(previous_values, "$.period") = ?');
      queryParams.push(period);
    }

    if (riskLevel) {
      whereConditions.push('risk_level = ?');
      queryParams.push(riskLevel);
    }

    if (changeCategory) {
      whereConditions.push('change_category = ?');
      queryParams.push(changeCategory);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get ALL columns from view
    const query = `
      SELECT * FROM vw_personnel_changes
      ${whereClause}
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name
    `;

    const [rows] = await pool.query(query, queryParams);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personnel Changes');

    // Add header
    worksheet.addRow(['PERSONNEL CHANGES REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    if (startDate || endDate || period || riskLevel || changeCategory) {
      worksheet.addRow([`Filters: ${JSON.stringify({ startDate, endDate, period, riskLevel, changeCategory })}`]);
    }
    worksheet.addRow([]);

    // Summary sheet with ALL columns
    worksheet.columns = [
      { header: 'Employee ID', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Location', key: 'location', width: 15 },
      { header: 'Factory', key: 'factory', width: 15 },
      { header: 'Change Summary', key: 'change_summary', width: 50 },
      { header: 'Category', key: 'category', width: 25 },
      { header: 'Risk Level', key: 'risk', width: 12 },
      { header: 'Detected At', key: 'detected_at', width: 20 },
    ];

    // Style header row
    const headerRowIndex = (startDate || endDate || period || riskLevel || changeCategory) ? 6 : 5;
    const headerRow = worksheet.getRow(headerRowIndex);
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
        risk: row.risk_level,
        detected_at: new Date(row.detected_at).toLocaleString()
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

    // Add detailed changes sheet with ALL FIELDS
    const detailsSheet = workbook.addWorksheet('Detailed Changes');
    detailsSheet.columns = [
      { header: 'Employee ID', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Previous Value', key: 'prev', width: 30 },
      { header: 'Current Value', key: 'curr', width: 30 },
      { header: 'Previous Period', key: 'period', width: 15 },
    ];

    detailsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    detailsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Process ALL fields from JSON
    rows.forEach(row => {
      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      const previousPeriod = previous.period || 'N/A';

      // Loop through ALL fields in current_values
      Object.keys(current).forEach(key => {
        // Convert values to strings for comparison
        const currentVal = String(current[key] || '');
        const previousVal = String(previous[key] || '');
        
        if (currentVal !== previousVal) {
          detailsSheet.addRow({
            empl_id: row.Empl_ID,
            full_name: row.full_name,
            field: key,
            prev: previousVal || 'N/A',
            curr: currentVal || 'N/A',
            period: previousPeriod
          });
        }
      });
    });

    // Add a third sheet with complete current and previous values side-by-side
    const fullDataSheet = workbook.addWorksheet('Complete Data Comparison');
    
    // Define all columns from hr_employees
    const allColumns = [
      'Empl_ID', 'Surname', 'OtherName', 'Title', 'TITLEDESC', 'Sex', 'JobClass', 'Jobtitle',
      'MaritalStatus', 'Factory', 'Location', 'Birthdate', 'DateEmpl', 'DateLeft', 'TELEPHONE',
      'HOMEADDR', 'nok_name', 'Bankcode', 'bankbranch', 'BankACNumber', 'InternalACNo',
      'StateofOrigin', 'LocalGovt', 'TaxCode', 'NSITFcode', 'NHFcode', 'seniorno', 'command',
      'nok_addr', 'Language1', 'Fluency1', 'Language2', 'Fluency2', 'Language3', 'Fluency3',
      'Country', 'Height', 'Weight', 'BloodGroup', 'Genotype', 'entry_mode', 'Status',
      'datepmted', 'dateconfirmed', 'taxed', 'gradelevel', 'gradetype', 'entitlement', 'town',
      'createdby', 'datecreated', 'nok_relation', 'specialisation', 'accomm_type', 'qual_allow',
      'sp_qual_allow', 'rent_subsidy', 'instruction_allow', 'command_allow', 'award',
      'payrollclass', 'email', 'pfacode', 'state', 'emolumentform', 'dateadded', 'exittype',
      'gsm_number', 'nokphone', 'religion'
    ];

    // Create headers for full data sheet
    const fullDataHeaders = ['Employee ID', 'Full Name', 'Field', 'Previous Value', 'Current Value', 'Changed'];
    fullDataSheet.addRow(fullDataHeaders);
    
    const fullDataHeaderRow = fullDataSheet.getRow(1);
    fullDataHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fullDataHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    fullDataSheet.columns = [
      { header: 'Employee ID', key: 'empl_id', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Previous Value', key: 'prev', width: 30 },
      { header: 'Current Value', key: 'curr', width: 30 },
      { header: 'Changed', key: 'changed', width: 10 },
    ];

    rows.forEach(row => {
      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      // Add ALL columns
      allColumns.forEach(col => {
        const currentVal = String(current[col] || '');
        const previousVal = String(previous[col] || '');
        const isChanged = currentVal !== previousVal;

        const dataRow = fullDataSheet.addRow({
          empl_id: row.Empl_ID,
          full_name: row.full_name,
          field: col,
          prev: previousVal || 'N/A',
          curr: currentVal || 'N/A',
          changed: isChanged ? 'YES' : 'NO'
        });

        // Highlight changed rows
        if (isChanged) {
          dataRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFEB9C' }
          };
        }
      });

      // Add separator row between employees
      fullDataSheet.addRow([]);
    });

    // Generate file
    const filename = `personnel_changes_${year}_${month}${period ? '_' + period : ''}${startDate ? '_from_' + startDate.replace(/:/g, '-') : ''}${endDate ? '_to_' + endDate.replace(/:/g, '-') : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.exportPersonnelChangesPDF = async (req, res) => {
  try {
    const { startDate, endDate, period, riskLevel, changeCategory } = req.query;
    
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Build dynamic WHERE clause for filters
    let whereConditions = [];
    let queryParams = [];

    if (startDate && endDate) {
      whereConditions.push('detected_at BETWEEN ? AND ?');
      queryParams.push(startDate, endDate);
    } else if (startDate) {
      whereConditions.push('detected_at >= ?');
      queryParams.push(startDate);
    } else if (endDate) {
      whereConditions.push('detected_at <= ?');
      queryParams.push(endDate);
    }

    if (period) {
      whereConditions.push('JSON_EXTRACT(previous_values, "$.period") = ?');
      queryParams.push(period);
    }

    if (riskLevel) {
      whereConditions.push('risk_level = ?');
      queryParams.push(riskLevel);
    }

    if (changeCategory) {
      whereConditions.push('change_category = ?');
      queryParams.push(changeCategory);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get ALL columns from view
    const query = `
      SELECT * FROM vw_personnel_changes
      ${whereClause}
      ORDER BY FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'), full_name
    `;

    const [rows] = await pool.query(query, queryParams);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    const filename = `personnel_changes_${year}_${month}${period ? '_' + period : ''}${startDate ? '_from_' + startDate.replace(/:/g, '-') : ''}${endDate ? '_to_' + endDate.replace(/:/g, '-') : ''}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('PERSONNEL CHANGES REPORT', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    
    // Display applied filters
    if (startDate || endDate || period || riskLevel || changeCategory) {
      doc.moveDown(0.5);
      doc.fontSize(10).text('Filters Applied:', { align: 'center' });
      if (startDate) doc.text(`Start Date: ${startDate}`, { align: 'center' });
      if (endDate) doc.text(`End Date: ${endDate}`, { align: 'center' });
      if (period) doc.text(`Period: ${period}`, { align: 'center' });
      if (riskLevel) doc.text(`Risk Level: ${riskLevel}`, { align: 'center' });
      if (changeCategory) doc.text(`Category: ${changeCategory}`, { align: 'center' });
    }
    
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

    // Table rows with detailed changes
    rows.forEach((row, index) => {
      if (doc.y > 650) {
        doc.addPage();
      }

      const riskColor = row.risk_level === 'HIGH' ? 'red' : 
                        row.risk_level === 'MEDIUM' ? 'orange' : 'green';

      doc.fontSize(10).font('Helvetica-Bold')
        .text(`${index + 1}. ${row.full_name} (${row.Empl_ID})`, { continued: true })
        .fillColor(riskColor).text(` [${row.risk_level}]`).fillColor('black');
      
      doc.fontSize(9).font('Helvetica')
        .text(`   Location: ${row.Location || 'N/A'}`)
        .text(`   Factory: ${row.Factory || 'N/A'}`)
        .text(`   Changes: ${row.change_summary}`)
        .text(`   Category: ${row.change_category}`)
        .text(`   Detected: ${new Date(row.detected_at).toLocaleString()}`);
      
      // Parse and display detailed changes
      const current = typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values;
      
      const previous = typeof row.previous_values === 'string' 
        ? JSON.parse(row.previous_values) 
        : row.previous_values;

      doc.fontSize(8).font('Helvetica').text('   Detailed Changes:', { underline: true });
      
      let changeCount = 0;
      Object.keys(current).forEach(key => {
        const currentVal = String(current[key] || '');
        const previousVal = String(previous[key] || '');
        
        if (currentVal !== previousVal && changeCount < 10) { // Limit to 10 changes per employee for PDF
          doc.fontSize(7).text(`      ${key}: "${previousVal}" → "${currentVal}"`);
          changeCount++;
        }
      });

      if (changeCount === 10) {
        doc.fontSize(7).text('      ... (see Excel export for complete details)');
      }
      
      doc.moveDown(0.7);
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get available periods from py_emplhistory for filter dropdown
exports.getAvailablePeriods = async (req, res) => {
  try {
    const [periods] = await pool.query(`
      SELECT DISTINCT period 
      FROM py_emplhistory 
      WHERE period IS NOT NULL AND period != ''
      ORDER BY period DESC
      LIMIT 50
    `);

    res.json({
      status: 'SUCCESS',
      periods: periods.map(p => p.period)
    });
  } catch (err) {
    console.error('Error getting available periods:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
