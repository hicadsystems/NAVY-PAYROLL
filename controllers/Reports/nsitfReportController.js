const nsitfReportService = require('../../services/Reports/nsitfReportService');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const { get } = require('http');
const path = require('path');

class NSITFReportController {

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
      console.log('✅ JSReport initialized for NSITF Reports');
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
  // NSITF REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateNSITFReport(req, res) {
    try {
      const { format, summaryOnly, pfa_code, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summaryOnly === '1' || summaryOnly === 'true',
        pfaCode: pfa_code
      };
      
      console.log('NSITF Report Filters:', filters); // DEBUG
      
      const data = await nsitfReportService.getNSITFReport(filters);
      
      console.log('NSITF Report Data rows:', data.length); // DEBUG
      console.log('NSITF Report Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateNSITFReportExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generateNSITFReportPDF(data, req, res);
      }

      // Return JSON with summary statistics
      const summary = this.calculateSummary(data, filters.summaryOnly);

      res.json({ 
        success: true, 
        data,
        summary
      });
    } catch (error) {
      console.error('Error generating NSITF report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Calculate summary statistics
  calculateSummary(data, isSummary) {
    if (data.length === 0) {
      return {
        totalEmployees: 0,
        totalNetPay: 0,
        averageNetPay: 0,
        pfaCount: 0
      };
    }

    if (isSummary) {
      return {
        totalEmployees: data.reduce((sum, row) => sum + parseInt(row.employee_count || 0), 0),
        totalNetPay: data.reduce((sum, row) => sum + parseFloat(row.total_net_pay || 0), 0),
        averageNetPay: data.reduce((sum, row) => sum + parseFloat(row.avg_net_pay || 0), 0) / data.length,
        pfaCount: data.length
      };
    } else {
      const totalNet = data.reduce((sum, row) => sum + parseFloat(row.net_pay || 0), 0);
      
      return {
        totalEmployees: data.length,
        totalNetPay: totalNet,
        averageNetPay: totalNet / data.length,
        pfaCount: [...new Set(data.map(row => row.pfa_code))].length
      };
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateNSITFReportExcel(data, res, isSummary = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('NSITF Report');

    // Title
    const titleColspan = isSummary ? 'A1:I1' : 'A1:M1';
    worksheet.mergeCells(titleColspan);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - NSITF REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    if (data.length > 0) {
      worksheet.mergeCells(titleColspan.replace('1', '2'));
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `Period: ${this.getMonthName(data[0].month)} ${data[0].year}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { horizontal: 'center' };
      periodCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
    }

    worksheet.addRow([]);

    if (isSummary) {
      // Summary columns
      worksheet.columns = [
        { header: 'PFA Code', key: 'pfa_code', width: 15 },
        { header: 'PFA Name', key: 'pfa_name', width: 35 },
        { header: 'Employee Count', key: 'employee_count', width: 18 },
        { header: 'Total Net Pay', key: 'total_net_pay', width: 20 },
        { header: 'Average Net Pay', key: 'avg_net_pay', width: 20 },
        { header: 'Min Net Pay', key: 'min_net_pay', width: 18 },
        { header: 'Max Net Pay', key: 'max_net_pay', width: 18 }
      ];

      // Style header row (row 4)
      const headerRow = worksheet.getRow(4);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' }
      };
      headerRow.height = 25;
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Add data with alternating row colors
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
      });

      // Format currency columns
      ['D', 'E', 'F', 'G'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
        worksheet.getColumn(col).alignment = { horizontal: 'right' };
      });

      // Add grand totals
      const totalRow = worksheet.lastRow.number + 2;
      worksheet.getCell(`A${totalRow}`).value = 'GRAND TOTALS:';
      worksheet.getCell(`A${totalRow}`).font = { bold: true, size: 12 };
      worksheet.mergeCells(`A${totalRow}:B${totalRow}`);

      ['C', 'D'].forEach(col => {
        worksheet.getCell(`${col}${totalRow}`).value = {
          formula: `SUM(${col}5:${col}${totalRow - 2})`
        };
        worksheet.getCell(`${col}${totalRow}`).font = { bold: true };
        worksheet.getCell(`${col}${totalRow}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE699' }
        };
      });

    } else {
      // Detailed columns
      worksheet.columns = [
        { header: 'Employee ID', key: 'employee_id', width: 15 },
        { header: 'Title', key: 'title', width: 12 },
        { header: 'Full Name', key: 'full_name', width: 35 },
        { header: 'Date Employed', key: 'date_employed', width: 15 },
        { header: 'NSITF Code', key: 'nsitf_code', width: 15 },
        { header: 'Grade Type', key: 'grade_type', width: 12 },
        { header: 'Grade Level', key: 'grade_level', width: 12 },
        { header: 'Years in Level', key: 'years_in_level', width: 15 },
        { header: 'PFA Code', key: 'pfa_code', width: 15 },
        { header: 'PFA Name', key: 'pfa_name', width: 35 },
        { header: 'Net Pay', key: 'net_pay', width: 20 }
      ];

      // Style header row (row 4)
      const headerRow = worksheet.getRow(4);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' }
      };
      headerRow.height = 25;
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Group by PFA
      const pfaGroups = {};
      data.forEach(row => {
        const pfa = row.pfa_name || 'Unknown';
        if (!pfaGroups[pfa]) pfaGroups[pfa] = [];
        pfaGroups[pfa].push(row);
      });

      // Add data with PFA separators
      Object.keys(pfaGroups).sort().forEach((pfa, pfaIndex) => {
        if (pfaIndex > 0) worksheet.addRow([]);

        // PFA header
        const headerRow = worksheet.addRow([`PFA: ${pfa}`]);
        headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        worksheet.mergeCells(headerRow.number, 1, headerRow.number, 11);

        // Add PFA data with alternating colors
        pfaGroups[pfa].forEach((row, index) => {
          const addedRow = worksheet.addRow(row);

          if (index % 2 === 0) {
            addedRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          }
        });

        // PFA subtotal
        const subtotalRow = worksheet.lastRow.number + 1;
        worksheet.getCell(`I${subtotalRow}`).value = `${pfa} TOTAL:`;
        worksheet.getCell(`I${subtotalRow}`).font = { bold: true };
        worksheet.mergeCells(`I${subtotalRow}:J${subtotalRow}`);

        worksheet.getCell(`K${subtotalRow}`).value = {
          formula: `SUBTOTAL(9,K${headerRow.number + 1}:K${subtotalRow - 1})`
        };
        worksheet.getCell(`K${subtotalRow}`).font = { bold: true };
        worksheet.getCell(`K${subtotalRow}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD9E1F2' }
        };
      });

      // Format currency column
      worksheet.getColumn('K').numFmt = '₦#,##0.00';
      worksheet.getColumn('K').alignment = { horizontal: 'right' };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=nsitf_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateNSITFReportPDF(data, req, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      if (!data || data.length === 0) {
        throw new Error('No data available for the selected filters');
      }

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('employee_id');
      
      console.log('NSITF Report PDF - Is Summary:', isSummary);
      console.log('NSITF Report PDF - Data rows:', data.length);

      // Calculate totals
      const summary = this.calculateSummary(data, isSummary);

      const templatePath = path.join(__dirname, '../../templates/nsitf-report.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

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
            marginTop: '2mm',
            marginBottom: '2mm',
            marginLeft: '2mm',
            marginRight: '2mm'
          },
          helpers: this._getCommonHelpers()
        },
        data: {
          data: data,
          summary: summary,
          reportDate: new Date(),
          period: data.length > 0 ? 
            `${this.getMonthName(data[0].month)} ${data[0].year}` : 
            'N/A',
          className: this.getDatabaseNameFromRequest(req),
          isSummary: isSummary
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=nsitf_report_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(result.content);

    } catch (error) {
      console.error('NSITF Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getNSITFFilterOptions(req, res) {
    try {
      const pfas = await nsitfReportService.getAvailablePFAs();
      const currentPeriod = await nsitfReportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          pfas,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting NSITF filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month - 1] || '';
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

module.exports = new NSITFReportController();