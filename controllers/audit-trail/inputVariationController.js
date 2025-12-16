const payPeriodReportService = require('../../services/audit-trail/inputVariationServices');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class PayPeriodReportController {

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
      console.log('✅ JSReport initialized for Pay Period Reports');
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
      
      function formatDateTime(datetime) {
        if (!datetime) return '';
        const d = new Date(datetime);
        return d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }) + ' ' + d.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
      
      function formatPeriod(period) {
        if (!period || period.length !== 6) return period;
        const year = period.substring(0, 4);
        const month = period.substring(4, 6);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = months[parseInt(month) - 1] || month;
        return monthName + ' ' + year;
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
    `;
  }

  // ==========================================================================
  // PAY PERIOD REPORT - MAIN ENDPOINT
  // ==========================================================================
  async generatePayPeriodReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        fromPeriod: filterParams.fromPeriod || filterParams.from_period,
        toPeriod: filterParams.toPeriod || filterParams.to_period,
        emplId: filterParams.emplId || filterParams.empl_id || filterParams.employeeId,
        createdBy: filterParams.createdBy || filterParams.created_by || filterParams.operator,
        payType: filterParams.payType || filterParams.pay_type || filterParams.type
      };
      
      console.log('Pay Period Report Filters:', filters); // DEBUG
      
      const data = await payPeriodReportService.getPayPeriodReport(filters);
      const statistics = await payPeriodReportService.getPayPeriodStatistics(filters);
      
      console.log('Pay Period Report Data rows:', data.length); // DEBUG
      console.log('Pay Period Report Statistics:', statistics); // DEBUG

      if (format === 'excel') {
        return this.generatePayPeriodReportExcel(data, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generatePayPeriodReportPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('Error generating Pay Period report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION
  // ==========================================================================
  async generatePayPeriodReportExcel(data, res, filters, statistics) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pay Period Report');

    // Title
    worksheet.mergeCells('A1:P1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - INPUT VARIATION REPORT';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Filter info
    worksheet.mergeCells('A2:P2');
    const filterCell = worksheet.getCell('A2');
    let filterText = 'Filters: ';
    if (filters.fromPeriod || filters.toPeriod) {
      filterText += `Period: ${filters.fromPeriod || 'All'} to ${filters.toPeriod || 'All'}`;
    }
    if (filters.emplId) filterText += ` | Employee: ${filters.emplId}`;
    if (filters.createdBy) filterText += ` | Operator: ${filters.createdBy}`;
    if (filters.payType) filterText += ` | Pay Type: ${filters.payType}`;
    
    filterCell.value = filterText;
    filterCell.font = { size: 11, italic: true };
    filterCell.alignment = { horizontal: 'center' };
    filterCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    // Statistics row
    worksheet.mergeCells('A3:P3');
    const statsCell = worksheet.getCell('A3');
    statsCell.value = `Records: ${statistics.total_records} | Employees: ${statistics.total_employees} | Periods: ${statistics.total_periods} | Pay Elements: ${statistics.total_pay_elements}`;
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
      { header: 'Pay Period', key: 'pay_period', width: 12 },
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Title', key: 'title', width: 10 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Pay Element', key: 'pay_element_type', width: 12 },
      { header: 'Description', key: 'pay_element_description', width: 35 },
      { header: 'MAK1', key: 'mak1', width: 10 },
      { header: 'Amount Primary', key: 'amount_primary', width: 16 },
      { header: 'MAK2', key: 'mak2', width: 10 },
      { header: 'Amount Secondary', key: 'amount_secondary', width: 16 },
      { header: 'Amount Additional', key: 'amount_additional', width: 16 },
      { header: 'Amount To Date', key: 'amount_to_date', width: 16 },
      { header: 'Pay Indicator', key: 'payment_indicator', width: 12 },
      { header: 'No. of Months', key: 'number_of_months', width: 12 }
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

      // Highlight high amounts
      if (parseFloat(row.amount_primary) > 1000000) {
        addedRow.getCell('H').font = { bold: true, color: { argb: 'FF006100' } };
      }
    });

    // Format currency columns
    ['H', 'J', 'K', 'L'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
      worksheet.getColumn(col).alignment = { horizontal: 'right' };
    });

    // Add grand totals
    const totalRow = worksheet.lastRow.number + 2;
    worksheet.getCell(`G${totalRow}`).value = 'GRAND TOTALS:';
    worksheet.getCell(`G${totalRow}`).font = { bold: true, size: 11 };
    worksheet.getCell(`G${totalRow}`).alignment = { horizontal: 'right' };

    ['H', 'J', 'K', 'L'].forEach(col => {
      worksheet.getCell(`${col}${totalRow}`).value = {
        formula: `SUM(${col}6:${col}${totalRow - 2})`
      };
      worksheet.getCell(`${col}${totalRow}`).font = { bold: true, size: 11 };
      worksheet.getCell(`${col}${totalRow}`).numFmt = '₦#,##0.00';
      worksheet.getCell(`${col}${totalRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };
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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=pay_period_report_${filters.fromPeriod || 'all'}_${filters.toPeriod || 'all'}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // PDF GENERATION
  // ==========================================================================
  async generatePayPeriodReportPDF(data, req, res, filters, statistics) {
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

      console.log('Pay Period Report PDF - Data rows:', data.length);

      const templatePath = path.join(__dirname, '../../templates/variation-input-listing.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Format filter description
      let filterDescription = '';
      if (filters.fromPeriod || filters.toPeriod) {
        filterDescription += `Period: ${payPeriodReportService.formatPeriod(filters.fromPeriod) || 'All'} to ${payPeriodReportService.formatPeriod(filters.toPeriod) || 'All'}`;
      }
      if (filters.emplId) filterDescription += ` | Employee: ${filters.emplId}`;
      if (filters.createdBy) filterDescription += ` | Operator: ${filters.createdBy}`;
      if (filters.payType) filterDescription += ` | Pay Type: ${filters.payType}`;

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
          className: this.getDatabaseNameFromRequest(req),
          fromPeriod: payPeriodReportService.formatPeriod(filters.fromPeriod),
          toPeriod: payPeriodReportService.formatPeriod(filters.toPeriod)
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=pay_period_report_${filters.fromPeriod || 'all'}_${filters.toPeriod || 'all'}.pdf`
      );
      res.send(result.content);

    } catch (error) {
      console.error('Pay Period Report PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getPayPeriodFilterOptions(req, res) {
    try {
      const [payPeriods, payTypes, operators, employees, currentPeriod] = await Promise.all([
        payPeriodReportService.getAvailablePayPeriods(),
        payPeriodReportService.getAvailablePayTypes(),
        payPeriodReportService.getAvailableOperators(),
        payPeriodReportService.getAvailableEmployees(),
        payPeriodReportService.getCurrentPeriod()
      ]);

      res.json({
        success: true,
        data: {
          payPeriods,
          payTypes,
          operators,
          employees,
          currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting Pay Period filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(month) - 1] || '';
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

module.exports = new PayPeriodReportController();