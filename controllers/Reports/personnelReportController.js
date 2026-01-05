const personnelReportService = require('../../services/Reports/personnelReportServices');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');

class PersonnelReportController {

  constructor() {
    this.jsreportReady = false;
    this.initJSReport();
  }

  async initJSReport() {
    try {
      jsreport.use(require('jsreport-handlebars')());
      jsreport.use(require('jsreport-chrome-pdf')());
      
      await jsreport.init();
      this.jsreportReady = true;
      console.log('✅ JSReport initialized for Personnel Reports');
    } catch (error) {
      console.error('JSReport initialization failed:', error);
    }
  }

  // Helper method for common Handlebars helpers
  _getCommonHelpers() {
    return `
      function formatCurrency(value) {
        const num = parseFloat(value) || 0;
        return num.toLocaleString('en-NG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }

      function formatCurrencyWithSign(amount) {
        const num = parseFloat(amount || 0);
        const formatted = Math.abs(num).toLocaleString('en-NG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        if (num < 0) {
          return '(' + formatted + ')';
        }
        return formatted;
      }
      
      function isNegative(amount) {
        return parseFloat(amount || 0) < 0;
      }
      
      function formatDate(date) {
        const d = new Date(date || new Date());
        return d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }

      function formatTime(date) {
        return new Date(date).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }

      function formatMonth(monthNumber) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return monthNames[monthNumber - 1] || 'Unknown';
      }

      function add(a, b) {
        return (parseFloat(a) || 0) + (parseFloat(b) || 0);
      }
      
      function subtract(a, b) {
        return (parseFloat(a) || 0) - (parseFloat(b) || 0);
      }
      
      function eq(a, b) {
        return a === b;
      }
      
      function gt(a, b) {
          return parseFloat(a) > parseFloat(b);
      }
      
      function sum(array, property) {
        if (!array || !Array.isArray(array)) return 0;
        return array.reduce((sum, item) => sum + (parseFloat(item[property]) || 0), 0);
      }
      
      function groupBy(array, property) {
        if (!array || !Array.isArray(array)) return [];
        
        const groups = {};
        array.forEach(item => {
          const key = item[property] || 'Unknown';
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(item);
        });
        
        return Object.keys(groups).sort().map(key => ({
          key: key,
          values: groups[key]
        }));
      }
      
      function sumByType(earnings, type) {
        let total = 0;
        if (Array.isArray(earnings)) {
          earnings.forEach(item => {
            if (item.type === type) {
              total += parseFloat(item.amount) || 0;
            }
          });
        }
        return total;
      }
    `;
  }

// ==========================================================================
  // PERSONNEL REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generatePersonnelReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for personnel report:', currentDb);
      
      // Map frontend parameter names to backend expected names
      const filters = {
        title: filterParams.title || filterParams.Title,
        pfa: filterParams.pfa,
        location: filterParams.location,
        gradetype: filterParams.gradetype || filterParams.gradeType,
        gradelevel: filterParams.gradelevel || filterParams.gradeLevel,
        oldEmployees: filterParams.oldEmployees || filterParams.old_employees,
        bankBranch: filterParams.bankBranch || filterParams.bank_branch,
        stateOfOrigin: filterParams.stateOfOrigin || filterParams.state_of_origin,
        emolumentForm: filterParams.emolumentForm || filterParams.emolument_form,
        rentSubsidy: filterParams.rentSubsidy || filterParams.rent_subsidy,
        taxed: filterParams.taxed
      };
      
      console.log('Personnel Report Filters:', filters);
      
      const data = await personnelReportService.getPersonnelReport(filters, currentDb);
      const statistics = await personnelReportService.getPersonnelStatistics(filters, currentDb);
      
      console.log('Personnel Report Data rows:', data.length);
      console.log('Personnel Report Statistics:', statistics);

      if (format === 'excel') {
        return this.generatePersonnelReportExcel(data, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generatePersonnelReportPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('Error generating Personnel report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generatePersonnelReportExcel(data, res, filters, statistics) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personnel Report');

    // Title
    worksheet.mergeCells('A1:O1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - PERSONNEL REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Filter info
    worksheet.mergeCells('A2:O2');
    const filterCell = worksheet.getCell('A2');
    let filterText = 'Filters: ';
    const appliedFilters = [];
    if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
    if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
    if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
    if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
    if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
    if (filters.oldEmployees) appliedFilters.push(`Old Employees: ${filters.oldEmployees}`);
    if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
    if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
    if (filters.emolumentForm) appliedFilters.push(`Emolument Form: ${filters.emolumentForm}`);
    if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
    if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
    
    filterCell.value = appliedFilters.length > 0 ? filterText + appliedFilters.join(' | ') : 'All Personnel';
    filterCell.font = { size: 11, italic: true };
    filterCell.alignment = { horizontal: 'center' };
    filterCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    // Statistics row
    worksheet.mergeCells('A3:O3');
    const statsCell = worksheet.getCell('A3');
    statsCell.value = `Total: ${statistics.total_employees} | Active: ${statistics.active_employees} | Separated: ${statistics.separated_employees} | Avg Age: ${statistics.avg_age || 'N/A'} yrs | Avg Service: ${statistics.avg_years_of_service || 'N/A'} yrs`;
    statsCell.font = { size: 10, bold: true };
    statsCell.alignment = { horizontal: 'center' };
    statsCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFD966' }
    };

    worksheet.addRow([]);

    // Define columns
    worksheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Title', key: 'title_code', width: 10 },
      { header: 'Full Name', key: 'full_name', width: 35 },
      { header: 'Location', key: 'location', width: 25 },
      { header: 'Grade Level', key: 'gradelevel', width: 12 },
      { header: 'Grade Type', key: 'gradetype', width: 20 },
      { header: 'PFA', key: 'pfa', width: 15 },
      { header: 'NSITF Code', key: 'nsitf_code', width: 15 },
      { header: 'Emolument Form', key: 'emolumentform', width: 15 },
      { header: 'Age', key: 'age', width: 8 },
      { header: 'Years of Service', key: 'years_of_service', width: 15 },
      { header: 'Date Employed', key: 'date_employed_formatted', width: 15 },
      { header: 'Date Promoted', key: 'date_promoted_formatted', width: 15 },
      { header: 'Years Since Promotion', key: 'years_since_promotion', width: 18 },
      { header: 'State', key: 'state_of_origin', width: 15 }
    ];

    // Style header row (row 5)
    const headerRow = worksheet.getRow(5);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    headerRow.height = 30;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data with alternating colors
    data.forEach((row, index) => {
      const addedRow = worksheet.addRow(row);

      if (index % 2 === 0) {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }

      // Highlight employees close to retirement (age > 55)
      if (row.age && parseInt(row.age) > 55) {
        addedRow.getCell('J').font = { bold: true, color: { argb: 'FFFF0000' } };
      }

      // Highlight long service (> 30 years)
      if (row.years_of_service && parseInt(row.years_of_service) > 30) {
        addedRow.getCell('K').font = { bold: true, color: { argb: 'FF006100' } };
      }
    });

    // Center align numeric columns
    ['J', 'K', 'N'].forEach(col => {
      worksheet.getColumn(col).alignment = { horizontal: 'center' };
    });

    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 5) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    });

    // Summary section
    const summaryStartRow = worksheet.lastRow.number + 3;
    worksheet.mergeCells(`A${summaryStartRow}:C${summaryStartRow}`);
    const summaryTitle = worksheet.getCell(`A${summaryStartRow}`);
    summaryTitle.value = 'SUMMARY STATISTICS';
    summaryTitle.font = { bold: true, size: 12 };
    summaryTitle.alignment = { horizontal: 'center' };
    summaryTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };
    summaryTitle.font.color = { argb: 'FFFFFFFF' };

    const summaryData = [
      ['Total Employees:', statistics.total_employees],
      ['Active Employees:', statistics.active_employees],
      ['Separated Employees:', statistics.separated_employees],
      ['Average Age:', statistics.avg_age ? `${statistics.avg_age} years` : 'N/A'],
      ['Average Years of Service:', statistics.avg_years_of_service ? `${statistics.avg_years_of_service} years` : 'N/A'],
      ['Rent Subsidy - YES:', statistics.with_rent_subsidy_yes || 0],
      ['Rent Subsidy - NO:', statistics.with_rent_subsidy_no || 0],
      ['Taxed - YES:', statistics.taxed_yes || 0],
      ['Taxed - NO:', statistics.taxed_no || 0],
      ['Emolument Form - YES:', statistics.emolumentform_yes || 0],
      ['Emolument Form - NO:', statistics.emolumentform_no || 0]
    ];

    summaryData.forEach((item, idx) => {
      const row = worksheet.getRow(summaryStartRow + 1 + idx);
      row.getCell(1).value = item[0];
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = item[1];
      
      row.getCell(1).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      row.getCell(2).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=personnel_report_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generatePersonnelReportPDF(data, req, res, filters, statistics) {
    if (!this.jsreportReady) {
      console.error('❌ JSReport not ready');
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      if (!data || data.length === 0) {
        console.error('❌ No data available for PDF generation');
        throw new Error('No data available for the selected filters');
      }

      console.log('📄 Generating PDF with', data.length, 'records');

      const templatePath = path.join(__dirname, '../../templates/personnel-report.html');
      
      if (!fs.existsSync(templatePath)) {
        console.error('❌ Template file not found:', templatePath);
        throw new Error('PDF template file not found');
      }
      
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Format filter description
      const appliedFilters = [];
      if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
      if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
      if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
      if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
      if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
      if (filters.oldEmployees) appliedFilters.push(`Old Employees: ${filters.oldEmployees}`);
      if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
      if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
      if (filters.emolumentForm) appliedFilters.push(`Emolument Form: ${filters.emolumentForm}`);
      if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
      if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
      
      const filterDescription = appliedFilters.length > 0 ? appliedFilters.join(' | ') : 'All Personnel';

      const result = await jsreport.render({
        template: {
          content: templateContent,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            displayHeaderFooter: false,
            printBackground: true,
            format: 'A4',
            landscape: true,
            marginTop: '5mm',
            marginBottom: '5mm',
            marginLeft: '5mm',
            marginRight: '5mm'
          },
          helpers: this._getCommonHelpers()
        },
        data: {
          data: data,
          statistics: statistics,
          reportDate: new Date(),
          filters: filterDescription,
          className: this.getDatabaseNameFromRequest(req)
        }
      });

      console.log('✅ PDF generated successfully');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=personnel_report_${new Date().toISOString().split('T')[0]}.pdf`
      );
      res.send(result.content);

    } catch (error) {
      console.error('❌ ERROR generating Personnel Report PDF:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate PDF report'
      });
    }
  }

  // GET FILTER OPTIONS
  // ==========================================================================
  async getPersonnelFilterOptions(req, res) {
    try {
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for filter options:', currentDb);
      
      const [titles, pfas, locations, gradeTypes, gradeLevels, bankBranches, states, rentSubsidy, taxedStatus, emolumentForms] = await Promise.all([
        personnelReportService.getAvailableTitles(currentDb),
        personnelReportService.getAvailablePFAs(currentDb),
        personnelReportService.getAvailableLocations(currentDb),
        personnelReportService.getAvailableGradeTypes(currentDb),
        personnelReportService.getAvailableGradeLevels(currentDb),
        personnelReportService.getAvailableBankBranches(currentDb),
        personnelReportService.getAvailableStates(currentDb),
        personnelReportService.getAvailableRentSubsidy(currentDb),
        personnelReportService.getAvailableTaxedStatus(currentDb),
        personnelReportService.getAvailableEmolumentForms(currentDb)
      ]);

      console.log('✅ Filter options loaded:', {
        titles: titles.length,
        pfas: pfas.length,
        locations: locations.length,
        gradeTypes: gradeTypes.length,
        gradeLevels: gradeLevels.length,
        bankBranches: bankBranches.length,
        states: states.length,
        rentSubsidy: rentSubsidy.length,
        taxedStatus: taxedStatus.length,
        emolumentForms: emolumentForms.length
      });

      // Check for empty filter options
      const warnings = [];
      if (titles.length === 0) warnings.push('titles');
      if (pfas.length === 0) warnings.push('pfas');
      if (locations.length === 0) warnings.push('locations');
      if (gradeTypes.length === 0) warnings.push('gradeTypes');
      if (gradeLevels.length === 0) warnings.push('gradeLevels');
      if (bankBranches.length === 0) warnings.push('bankBranches');
      if (states.length === 0) warnings.push('states');
      if (rentSubsidy.length === 0) warnings.push('rentSubsidy');
      if (taxedStatus.length === 0) warnings.push('taxedStatus');
      if (emolumentForms.length === 0) warnings.push('emolumentForms');

      if (warnings.length > 0) {
        console.log('⚠️  Warning: No data found for filters:', warnings.join(', '));
      }

      res.json({
        success: true,
        data: {
          titles,
          pfas,
          locations,
          gradeTypes,
          gradeLevels,
          bankBranches,
          states,
          rentSubsidy,
          taxedStatus,
          emolumentForms,
          oldEmployeesOptions: [
            { code: 'yes', description: 'Separated/Left Employees' },
            { code: 'no', description: 'Active Employees Only' }
          ]
        },
        warnings: warnings.length > 0 ? `No data available for: ${warnings.join(', ')}` : null
      });
    } catch (error) {
      console.error('❌ ERROR getting Personnel filter options:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to load filter options'
      });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const currentDb = req.current_class;
    return dbToClassMap[currentDb] || currentDb || 'OFFICERS';
  }
}

module.exports = new PersonnelReportController();