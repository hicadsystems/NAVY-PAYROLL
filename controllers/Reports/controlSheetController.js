const controlSheetService = require('../../services/Reports/controlSheetService');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class ControlSheetController {

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
      console.log('✅ JSReport initialized for Control Sheet Reports');
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
  // CONTROL SHEET REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateControlSheet(req, res) {
    try {
      const { format, payroll_class, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        payrollClass: payroll_class
      };
      
      console.log('Control Sheet Filters:', filters); // DEBUG
      
      const result = await controlSheetService.getControlSheet(filters);
      
      console.log('Control Sheet Data rows:', result.details.length); // DEBUG
      console.log('Control Sheet Totals:', result.totals); // DEBUG

      if (format === 'excel') {
        return this.generateControlSheetExcel(result, res);
      } else if (format === 'pdf') {
        return this.generateControlSheetPDF(result, req, res);
      }

      res.json({ 
        success: true, 
        data: result.details,
        totals: result.totals
      });
    } catch (error) {
      console.error('Error generating control sheet:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateControlSheetExcel(result, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Control Sheet');
    const data = result.details;

    // Title
    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - PAYROLL CONTROL SHEET';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    if (data.length > 0) {
      worksheet.mergeCells('A2:F2');
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `FOR PERIOD: ${data[0].month_name}, ${data[0].year} | Recordcount = ${data[0].recordcount}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'center' };
      periodCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
    }

    worksheet.addRow([]);

    // Column headers
    worksheet.columns = [
      { header: 'Payment Type', key: 'payment_type', width: 15 },
      { header: 'Payment Description', key: 'payment_description', width: 35 },
      { header: 'DR', key: 'dr_amount', width: 18 },
      { header: 'CR', key: 'cr_amount', width: 18 },
      { header: 'Ledger Codes', key: 'ledger_code', width: 20 }
    ];

    // Style header row (row 4)
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1e40af' }
    };
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data
    data.forEach((row, index) => {
      const addedRow = worksheet.addRow(row);

      // Alternate row colors
      if (index % 2 === 0) {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }

      // Highlight rows with missing ledger codes
      if (!row.ledger_code || row.ledger_code.trim() === '') {
        addedRow.getCell('E').value = 'No LegCode';
        addedRow.getCell('E').font = { color: { argb: 'FFFF0000' }, italic: true };
      }
    });

    // Format currency columns
    worksheet.getColumn('C').numFmt = '₦#,##0.00';
    worksheet.getColumn('C').alignment = { horizontal: 'right' };
    worksheet.getColumn('D').numFmt = '₦#,##0.00';
    worksheet.getColumn('D').alignment = { horizontal: 'right' };

    // Add grand totals
    const totalRow = worksheet.lastRow.number + 2;
    
    worksheet.getCell(`A${totalRow}`).value = 'Grand Total';
    worksheet.getCell(`A${totalRow}`).font = { bold: true, size: 12 };
    worksheet.mergeCells(`A${totalRow}:B${totalRow}`);
    
    worksheet.getCell(`C${totalRow}`).value = result.totals.dr_total;
    worksheet.getCell(`C${totalRow}`).font = { bold: true };
    worksheet.getCell(`C${totalRow}`).numFmt = '₦#,##0.00';
    worksheet.getCell(`C${totalRow}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' }
    };
    
    worksheet.getCell(`D${totalRow}`).value = result.totals.cr_total;
    worksheet.getCell(`D${totalRow}`).font = { bold: true };
    worksheet.getCell(`D${totalRow}`).numFmt = '₦#,##0.00';
    worksheet.getCell(`D${totalRow}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' }
    };

    // Add balance status
    const statusRow = totalRow + 1;
    worksheet.mergeCells(`A${statusRow}:E${statusRow}`);
    const statusCell = worksheet.getCell(`A${statusRow}`);
    statusCell.value = result.totals.balanced ? 
      '✓ CONTROL SHEET BALANCED' : 
      '✗ WARNING: CONTROL SHEET NOT BALANCED';
    statusCell.font = { 
      bold: true, 
      size: 12,
      color: { argb: result.totals.balanced ? 'FF006100' : 'FFFF0000' }
    };
    statusCell.alignment = { horizontal: 'center' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=control_sheet.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateControlSheetPDF(result, req, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      if (!result.details || result.details.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const data = result.details;

      console.log('Control Sheet PDF - Data rows:', data.length);
      console.log('Control Sheet PDF - Balanced:', result.totals.balanced);

      const templatePath = path.join(__dirname, '../../templates/control-sheet.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const result_data = await jsreport.render({
        template: {
          content: templateContent,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            displayHeaderFooter: false,
            printBackground: true,
            format: 'A4',
            landscape: false,
            marginTop: '5mm',
            marginBottom: '5mm',
            marginLeft: '5mm',
            marginRight: '5mm'
          },
          helpers: this._getCommonHelpers()
        },
        data: {
          data: data,
          totals: result.totals,
          reportDate: new Date(),
          period: data.length > 0 ? 
            `${data[0].month_name}, ${data[0].year}` : 
            'N/A',
          className: this.getDatabaseNameFromRequest(req),
          recordcount: data.length > 0 ? data[0].recordcount : 0
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=control_sheet_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(result_data.content);

    } catch (error) {
      console.error('Control Sheet PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getControlSheetFilterOptions(req, res) {
    try {
      const currentPeriod = await controlSheetService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting control sheet filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

    getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W_OFFICERS', 
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    // Get the current database from request
    const currentDb = req.current_class;
    
    // Return the mapped class name, or fallback to the current_class value, or default to 'OFFICERS'
    return dbToClassMap[currentDb] || currentDb || 'OFFICERS';
  }
}

module.exports = new ControlSheetController();