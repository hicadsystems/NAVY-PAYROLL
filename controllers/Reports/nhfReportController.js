const nhfReportService = require('../../services/Reports/nhfReportService');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class NHFReportController {

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
      console.log('✅ JSReport initialized for NHF Reports');
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
  // NHF REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generateNHFReport(req, res) {
    try {
      const { format, summaryOnly, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summaryOnly === '1' || summaryOnly === 'true',
      };
      
      console.log('NHF Report Filters:', filters); // DEBUG
      
      const data = await nhfReportService.getNHFReport(filters);
      
      console.log('NHF Report Data rows:', data.length); // DEBUG
      console.log('NHF Report Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateNHFReportExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generateNHFReportPDF(data, req, res);
      }

      // Return JSON with summary statistics
      const summary = this.calculateSummary(data, filters.summaryOnly);

      res.json({ 
        success: true, 
        data,
        summary
      });
    } catch (error) {
      console.error('Error generating NHF report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Calculate summary statistics
  calculateSummary(data, isSummary) {
    if (data.length === 0) {
      return {
        totalEmployees: 0,
        totalNHFThisMonth: 0,
        totalNHFToDate: 0,
        averageNHFThisMonth: 0,
        totalNetPay: 0
      };
    }

    if (isSummary) {
      return {
        totalEmployees: data[0]?.employee_count || 0,
        totalNHFThisMonth: data[0]?.total_nhf_this_month || 0,
        totalNHFToDate: data[0]?.total_nhf_to_date || 0,
        averageNHFThisMonth: data[0]?.avg_nhf_this_month || 0,
        totalNetPay: data[0]?.total_net_pay || 0
      };
    } else {
      const totalNHFMonth = data.reduce((sum, row) => sum + parseFloat(row.nhf_this_month || 0), 0);
      const totalNHFToDate = data.reduce((sum, row) => sum + parseFloat(row.nhf_to_date || 0), 0);
      const totalNet = data.reduce((sum, row) => sum + parseFloat(row.net_pay || 0), 0);
      
      return {
        totalEmployees: data.length,
        totalNHFThisMonth: totalNHFMonth,
        totalNHFToDate: totalNHFToDate,
        averageNHFThisMonth: totalNHFMonth / data.length,
        totalNetPay: totalNet
      };
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generateNHFReportExcel(data, res, isSummary = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('NHF Report');

    // Title
    const titleColspan = isSummary ? 'A1:J1' : 'A1:P1';
    worksheet.mergeCells(titleColspan);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - NATIONAL HOUSING FUND REPORT';
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
        { header: 'Employee Count', key: 'employee_count', width: 18 },
        { header: 'Total NHF This Month', key: 'total_nhf_this_month', width: 22 },
        { header: 'Average NHF This Month', key: 'avg_nhf_this_month', width: 22 },
        { header: 'Min NHF This Month', key: 'min_nhf_this_month', width: 20 },
        { header: 'Max NHF This Month', key: 'max_nhf_this_month', width: 20 },
        { header: 'Total NHF To Date', key: 'total_nhf_to_date', width: 22 },
        { header: 'Average NHF To Date', key: 'avg_nhf_to_date', width: 22 },
        { header: 'Total Net Pay', key: 'total_net_pay', width: 20 }
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
      });

      // Format currency columns
      ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
        worksheet.getColumn(col).alignment = { horizontal: 'right' };
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
        { header: 'Location', key: 'location_name', width: 25 },
        { header: 'NHF This Month', key: 'nhf_this_month', width: 18 },
        { header: 'NHF To Date', key: 'nhf_to_date', width: 18 },
        { header: 'Net Pay', key: 'net_pay', width: 18 },
        { header: 'Bank', key: 'Bankcode', width: 20 },
        { header: 'Account Number', key: 'BankACNumber', width: 20 }
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

        // Highlight high NHF contributions
        if (parseFloat(row.nhf_this_month) > 20000) {
          addedRow.getCell('J').font = { bold: true, color: { argb: 'FF006100' } };
        }
      });

      // Format currency columns
      ['J', 'K', 'L'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
        worksheet.getColumn(col).alignment = { horizontal: 'right' };
      });

      // Add grand totals
      const totalRow = worksheet.lastRow.number + 2;
      worksheet.getCell(`I${totalRow}`).value = 'GRAND TOTALS:';
      worksheet.getCell(`I${totalRow}`).font = { bold: true, size: 12 };

      ['J', 'K', 'L'].forEach(col => {
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
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=nhf_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generateNHFReportPDF(data, req, res) {
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
      
      console.log('NHF Report PDF - Is Summary:', isSummary);
      console.log('NHF Report PDF - Data rows:', data.length);

      // Calculate totals
      const summary = this.calculateSummary(data, isSummary);

      const templatePath = path.join(__dirname, '../../templates/nhf-report.html');
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
          isSummary: isSummary,
          className: this.getDatabaseNameFromRequest(req)
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=nhf_report_${data[0]?.month || 'report'}_${data[0]?.year || 'report'}.pdf`
      );
      res.send(result.content);

    } catch (error) {
      console.error('NHF Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getNHFFilterOptions(req, res) {
    try {
      const currentPeriod = await nhfReportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting NHF filter options:', error);
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

module.exports = new NHFReportController();