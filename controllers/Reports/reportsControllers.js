const reportService = require('../../services/Reports/reportServices');
const payslipGenService = require('../../services/Reports/payslipGenerationService');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const jsreport = require('jsreport-core')();
const fs = require('fs');
const path = require('path');

class ReportController {

  constructor() {
    // Initialize JSReport once when controller is created
    this.jsreportReady = false;
    this.initJSReport();
  }

  async initJSReport() {
    try {
      // Register extensions before initializing
      jsreport.use(require('jsreport-handlebars')());
      jsreport.use(require('jsreport-chrome-pdf')());
      
      await jsreport.init();
      this.jsreportReady = true;
      console.log('✅ JSReport initialized successfully');
    } catch (error) {
      console.error('JSReport initialization failed:', error);
    }
  }

  // Helper method to return common Handlebars helpers
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
      
      function subtract(a, b) {
        return (parseFloat(a) || 0) - (parseFloat(b) || 0);
      }
      
      function eq(a, b) {
        return a === b;
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
  // IMPROVED DATA MAPPING FOR PAYSLIPS 
  // ==========================================================================
  _mapPayslipData(rawData) {
    return rawData.map(employee => {
      // Initialize totals
      let totalEarnings = 0;
      let totalDeductions = 0;

      // Separate payments by category
      const earnings = [];
      const deductions = [];

      if (Array.isArray(employee.payments)) {
        employee.payments.forEach(p => {
          const amount = parseFloat(p.amount) || 0;
          
          if (p.category_code === 'BP' || p.category_code === 'BT') {
            // Taxable payments (earnings)
            earnings.push({
              description: p.payment_desc,
              amount: amount,
              type: 'Taxable'
            });
            totalEarnings += amount;
          } else if (p.category_code === 'PT') {
            // Non-taxable payments (earnings)
            earnings.push({
              description: p.payment_desc,
              amount: amount,
              type: 'Non-Taxable'
            });
            totalEarnings += amount;
          } else if (p.category_code === 'PR' || p.category_code === 'PL') {
            // Deductions
            deductions.push({
              description: p.payment_desc,
              amount: amount,
              loan_balance: p.loan_balance || 0,
              is_loan: (p.loan_balance > 0 || p.loan > 0)
            });
            totalDeductions += amount;
          }
        });
      }

      const currentTax = parseFloat(employee.currtax) || 0;
      if (currentTax > 0) {
        deductions.push({
          description: 'PAYE Tax',
          amount: currentTax,
          loan_balance: 0,
          is_loan: false
        });
        totalDeductions += currentTax;
      }

      const netPay = totalEarnings - totalDeductions;

      return {
        // Employee Info
        employee_id: employee.employee_id,
        title: employee.title || '',
        surname: employee.surname || '',
        othername: employee.othername || '',
        empl_name: `${employee.surname || ''} ${employee.othername || ''}`.trim(),
        
        // Job Info
        gradelevel: employee.gradelevel || '',
        gradetype: employee.gradetype || '',
        department: employee.location || '',
        factory: employee.factory || '',
        
        // Bank Info
        bank_name: employee.bankname || '',
        bank_account_number: employee.bankacnumber || '',
        
        // Period Info
        payroll_year: employee.year,
        payroll_month: employee.month_desc,
        
        // Payment Details
        earnings: earnings,
        deductions: deductions,
        total_earnings: totalEarnings,
        total_deductions: totalDeductions,
        net_pay: netPay,
        
        // YTD Info
        ytd_gross: parseFloat(employee.grstodate) || 0,
        ytd_tax: parseFloat(employee.taxtodate) || 0,
        ytd_taxable: parseFloat(employee.txbltodate) || 0,
        
        // Additional Info
        nsitf: employee.nsitf || '',
        nsitfcode: employee.nsitfcode || '',
        email: employee.email || '',
        payclass: employee.payclass || '',
        payclass_name: employee.payclass_name || ''
      };
    });
  }

  // ==========================================================================
  // GENERATE PAYSLIPS (JSON RESPONSE)
  // ==========================================================================
  async generatePayslips(req, res) {
    const {
      empno1, empno2, branch, optall, optrange, optbank, optloc, optindividual, wxdate
    } = req.query;

    const station = req.user_fullname;

    if (!station) {
      return res.status(401).json({
        success: false,
        error: "User authentication required. Please log in again."
      });
    }

    const params = {
      empno1, empno2, branch, optall, optrange, optbank, optloc, optindividual, wxdate, station
    };

    try {
      // Generate temporary payslip records
      const generationResult = await payslipGenService.generatePayslips(params);

      if (!generationResult.success) {
        return res.status(400).json(generationResult);
      }

      // Retrieve and group generated payslip records
      const rawPayslips = await payslipGenService.getPayslipsGroupedByEmployee(station);
      
      // Map to clean format
      const data = this._mapPayslipData(rawPayslips);

      return res.json({
        success: true,
        message: generationResult.message,
        data: data
      });

    } catch (error) {
      console.error('Payslip generation API error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || "An unexpected error occurred during payslip generation." 
      });
    }
  }

  // ==========================================================================
  // GENERATE PAYSLIP PDF - JSREPORT VERSION
  // ==========================================================================
  async generatePayslipPDFEnhanced(req, res) {
      const mappedData = req.body.data || [];

      if (mappedData.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: "No payslip data provided for PDF generation." 
        });
      }

      if (!this.jsreportReady) {
        return res.status(500).json({
          success: false,
          error: "Enhanced PDF generation service not ready. Please try again."
        });
      }

      try {
        const templatePath = path.join(__dirname, '../../templates/payslip-template.html');
        const templateContent = fs.readFileSync(templatePath, 'utf8');

        const result = await jsreport.render({
          template: {
            content: templateContent,
            engine: 'handlebars',
            recipe: 'chrome-pdf',
            chrome: {
              displayHeaderFooter: false,
              printBackground: true,
              format: 'A5'
            },
            helpers: `
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
              
              function add(a, b) {
                return (parseFloat(a) || 0) + (parseFloat(b) || 0);
              }
              
              function subtract(a, b) {
                return (parseFloat(a) || 0) - (parseFloat(b) || 0);
              }
              
              function eq(a, b) {
                return a === b;
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
            `
          },
          data: {
            employees: mappedData,
            payDate: new Date()
          }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=payslips_enhanced.pdf');
        res.send(result.content);

      } catch (error) {
        console.error('JSReport PDF generation error:', error);
        return res.status(500).json({ 
          success: false, 
          error: error.message || "An error occurred during PDF generation." 
        });
      }
    }

  // ==========================================================================
  // GENERATE PAYSLIP EXCEL
  // ==========================================================================
  async generatePayslipExcel(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "No payslip data provided for Excel generation." 
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payslips');
    
    // Define columns
    worksheet.columns = [
      { header: 'Service No', key: 'employee_id', width: 15 },
      { header: 'Name', key: 'empl_name', width: 30 },
      { header: 'Grade', key: 'gradelevel', width: 10 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Total Earnings', key: 'total_earnings', width: 15 },
      { header: 'Total Deductions', key: 'total_deductions', width: 18 },
      { header: 'Net Pay', key: 'net_pay', width: 15 },
      { header: 'Bank', key: 'bank_name', width: 20 },
      { header: 'Account Number', key: 'bank_account_number', width: 20 },
      { header: 'YTD Gross', key: 'ytd_gross', width: 15 },
      { header: 'YTD Tax', key: 'ytd_tax', width: 15 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data
    mappedData.forEach(row => {
      worksheet.addRow(row);
    });

    // Format currency columns
    ['E', 'F', 'G', 'J', 'K'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
    });

    // Add totals row
    const lastDataRow = worksheet.lastRow.number;
    const totalRowIndex = lastDataRow + 2;
    worksheet.getCell(`D${totalRowIndex}`).value = 'TOTALS:';
    worksheet.getCell(`D${totalRowIndex}`).font = { bold: true };
    
    ['E', 'F', 'G'].forEach(col => {
      worksheet.getCell(`${col}${totalRowIndex}`).value = {
        formula: `SUM(${col}2:${col}${lastDataRow})`
      };
      worksheet.getCell(`${col}${totalRowIndex}`).font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payslips.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }


  // ==========================================================================
  // REPORT 2: PAYMENTS BY BANK
  // ==========================================================================
  async generatePaymentsByBank(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getPaymentsByBank(filters);

      if (format === 'excel') {
        return this.generatePaymentsByBankExcel(data, filters, res);
      } else if (format === 'pdf') {
        return this.generatePaymentsByBankPDF(data, filters, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsByBankExcel(data, filters, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments by Bank');

    if (filters.summaryOnly) {
      // Summary columns
      worksheet.columns = [
        { header: 'Bank Code', key: 'Bankcode', width: 15 },
        { header: 'Branch', key: 'bankbranch', width: 25 },
        { header: 'Total Employees', key: 'employee_count', width: 18 },
        { header: 'Total Net Payment', key: 'total_net', width: 20 }
      ];

      // Add data
      data.forEach(row => {
        worksheet.addRow(row);
      });

      // Format currency for column D
      worksheet.getColumn('D').numFmt = '₦#,##0.00';
    } else {
      // Detailed columns
      worksheet.columns = [
        { header: 'Bank Code', key: 'Bankcode', width: 15 },
        { header: 'Branch', key: 'bankbranch', width: 25 },
        { header: 'Employee ID', key: 'empl_id', width: 15 },
        { header: 'Full Name', key: 'fullname', width: 30 },
        { header: 'Net Payment', key: 'total_net', width: 18 },
        { header: 'Account Number', key: 'BankACNumber', width: 20 }
      ];

      // Add data
      data.forEach(row => {
        worksheet.addRow(row);
      });

      // Format currency for column E
      worksheet.getColumn('E').numFmt = '₦#,##0.00';
    }

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2c5aa0' }
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generatePaymentsByBankPDF(data, filters, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/payments-by-bank.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Get user's full name from request
      //const generatedBy = req.user_fullname || 'System';

      // Prepare data based on summary or detailed view
      let templateData = {
        reportDate: new Date(),
        //generatedBy: generatedBy,
        isSummary: filters.summaryOnly === 'true' || filters.summaryOnly === true,
        reportTitle: filters.summaryOnly ? 'Summary Report' : 'Detailed Report'
      };

      if (templateData.isSummary) {
        // For summary, pass data as-is
        templateData.data = data;
      } else {
        // For detailed, group by bank and branch
        const bankGroups = {};
        
        data.forEach(row => {
          const key = `${row.Bankcode}_${row.bankbranch}`;
          
          if (!bankGroups[key]) {
            bankGroups[key] = {
              bankName: row.Bankcode,
              branch: row.bankbranch,
              employees: [],
              totalAmount: 0,
              employeeCount: 0
            };
          }
          
          bankGroups[key].employees.push({
            empl_id: row.empl_id,
            fullname: row.fullname,
            rank: row.rank,
            total_net: parseFloat(row.total_net || 0),
            BankACNumber: row.BankACNumber
          });
          
          bankGroups[key].totalAmount += parseFloat(row.total_net || 0);
          bankGroups[key].employeeCount++;
        });
        
        templateData.bankGroups = Object.values(bankGroups);
      }

      const result = await jsreport.render({
        template: {
          content: templateContent,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            displayHeaderFooter: false,
            printBackground: true,
            format: 'A4',
            landscape: true
          },
          helpers: this._getCommonHelpers()
        },
        data: templateData
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank.pdf');
      res.send(result.content);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 3: EARNINGS/DEDUCTIONS ANALYSIS
  // ==========================================================================
  async generateEarningsDeductionsAnalysis(req, res) {
    try {
      const { format, summary, payment_type, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        paymentType: payment_type
      };
      
      console.log('Filters:', filters); // DEBUG
      
      const data = await reportService.getEarningsDeductionsAnalysis(filters);
      
      console.log('Data rows:', data.length); // DEBUG
      console.log('Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generateEarningsDeductionsAnalysisExcel(data, res);
      } else if (format === 'pdf') {
        return this.generateEarningsDeductionsAnalysisPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating earnings analysis:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateEarningsDeductionsAnalysisExcel(data, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Earnings & Deductions');

    worksheet.columns = [
      { header: 'Payment Code', key: 'payment_code', width: 15 },
      { header: 'Description', key: 'payment_description', width: 35 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Employee Count', key: 'employee_count', width: 15 },
      { header: 'Total Amount', key: 'total_amount', width: 18 },
      { header: 'Average Amount', key: 'average_amount', width: 18 },
      { header: 'Min Amount', key: 'min_amount', width: 15 },
      { header: 'Max Amount', key: 'max_amount', width: 15 }
    ];

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Group by category
    const categories = {};
    data.forEach(row => {
      if (!categories[row.category]) categories[row.category] = [];
      categories[row.category].push(row);
    });

    // Add data with category separators
    Object.keys(categories).forEach((category, index) => {
      if (index > 0) worksheet.addRow([]);
      
      // Category header
      const headerRow = worksheet.addRow([category]);
      headerRow.font = { bold: true, size: 12 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
      worksheet.mergeCells(headerRow.number, 1, headerRow.number, 8);

      // Add category data
      categories[category].forEach(row => {
        worksheet.addRow(row);
      });
    });

    // Format currency
    ['E', 'F', 'G', 'H'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=earnings_deductions_analysis.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generateEarningsDeductionsAnalysisPDF(data, res) {
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

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('his_empno');
      
      console.log('Is Summary:', isSummary);
      console.log('Data rows:', data.length);
      
      // Group data by category
      const categoriesMap = {};
      
      data.forEach(row => {
        const category = row.category || 'Other';
        const paymentCode = row.payment_code;
        
        // Initialize category if it doesn't exist
        if (!categoriesMap[category]) {
          categoriesMap[category] = {
            categoryName: category,
            paymentTypesMap: {},
            categoryTotal: 0
          };
        }
        
        // Initialize payment type if it doesn't exist
        if (!categoriesMap[category].paymentTypesMap[paymentCode]) {
          categoriesMap[category].paymentTypesMap[paymentCode] = {
            payment_code: paymentCode,
            payment_description: row.payment_description || paymentCode,
            employees: [],
            subtotal: 0,
            employee_count: 0
          };
        }
        
        if (isSummary) {
          // Summary mode
          const amount = parseFloat(row.total_amount || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].employee_count = parseInt(row.employee_count || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].subtotal = amount;
          categoriesMap[category].categoryTotal += amount;
        } else {
          // Detailed mode - add individual employee
          const amount = parseFloat(row.total_amount || 0);
          categoriesMap[category].paymentTypesMap[paymentCode].employees.push({
            his_empno: row.his_empno,
            fullname: row.fullname || 'N/A',
            total_amount: amount
          });
          categoriesMap[category].paymentTypesMap[paymentCode].subtotal += amount;
          categoriesMap[category].paymentTypesMap[paymentCode].employee_count++;
          categoriesMap[category].categoryTotal += amount;
        }
      });
      
      // Convert to array format for template
      const categories = Object.values(categoriesMap).map(cat => {
        if (isSummary) {
          return {
            categoryName: cat.categoryName,
            items: Object.values(cat.paymentTypesMap),
            categoryTotal: cat.categoryTotal
          };
        } else {
          return {
            categoryName: cat.categoryName,
            paymentTypes: Object.values(cat.paymentTypesMap),
            categoryTotal: cat.categoryTotal
          };
        }
      });
      
      console.log('Categories processed:', categories.length);
      console.log('First category structure:', JSON.stringify(categories[0], null, 2));

      const templatePath = path.join(__dirname, '../../templates/earnings-deductions.html');
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
            landscape: !isSummary
          },
          helpers: `
            function formatDate(date) {
              return new Date(date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            }
            
            function formatCurrency(amount) {
              return parseFloat(amount || 0).toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
            }
          `
        },
        data: {
          categories: categories,
          reportDate: new Date(),
          month: data[0]?.month || 'N/A',
          year: data[0]?.year || 'N/A',
          isSummary: isSummary
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=earnings-deductions-${data[0]?.month}-${data[0]?.year}.pdf`);
      res.send(result.content);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 4: LOAN ANALYSIS
  // ==========================================================================
  async generateLoanAnalysis(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getLoanAnalysis(filters);

      if (format === 'excel') {
        return this.generateLoanAnalysisExcel(data, res);
      } else if (format === 'pdf') {
        return this.generateLoanAnalysisPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating loan analysis:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateLoanAnalysisExcel(data, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Loan Analysis');

    worksheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 15 },
      { header: 'Name', key: 'empl_name', width: 30 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Loan Type', key: 'loan_type', width: 12 },
      { header: 'Description', key: 'loan_description', width: 30 },
      { header: 'Original Loan', key: 'original_loan', width: 18 },
      { header: 'Total Paid', key: 'total_paid', width: 18 },
      { header: 'Outstanding', key: 'outstanding_balance', width: 18 },
      { header: 'Months Remaining', key: 'months_remaining', width: 15 },
      { header: 'Monthly Payment', key: 'this_month_payment', width: 18 },
      { header: 'Interest Rate %', key: 'annual_interest_rate', width: 15 },
      { header: 'Monthly Interest', key: 'monthly_interest', width: 18 },
      { header: '% Paid', key: 'percent_paid', width: 12 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data with color coding by status
    data.forEach(row => {
      const addedRow = worksheet.addRow(row);
      
      // Color code by status
      if (row.status === 'COMPLETED') {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD4EDDA' } // Green
        };
      } else if (row.status === 'OVERPAID') {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8D7DA' } // Red
        };
      } else if (row.status === 'FINAL MONTHS') {
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3CD' } // Yellow
        };
      }
    });

    // Format currency
    ['F', 'G', 'H', 'J', 'L'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
    });

    // Format percentages
    ['K', 'M'].forEach(col => {
      worksheet.getColumn(col).numFmt = '0.00"%"';
    });

    // Add summary
    const lastRow = worksheet.lastRow.number + 2;
    worksheet.getCell(`E${lastRow}`).value = 'TOTALS:';
    worksheet.getCell(`E${lastRow}`).font = { bold: true };
    
    ['F', 'G', 'H', 'J', 'L'].forEach(col => {
      worksheet.getCell(`${col}${lastRow}`).value = {
        formula: `SUM(${col}2:${col}${lastRow - 2})`
      };
      worksheet.getCell(`${col}${lastRow}`).font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=loan_analysis.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generateLoanAnalysisPDF(data, res) {
    if (!this.jsreportReady) {
      return res.status(500).json({
        success: false,
        error: "PDF generation service not ready."
      });
    }

    try {
      const templatePath = path.join(__dirname, '../../templates/loan-analysis.html');
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
            landscape: true
          },
          helpers: `
            ${this._getCommonHelpers()}
            
            function getStatusClass(status) {
              if (status === 'COMPLETED') return 'status-completed';
              if (status === 'OVERPAID') return 'status-overpaid';
              if (status === 'FINAL MONTHS') return 'status-active';
              return '';
            }
          `
        },
        data: {
          data: data,
          reportDate: new Date()
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=loan_analysis.pdf');
      res.send(result.content);

    } catch (error) {
      console.error('PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 5: PAYMENTS/DEDUCTIONS BY BANK
  // ==========================================================================
  async generatePaymentsDeductionsByBank(req, res) {
    try {
      const { format, summary, payment_type, bank_name, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        paymentType: payment_type,
        bankName: bank_name
      };
      
      console.log('Bank Report Filters:', filters); // DEBUG
      
      const data = await reportService.getPaymentsDeductionsByBank(filters);
      
      console.log('Bank Data rows:', data.length); // DEBUG
      console.log('Bank Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generatePaymentsDeductionsByBankExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generatePaymentsDeductionsByBankPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsDeductionsByBankExcel(data, res, isSummary = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments by Bank');

    // Define columns based on summary mode
    if (isSummary) {
      worksheet.columns = [
        { header: 'Bank', key: 'Bankcode', width: 25 },
        { header: 'Branch', key: 'bankbranch', width: 20 },
        { header: 'Payment Code', key: 'payment_code', width: 15 },
        { header: 'Description', key: 'payment_description', width: 35 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Employee Count', key: 'employee_count', width: 15 },
        { header: 'Total Amount', key: 'total_amount', width: 18 }
      ];
    } else {
      worksheet.columns = [
        { header: 'Bank', key: 'Bankcode', width: 25 },
        { header: 'Branch', key: 'bankbranch', width: 20 },
        { header: 'Employee No', key: 'his_empno', width: 15 },
        { header: 'Employee Name', key: 'Surname', width: 25 },
        { header: 'Payment Code', key: 'payment_code', width: 15 },
        { header: 'Description', key: 'payment_description', width: 35 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Total Amount', key: 'total_amount', width: 18 }
      ];
    }

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Group by bank
    const banks = {};
    data.forEach(row => {
      const bankKey = `${row.Bankcode || 'Unknown'} - ${row.bankbranch || 'Unknown'}`;
      if (!banks[bankKey]) banks[bankKey] = [];
      banks[bankKey].push(row);
    });

    // Add data with bank separators
    Object.keys(banks).forEach((bank, index) => {
      if (index > 0) worksheet.addRow([]);
      
      // Bank header
      const headerRow = worksheet.addRow([bank]);
      headerRow.font = { bold: true, size: 12 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' }
      };
      const maxCol = isSummary ? 7 : 8;
      worksheet.mergeCells(headerRow.number, 1, headerRow.number, maxCol);

      // Add bank data
      banks[bank].forEach(row => {
        worksheet.addRow(row);
      });

      // Bank subtotal
      const subtotalRow = worksheet.lastRow.number + 1;
      const amountCol = isSummary ? 'G' : 'H';
      const labelCol = isSummary ? 'E' : 'F';
      
      worksheet.getCell(`${labelCol}${subtotalRow}`).value = 'Bank Subtotal:';
      worksheet.getCell(`${labelCol}${subtotalRow}`).font = { bold: true };
      worksheet.getCell(`${amountCol}${subtotalRow}`).value = {
        formula: `SUBTOTAL(9,${amountCol}${headerRow.number + 1}:${amountCol}${subtotalRow - 1})`
      };
      worksheet.getCell(`${amountCol}${subtotalRow}`).font = { bold: true };
    });

    // Format currency
    const currencyCol = isSummary ? 'G' : 'H';
    worksheet.getColumn(currencyCol).numFmt = '₦#,##0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generatePaymentsDeductionsByBankPDF(data, res) {
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

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('his_empno');
      
      console.log('Bank PDF - Is Summary:', isSummary);
      console.log('Bank PDF - Data rows:', data.length);
      
      // Group data by bank, then category
      const banksMap = {};
      
      data.forEach(row => {
        const bankKey = `${row.Bankcode || 'Unknown'} - ${row.bankbranch || 'Unknown'}`;
        const category = row.category || 'Other';
        const paymentCode = row.payment_code;
        
        // Initialize bank if it doesn't exist
        if (!banksMap[bankKey]) {
          banksMap[bankKey] = {
            bankName: row.Bankcode || 'Unknown',
            bankBranch: row.bankbranch || 'Unknown',
            categoriesMap: {},
            bankTotal: 0
          };
        }
        
        // Initialize category if it doesn't exist
        if (!banksMap[bankKey].categoriesMap[category]) {
          banksMap[bankKey].categoriesMap[category] = {
            categoryName: category,
            paymentTypesMap: {},
            categoryTotal: 0
          };
        }
        
        // Initialize payment type if it doesn't exist
        if (!banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode]) {
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode] = {
            payment_code: paymentCode,
            payment_description: row.payment_description || paymentCode,
            employees: [],
            subtotal: 0,
            employee_count: 0
          };
        }
        
        // Determine if this is a deduction (to be subtracted)
        const isDeduction = category === 'Deduction' || category === 'Loan';
        const rawAmount = parseFloat(row.total_amount || 0);
        const amount = isDeduction ? -Math.abs(rawAmount) : rawAmount;
        
        if (isSummary) {
          // Summary mode
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employee_count = parseInt(row.employee_count || 0);
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].subtotal = rawAmount; // Store positive for display
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].isDeduction = isDeduction;
          banksMap[bankKey].categoriesMap[category].categoryTotal += amount; // Use signed amount for total
          banksMap[bankKey].bankTotal += amount;
        } else {
          // Detailed mode - add individual employee
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employees.push({
            his_empno: row.his_empno,
            fullname: row.Surname || 'N/A',
            total_amount: rawAmount // Store positive for display
          });
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].subtotal += rawAmount; // Store positive for display
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].employee_count++;
          banksMap[bankKey].categoriesMap[category].paymentTypesMap[paymentCode].isDeduction = isDeduction;
          banksMap[bankKey].categoriesMap[category].categoryTotal += amount; // Use signed amount for total
          banksMap[bankKey].bankTotal += amount;
        }
      });
      
      // Convert to array format for template
      const banks = Object.values(banksMap).map(bank => {
        const categories = Object.values(bank.categoriesMap).map(cat => {
          if (isSummary) {
            return {
              categoryName: cat.categoryName,
              items: Object.values(cat.paymentTypesMap),
              categoryTotal: cat.categoryTotal
            };
          } else {
            return {
              categoryName: cat.categoryName,
              paymentTypes: Object.values(cat.paymentTypesMap),
              categoryTotal: cat.categoryTotal
            };
          }
        });
        
        return {
          bankName: bank.bankName,
          bankBranch: bank.bankBranch,
          categories: categories,
          bankTotal: bank.bankTotal
        };
      });
      
      console.log('Banks processed:', banks.length);
      console.log('First bank structure:', JSON.stringify(banks[0], null, 2));

      const templatePath = path.join(__dirname, '../../templates/payded-by-bank.html');
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
            landscape: !isSummary
          },
          helpers: `
            function formatDate(date) {
              return new Date(date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            }
            
            function formatCurrency(amount) {
              return parseFloat(amount || 0).toLocaleString('en-NG', {
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
          `
        },
        data: {
          banks: banks,
          reportDate: new Date(),
          month: data[0]?.month || 'N/A',
          year: data[0]?.year || 'N/A',
          isSummary: isSummary
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=payments-by-bank-${data[0]?.month}-${data[0]?.year}.pdf`);
      res.send(result.content);

    } catch (error) {
      console.error('Bank PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 6: PAYROLL REGISTER
  // ==========================================================================
  async generatePayrollRegister(req, res) {
    try {
      const { format, summary, include_elements, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        includeElements: include_elements === '1' || include_elements === 'true'
      };
      
      console.log('Payroll Register Filters:', filters); // DEBUG
      
      const data = await reportService.getPayrollRegister(filters);
      
      console.log('Payroll Register Data rows:', data.length); // DEBUG
      console.log('Payroll Register Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generatePayrollRegisterExcel(data, res, filters.summaryOnly, filters.includeElements);
      } else if (format === 'pdf') {
        return this.generatePayrollRegisterPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payroll register:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePayrollRegisterExcel(data, res, isSummary = false, includeElements = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payroll Register');

    // Title
    const titleColspan = isSummary ? 'A1:H1' : (includeElements ? 'A1:K1' : 'A1:J1');
    worksheet.mergeCells(titleColspan);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - PAYROLL REGISTER';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Period info
    if (data.length > 0) {
      worksheet.mergeCells(titleColspan.replace('1', '2'));
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `Period: ${this.getMonthName(data[0].month)} ${data[0].year}`;
      periodCell.font = { size: 12 };
      periodCell.alignment = { horizontal: 'center' };
    }

    worksheet.addRow([]);

    // Define columns based on mode
    if (isSummary) {
      worksheet.columns = [
        { header: 'Location', key: 'location', width: 30 },
        { header: 'Employee Count', key: 'employee_count', width: 18 },
        { header: 'Gross Pay', key: 'gross_pay', width: 18 },
        { header: 'Total Emoluments', key: 'total_emoluments', width: 20 },
        { header: 'Total Deductions', key: 'total_deductions', width: 20 },
        { header: 'Tax', key: 'tax', width: 18 },
        { header: 'Net Pay', key: 'net_pay', width: 18 }
      ];
    } else {
      const columns = [
        { header: 'Service No', key: 'empl_id', width: 15 },
        { header: 'Name', key: 'fullname', width: 30 },
        { header: 'Location', key: 'location', width: 25 },
        { header: 'Grade', key: 'gradelevel', width: 10 },
        { header: 'Gross Pay', key: 'gross_pay', width: 18 },
        { header: 'Total Emoluments', key: 'total_emoluments', width: 20 },
        { header: 'Total Deductions', key: 'total_deductions', width: 20 },
        { header: 'Tax', key: 'tax', width: 18 },
        { header: 'Net Pay', key: 'net_pay', width: 18 },
        { header: 'Bank', key: 'Bankcode', width: 20 },
        { header: 'Account Number', key: 'BankACNumber', width: 20 }
      ];
      
      if (includeElements) {
        columns.splice(4, 0, { header: 'Payment Elements', key: 'payment_elements', width: 50 });
      }
      
      worksheet.columns = columns;
    }

    // Style header row (row 4 after title and period)
    const headerRow = worksheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data
    if (isSummary) {
      data.forEach(row => {
        worksheet.addRow(row);
      });

      // Format currency columns
      ['C', 'D', 'E', 'F', 'G'].forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
      });

      // Add totals
      const totalRow = worksheet.lastRow.number + 1;
      worksheet.getCell(`A${totalRow}`).value = 'GRAND TOTALS:';
      worksheet.getCell(`A${totalRow}`).font = { bold: true };
      
      ['C', 'D', 'E', 'F', 'G'].forEach(col => {
        worksheet.getCell(`${col}${totalRow}`).value = {
          formula: `SUM(${col}5:${col}${totalRow - 1})`
        };
        worksheet.getCell(`${col}${totalRow}`).font = { bold: true };
        worksheet.getCell(`${col}${totalRow}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE699' }
        };
      });
    } else {
      // Group by location
      const locations = {};
      data.forEach(row => {
        const loc = row.location || 'Unknown';
        if (!locations[loc]) locations[loc] = [];
        
        // Format payment elements if included
        if (includeElements && row.payment_elements) {
          try {
            const elements = JSON.parse(row.payment_elements);
            row.payment_elements = elements.map(el => 
              `${el.code}: ₦${parseFloat(el.amount).toLocaleString('en-NG', {minimumFractionDigits: 2})}`
            ).join('\n');
          } catch (e) {
            row.payment_elements = '';
          }
        }
        
        locations[loc].push(row);
      });

      // Add data with location separators
      Object.keys(locations).forEach((location, index) => {
        if (index > 0) worksheet.addRow([]);
        
        // Location header
        const headerRow = worksheet.addRow([location]);
        headerRow.font = { bold: true, size: 12 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE7E6E6' }
        };
        const maxCol = includeElements ? 11 : 11;
        worksheet.mergeCells(headerRow.number, 1, headerRow.number, maxCol);

        // Add location data
        locations[location].forEach(row => {
          const addedRow = worksheet.addRow(row);
          // Wrap text for payment elements
          if (includeElements) {
            addedRow.getCell(5).alignment = { wrapText: true, vertical: 'top' };
            addedRow.height = 40;
          }
        });

        // Location subtotal
        const subtotalRow = worksheet.lastRow.number + 1;
        const startCol = includeElements ? 'D' : 'D';
        worksheet.getCell(`${startCol}${subtotalRow}`).value = 'Location Subtotal:';
        worksheet.getCell(`${startCol}${subtotalRow}`).font = { bold: true };
        
        const currencyCols = includeElements ? ['E', 'F', 'G', 'H', 'I'] : ['E', 'F', 'G', 'H', 'I'];
        currencyCols.forEach(col => {
          worksheet.getCell(`${col}${subtotalRow}`).value = {
            formula: `SUBTOTAL(9,${col}${headerRow.number + 1}:${col}${subtotalRow - 1})`
          };
          worksheet.getCell(`${col}${subtotalRow}`).font = { bold: true };
        });
      });

      // Format currency columns
      const currencyCols = includeElements ? ['E', 'F', 'G', 'H', 'I'] : ['E', 'F', 'G', 'H', 'I'];
      currencyCols.forEach(col => {
        worksheet.getColumn(col).numFmt = '₦#,##0.00';
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payroll_register.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generatePayrollRegisterPDF(data, res) {
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

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('empl_id');
      const includeElements = data.length > 0 && data[0].hasOwnProperty('payment_elements') && data[0].payment_elements;
      
      console.log('Payroll Register PDF - Is Summary:', isSummary);
      console.log('Payroll Register PDF - Include Elements:', includeElements);
      console.log('Payroll Register PDF - Data rows:', data.length);
      
      // Group data by location
      const locationsMap = {};
      
      data.forEach(row => {
        const location = row.location || 'Unknown';
        
        if (!locationsMap[location]) {
          locationsMap[location] = {
            locationName: location,
            employees: [],
            locationTotals: {
              gross_pay: 0,
              total_emoluments: 0,
              total_deductions: 0,
              tax: 0,
              net_pay: 0,
              employee_count: 0
            }
          };
        }
        
        if (isSummary) {
          const empCount = parseInt(row.employee_count || 0);
          locationsMap[location].employees.push({
            employee_count: empCount,
            gross_pay: parseFloat(row.gross_pay || 0),
            total_emoluments: parseFloat(row.total_emoluments || 0),
            total_deductions: parseFloat(row.total_deductions || 0),
            tax: parseFloat(row.tax || 0),
            net_pay: parseFloat(row.net_pay || 0)
          });
          
          locationsMap[location].locationTotals.employee_count += empCount;
          locationsMap[location].locationTotals.gross_pay += parseFloat(row.gross_pay || 0);
          locationsMap[location].locationTotals.total_emoluments += parseFloat(row.total_emoluments || 0);
          locationsMap[location].locationTotals.total_deductions += parseFloat(row.total_deductions || 0);
          locationsMap[location].locationTotals.tax += parseFloat(row.tax || 0);
          locationsMap[location].locationTotals.net_pay += parseFloat(row.net_pay || 0);
        } else {
          // Parse payment elements if present
          let parsedElements = [];
          if (includeElements && row.payment_elements) {
            try {
              parsedElements = JSON.parse(row.payment_elements);
            } catch (e) {
              parsedElements = [];
            }
          }
          
          locationsMap[location].employees.push({
            empl_id: row.empl_id,
            fullname: row.fullname || 'N/A',
            gradelevel: row.gradelevel || 'N/A',
            gross_pay: parseFloat(row.gross_pay || 0),
            total_emoluments: parseFloat(row.total_emoluments || 0),
            total_deductions: parseFloat(row.total_deductions || 0),
            tax: parseFloat(row.tax || 0),
            net_pay: parseFloat(row.net_pay || 0),
            Bankcode: row.Bankcode || 'N/A',
            BankACNumber: row.BankACNumber || 'N/A',
            payment_elements: parsedElements
          });
          
          locationsMap[location].locationTotals.employee_count++;
          locationsMap[location].locationTotals.gross_pay += parseFloat(row.gross_pay || 0);
          locationsMap[location].locationTotals.total_emoluments += parseFloat(row.total_emoluments || 0);
          locationsMap[location].locationTotals.total_deductions += parseFloat(row.total_deductions || 0);
          locationsMap[location].locationTotals.tax += parseFloat(row.tax || 0);
          locationsMap[location].locationTotals.net_pay += parseFloat(row.net_pay || 0);
        }
      });
      
      // Convert to array format for template
      const locations = Object.values(locationsMap);
      
      // Calculate grand totals
      const grandTotals = {
        employee_count: 0,
        gross_pay: 0,
        total_emoluments: 0,
        total_deductions: 0,
        tax: 0,
        net_pay: 0
      };
      
      locations.forEach(loc => {
        grandTotals.employee_count += loc.locationTotals.employee_count;
        grandTotals.gross_pay += loc.locationTotals.gross_pay;
        grandTotals.total_emoluments += loc.locationTotals.total_emoluments;
        grandTotals.total_deductions += loc.locationTotals.total_deductions;
        grandTotals.tax += loc.locationTotals.tax;
        grandTotals.net_pay += loc.locationTotals.net_pay;
      });
      
      console.log('Locations processed:', locations.length);
      console.log('Grand Totals:', grandTotals);

      const period = data.length > 0 ? 
        `${this.getMonthName(data[0].month)} ${data[0].year}` : 
        'N/A';

      const templatePath = path.join(__dirname, '../../templates/payroll-register.html');
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
            marginTop: '10mm',
            marginBottom: '10mm',
            marginLeft: '10mm',
            marginRight: '10mm'
          },
          helpers: `
            function formatDate(date) {
              return new Date(date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            }
            
            function formatCurrency(amount) {
              return parseFloat(amount || 0).toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
            }
          `
        },
        data: {
          locations: locations,
          grandTotals: grandTotals,
          period: period,
          reportDate: new Date(),
          isSummary: isSummary,
          includeElements: includeElements
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=payroll_register_${data[0]?.month}_${data[0]?.year}.pdf`);
      res.send(result.content);

    } catch (error) {
      console.error('Payroll Register PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  // ==========================================================================
  // REPORT 7-13: Similar implementations...
  // ==========================================================================

  async generatePayrollFilesListing(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getPayrollFilesListing(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'Payroll Files', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentStaffList(req, res) {
    try {
      const { format, summary, bank_name, location, ...otherFilters } = req.query;
      
      // Map frontend parameter names to backend expected names
      const filters = {
        ...otherFilters,
        summaryOnly: summary === '1' || summary === 'true',
        bankName: bank_name,
        location: location
      };
      
      console.log('Staff List Filters:', filters); // DEBUG
      
      const data = await reportService.getPaymentStaffList(filters);
      
      console.log('Staff List Data rows:', data.length); // DEBUG
      console.log('Staff List Sample row:', data[0]); // DEBUG

      if (format === 'excel') {
        return this.generatePaymentStaffListExcel(data, res, filters.summaryOnly);
      } else if (format === 'pdf') {
        return this.generatePaymentStaffListPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payment staff list:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentStaffListExcel(data, res, isSummary = false) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment Staff List');

    // Define columns based on summary mode
    if (isSummary) {
      worksheet.columns = [
        { header: 'Location', key: 'location', width: 30 },
        { header: 'Bank Code', key: 'Bankcode', width: 20 },
        { header: 'Bank Branch', key: 'bankbranch', width: 25 },
        { header: 'State of Origin', key: 'state_of_origin', width: 20 },
        { header: 'Employee Count', key: 'employee_count', width: 18 },
        { header: 'Net Pay', key: 'net_pay', width: 20 }
      ];
    } else {
      worksheet.columns = [
        { header: 'Service Number', key: 'service_number', width: 18 },
        { header: 'Title', key: 'title', width: 12 },
        { header: 'Full Name', key: 'fullname', width: 35 },
        { header: 'Location', key: 'location', width: 30 },
        { header: 'Bank Code', key: 'Bankcode', width: 20 },
        { header: 'Bank Branch', key: 'bankbranch', width: 25 },
        { header: 'Account Number', key: 'BankACNumber', width: 20 },
        { header: 'Grade Level', key: 'gradelevel', width: 15 },
        { header: 'Years in Level', key: 'level_years', width: 15 },
        { header: 'State of Origin', key: 'state_of_origin', width: 20 },
        { header: 'Net Pay', key: 'net_pay', width: 20 }
      ];
    }

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    if (isSummary) {
      // Group by location and bank
      const groups = {};
      data.forEach(row => {
        const groupKey = `${row.location || 'Unknown'} - ${row.Bankcode || 'N/A'}`;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(row);
      });

      // Add data with group separators
      Object.keys(groups).forEach((group, index) => {
        if (index > 0) worksheet.addRow([]);
        
        // Group header
        const headerRow = worksheet.addRow([group]);
        headerRow.font = { bold: true, size: 12 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE7E6E6' }
        };
        worksheet.mergeCells(headerRow.number, 1, headerRow.number, 6);

        // Add group data
        groups[group].forEach(row => {
          worksheet.addRow(row);
        });

        // Group subtotal
        const subtotalRow = worksheet.lastRow.number + 1;
        worksheet.getCell(`D${subtotalRow}`).value = 'Subtotal:';
        worksheet.getCell(`D${subtotalRow}`).font = { bold: true };
        worksheet.getCell(`F${subtotalRow}`).value = {
          formula: `SUBTOTAL(9,F${headerRow.number + 1}:F${subtotalRow - 1})`
        };
        worksheet.getCell(`F${subtotalRow}`).font = { bold: true };
      });

      // Format currency
      worksheet.getColumn('F').numFmt = '₦#,##0.00';
    } else {
      // Detailed mode - group by bank
      const banks = {};
      data.forEach(row => {
        const bankKey = `${row.Bankcode || 'Unknown'} - ${row.bankbranch || 'Unknown'}`;
        if (!banks[bankKey]) banks[bankKey] = [];
        banks[bankKey].push(row);
      });

      // Add data with bank separators
      Object.keys(banks).forEach((bank, index) => {
        if (index > 0) worksheet.addRow([]);
        
        // Bank header
        const headerRow = worksheet.addRow([bank]);
        headerRow.font = { bold: true, size: 12 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE7E6E6' }
        };
        worksheet.mergeCells(headerRow.number, 1, headerRow.number, 11);

        // Add bank data
        banks[bank].forEach(row => {
          worksheet.addRow(row);
        });

        // Bank subtotal
        const subtotalRow = worksheet.lastRow.number + 1;
        worksheet.getCell(`I${subtotalRow}`).value = 'Bank Subtotal:';
        worksheet.getCell(`I${subtotalRow}`).font = { bold: true };
        worksheet.getCell(`K${subtotalRow}`).value = {
          formula: `SUBTOTAL(9,K${headerRow.number + 1}:K${subtotalRow - 1})`
        };
        worksheet.getCell(`K${subtotalRow}`).font = { bold: true };
      });

      // Format currency
      worksheet.getColumn('K').numFmt = '₦#,##0.00';
      // Format years in level
      worksheet.getColumn('I').numFmt = '0.00';
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payment_staff_list.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  async generatePaymentStaffListPDF(data, res) {
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

      const isSummary = data.length > 0 && !data[0].hasOwnProperty('service_number');
      
      console.log('Staff List PDF - Is Summary:', isSummary);
      console.log('Staff List PDF - Data rows:', data.length);
      
      // Calculate totals
      let totalEmployees = 0;
      let totalNetPay = 0;

      if (isSummary) {
        data.forEach(row => {
          totalEmployees += parseInt(row.employee_count || 0);
          totalNetPay += parseFloat(row.net_pay || 0);
        });
      } else {
        totalEmployees = data.length;
        data.forEach(row => {
          totalNetPay += parseFloat(row.net_pay || 0);
        });
      }

      const templatePath = path.join(__dirname, '../../templates/payment-staff-list.html');
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
            landscape: false,
            marginTop: '10mm',
            marginBottom: '10mm',
            marginLeft: '10mm',
            marginRight: '10mm'
          },
          helpers: `
            function formatDate(date) {
              return new Date(date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
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
            
            function formatCurrency(amount) {
              return parseFloat(amount || 0).toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
            }
            
            function formatDecimal(value) {
              return parseFloat(value || 0).toFixed(2);
            }
          `
        },
        data: {
          data: data,
          reportDate: new Date(),
          month: data[0]?.month || 'N/A',
          year: data[0]?.year || 'N/A',
          isSummary: isSummary,
          totalEmployees: totalEmployees,
          totalNetPay: totalNetPay
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=payment-staff-list-${data[0]?.month || 'report'}-${data[0]?.year || 'report'}.pdf`);
      res.send(result.content);

    } catch (error) {
      console.error('Staff List PDF generation error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async generateNSITFReport(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getNSITFReport(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'NSITF Report', res);
      }

      res.json({ success: false, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateSalarySummary(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getSalarySummary(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'Salary Summary', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateSalaryReconciliation(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getSalaryReconciliation(filters);

      if (format === 'excel') {
        return this.generateGenericExcel([data], 'Salary Reconciliation', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateOverpaymentReport(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getOverpaymentReport(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'Overpayment Report', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateDuplicateAccounts(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getDuplicateAccounts(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'Duplicate Accounts', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER: Get Filter Options
  // ==========================================================================
  async getFilterOptions(req, res) {
    try {
      const banks = await reportService.getAvailableBanks();
      const departments = await reportService.getAvailableDepartments();
      const paymentTypes = await reportService.getPaymentTypes();
      const currentPeriod = await reportService.getCurrentPeriod();

      res.json({
        success: true,
        data: {
          banks,
          departments,
          paymentTypes,
          currentPeriod
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  async generateGenericExcel(data, sheetName, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    if (data.length === 0) {
      worksheet.addRow(['No data available']);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${sheetName.replace(/\s+/g, '_')}.xlsx`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    // Get columns from first row
    const columns = Object.keys(data[0]).map(key => ({
      header: key.replace(/_/g, ' ').toUpperCase(),
      key: key,
      width: 20
    }));

    worksheet.columns = columns;

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data
    data.forEach(row => {
      worksheet.addRow(row);
    });

    // Auto-format currency columns (columns containing 'amount', 'pay', 'tax', 'gross', 'net')
    columns.forEach((col, index) => {
      const colLetter = String.fromCharCode(65 + index);
      const key = col.key.toLowerCase();
      if (key.includes('amount') || key.includes('pay') || key.includes('tax') || 
          key.includes('gross') || key.includes('net') || key.includes('deduction')) {
        worksheet.getColumn(colLetter).numFmt = '₦#,##0.00';
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${sheetName.replace(/\s+/g, '_')}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }

  formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return `₦${num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month - 1] || '';
  }
}

module.exports = new ReportController();