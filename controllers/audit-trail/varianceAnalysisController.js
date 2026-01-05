const varianceAnalysisService = require('../../services/audit-trail/varianceAnalysisService');
const ExcelJS = require('exceljs');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class VarianceAnalysisController {

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
      console.log('✅ JSReport initialized for Variance Analysis Reports');
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

      function isNegative(value) {
        return parseFloat(value) < 0;
      }
      
      function abs(value) {
        return Math.abs(parseFloat(value) || 0);
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
  // SALARY VARIANCE ANALYSIS - MAIN ENDPOINT
  // ==========================================================================
  async generateSalaryVarianceReport(req, res) {
    try {
      const { format, period, payTypes } = req.query;
      
      const filters = { period, payTypes };
      
      console.log('Salary Variance Report Filters:', filters);
      
      const result = await varianceAnalysisService.getSalaryVarianceAnalysis(filters);
      
      if (!result.success) {
        return res.status(400).json(result);
      }
      
      console.log('Salary Variance Report Data rows:', result.data.length);

      if (format === 'excel') {
        return this.generateSalaryVarianceExcel(result, res);
      } else if (format === 'pdf') {
        return this.generateSalaryVariancePDF(result, req, res);
      }

      res.json(result);
    } catch (error) {
      console.error('Error generating Salary Variance report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // OVERPAYMENT ANALYSIS - MAIN ENDPOINT
  // ==========================================================================
  async generateOverpaymentReport(req, res) {
    try {
      const { format, period } = req.query;
      
      console.log('📥 Request query params:', { format, period });
      
      // Convert period to month number
      const month = parseInt(period);
      
      console.log('📊 Converted month:', month);
      
      const filters = { month };
      
      console.log('Overpayment Report Filters:', filters);
      
      const result = await varianceAnalysisService.getOverpaymentAnalysis(filters);
      
      console.log('📊 Service returned:', {
        success: result.success,
        message: result.message,
        dataLength: result.data?.length,
        month: result.month,
        monthName: result.monthName
      });
      
      if (!result.success) {
        return res.status(400).json(result);
      }
      
      console.log('Overpayment Report Data rows:', result.data.length);

      if (format === 'excel') {
        return this.generateOverpaymentExcel(result, res);
      } else if (format === 'pdf') {
        console.log('🔄 Starting PDF generation...');
        return this.generateOverpaymentPDF(result, req, res);
      }

      res.json(result);
    } catch (error) {
      console.error('❌ Error generating Overpayment report:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // SALARY VARIANCE - EXCEL GENERATION
  // ==========================================================================
  async generateSalaryVarianceExcel(result, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Salary Variance Analysis');
    const data = result.data;

    // Title
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - SALARY VARIANCE ANALYSIS';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Period info
    worksheet.mergeCells('A2:G2');
    const periodCell = worksheet.getCell('A2');
    periodCell.value = `Period: ${varianceAnalysisService.formatPeriod(result.period)} | ${result.comparisonInfo}`;
    periodCell.font = { size: 11, italic: true };
    periodCell.alignment = { horizontal: 'center' };
    periodCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    worksheet.addRow([]);

    // Define columns
    worksheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Title', key: 'title', width: 10 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Pay Type', key: 'pay_type', width: 12 },
      { header: 'Description', key: 'pay_type_description', width: 30 },
      { header: 'Old Amount', key: 'old_amount', width: 16 },
      { header: 'New Amount', key: 'new_amount', width: 16 },
      { header: 'Variance', key: 'variance', width: 16 }
    ];

    // Style header row
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data with conditional formatting
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

      // Highlight negative variance in red
      const varianceCell = addedRow.getCell('H');
      if (parseFloat(row.variance) < 0) {
        varianceCell.font = { color: { argb: 'FFFF0000' }, bold: true };
        varianceCell.value = `(${Math.abs(row.variance).toFixed(2)})`;
      }
    });

    // Format currency columns
    ['F', 'G', 'H'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
      worksheet.getColumn(col).alignment = { horizontal: 'right' };
    });

    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
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
    res.setHeader('Content-Disposition', `attachment; filename=salary_variance_${result.period}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // OVERPAYMENT - EXCEL GENERATION
  // ==========================================================================
  async generateOverpaymentExcel(result, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Overpayment Analysis');
    const data = result.data;

    // Title
    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - OVERPAYMENT ANALYSIS';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };

    // Info row
    worksheet.mergeCells('A2:H2');
    const infoCell = worksheet.getCell('A2');
    infoCell.value = `Period: ${varianceAnalysisService.formatPeriod(result.period)} | Threshold: ${result.threshold_percentage}% | Pay Element: ${result.pay_element}`;
    infoCell.font = { size: 11, italic: true };
    infoCell.alignment = { horizontal: 'center' };
    infoCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' }
    };

    worksheet.addRow([]);

    // Define columns
    worksheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Title', key: 'title', width: 10 },
      { header: 'Full Name', key: 'full_name', width: 30 },
      { header: 'Pay Element', key: 'pay_element_description', width: 25 },
      { header: 'Previous Net', key: 'previous_net', width: 16 },
      { header: 'Current Net', key: 'current_net', width: 16 },
      { header: 'Variance Amount', key: 'variance_amount', width: 16 },
      { header: 'Variance %', key: 'variance_percentage', width: 12 }
    ];

    // Style header row
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDC143C' }
    };
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data with highlighting
    data.forEach((row, index) => {
      const addedRow = worksheet.addRow(row);

      // Alternate row colors
      if (index % 2 === 0) {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF0F0' }
        };
      }

      // Highlight high variance percentage
      if (parseFloat(row.variance_percentage) > result.threshold_percentage * 2) {
        addedRow.getCell('H').font = { color: { argb: 'FFFF0000' }, bold: true };
      }
    });

    // Format currency columns
    ['E', 'F', 'G'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
      worksheet.getColumn(col).alignment = { horizontal: 'right' };
    });

    // Format percentage column
    worksheet.getColumn('H').numFmt = '0.00"%"';
    worksheet.getColumn('H').alignment = { horizontal: 'right' };

    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
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
    res.setHeader('Content-Disposition', `attachment; filename=overpayment_analysis_${result.period}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // SALARY VARIANCE - PDF GENERATION
  // ==========================================================================
  async generateSalaryVariancePDF(result, req, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/salary-variance.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const pdfResult = await jsreport.render({
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
          data: result.data,
          reportDate: new Date(),
          period: varianceAnalysisService.formatPeriod(result.period),
          comparisonInfo: result.comparisonInfo,
          className: this.getDatabaseNameFromRequest(req)
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=salary_variance_${result.period}.pdf`);
      res.send(pdfResult.content);

    } catch (error) {
      console.error('Salary Variance PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // OVERPAYMENT - PDF GENERATION
  // ==========================================================================
  async generateOverpaymentPDF(result, req, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/overpayment-analysis.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const pdfResult = await jsreport.render({
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
          data: result.data,
          reportDate: new Date(),
          period: result.monthName,
          threshold: result.threshold_percentage,
          payElement: result.pay_element,
          className: this.getDatabaseNameFromRequest(req)
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=overpayment_analysis_${result.period}.pdf`);
      res.send(pdfResult.content);

    } catch (error) {
      console.error('Overpayment PDF generation error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS
  // ==========================================================================
  async getFilterOptions(req, res) {
    try {
      const [currentPeriod, payTypes, periods] = await Promise.all([
        varianceAnalysisService.getCurrentPeriod(),
        varianceAnalysisService.getAvailablePayTypes(),
        varianceAnalysisService.getAvailablePeriods()
      ]);

      res.json({
        success: true,
        data: {
          periods: periods.data,
          payTypes: payTypes,
          currentPeriod: currentPeriod
        }
      });
    } catch (error) {
      console.error('Error getting filter options:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTION
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

module.exports = new VarianceAnalysisController();