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
        bank_name: employee.bank_name || '',
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
        payclass: employee.payclass || ''
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
  // GENERATE PAYSLIP PDF - PDFKIT VERSION
  // ==========================================================================
  async generatePayslipPDF(req, res) {
    const mappedData = req.body.data || [];

    if (mappedData.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "No payslip data provided for PDF generation." 
      });
    }

    const doc = new PDFDocument({ 
      margin: 40, 
      size: 'A4',
      bufferPages: true
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=payslips.pdf');
    doc.pipe(res);

    doc.on('error', (err) => {
      console.error('PDFDocument Error:', err);
      res.end();
    });

    // Generate each payslip
    mappedData.forEach((employee, index) => {
      try {
        if (index > 0) doc.addPage();
        this._generatePayslipPage(doc, employee);
      } catch (pdfError) {
        console.error(`Error generating PDF for employee ${employee.employee_id}:`, pdfError);
        doc.addPage();
        doc.fontSize(12).text(`[ERROR: Could not generate payslip for ${employee.empl_name}]`, { color: 'red' });
      }
    });

    doc.end();
  }

  // ==========================================================================
  // GENERATE SINGLE PAYSLIP PAGE - PDFKIT
  // ==========================================================================
  _generatePayslipPage(doc, employee) {
    const pageWidth = doc.page.width - 80;
    const leftCol = 40;
    const rightColStart = leftCol + pageWidth - 140;
    let yPos = 60;

    // ========== HEADER WITH DOUBLE LINE ==========
    doc.fontSize(22).font('Helvetica-Bold')
       .text('NIGERIAN NAVY', leftCol, yPos, { width: pageWidth, align: 'center' });
    yPos += 28;
    
    doc.fontSize(14).font('Helvetica')
       .text('Monthly Salary Statement', leftCol, yPos, { width: pageWidth, align: 'center' });
    yPos += 25;

    // Double line separator
    doc.strokeColor('#000000').lineWidth(1.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 30;

    // ========== PAY PERIOD INFO ==========
    doc.fontSize(10).font('Helvetica');
    doc.text(`Pay Period: ${employee.payroll_month} ${employee.payroll_year}`, leftCol, yPos);
    yPos += 14;
    const payDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.text(`Pay Date: ${payDate}`, leftCol, yPos);
    yPos += 30;

    // ========== EMPLOYEE INFORMATION ==========
    doc.fontSize(10).font('Helvetica-Bold')
       .text('EMPLOYEE INFORMATION', leftCol, yPos);
    yPos += 16;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 14;

    const title = (employee.title || '').trim();
    const surname = (employee.surname || '').trim();
    const othername = (employee.othername || '').trim();
    const fullName = [title, surname, othername].filter(x => x).join(' ');

    const gradelevel = (employee.gradelevel || '').trim();
    const gradetype = (employee.gradetype || '').trim();
    const gradeInfo = [gradelevel, gradetype].filter(x => x).join(' - ');

    const accountNum = (employee.bank_account_number || '').trim();
    const bankName = (employee.bank_name || '').trim();
    let bankInfo = accountNum;
    if (accountNum && bankName) {
      bankInfo = `${accountNum} (${bankName})`;
    } else if (bankName) {
      bankInfo = bankName;
    }

    const employeeInfo = [
      { label: 'Name:', value: fullName },
      { label: 'Employee ID:', value: (employee.employee_id || '').trim() },
      { label: 'Grade:', value: gradeInfo },
      { label: 'Department:', value: (employee.department || '').trim() },
      { label: 'Bank Account:', value: bankInfo }
    ];

    doc.fontSize(10);
    employeeInfo.forEach(info => {
      if (info.value) {
        const currentY = yPos;
        doc.font('Helvetica-Bold').text(info.label, leftCol, currentY, { 
          width: 85, 
          continued: false 
        });
        doc.font('Helvetica').text(info.value, leftCol + 90, currentY, { 
          width: pageWidth - 90, 
          continued: false 
        });
        yPos += 14;
      }
    });
    yPos += 20;

    // ========== EARNINGS SECTION ==========
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('EARNINGS', leftCol, yPos, { continued: false });
    doc.text('AMOUNT', rightColStart, yPos, { width: 140, align: 'right', continued: false });
    yPos += 16;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 12;

    doc.fontSize(10).font('Helvetica');
    if (employee.earnings && employee.earnings.length > 0) {
      employee.earnings.forEach(earning => {
        const currentY = yPos;
        doc.text(earning.description || '', leftCol, currentY, { 
          width: pageWidth - 160, 
          continued: false 
        });
        
        const amount = parseFloat(earning.amount) || 0;
        const formattedAmount = amount.toLocaleString('en-NG', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        });
        doc.text(`NGN ${formattedAmount}`, rightColStart, currentY, { 
          width: 140, 
          align: 'right', 
          continued: false 
        });
        yPos += 14;
      });
    }

    yPos += 8;
    doc.lineWidth(0.5);
    doc.moveTo(rightColStart - 10, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 10;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 10;

    doc.font('Helvetica-Bold').fontSize(10);
    const currentY1 = yPos;
    doc.text('GROSS PAY', leftCol, currentY1, { continued: false });
    const grossAmount = parseFloat(employee.total_earnings) || 0;
    const formattedGross = grossAmount.toLocaleString('en-NG', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
    doc.text(`NGN ${formattedGross}`, rightColStart, currentY1, { 
      width: 140, 
      align: 'right', 
      continued: false 
    });
    yPos += 15;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 25;

    // ========== DEDUCTIONS SECTION ==========
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('DEDUCTIONS', leftCol, yPos, { continued: false });
    yPos += 16;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 12;

    doc.fontSize(10).font('Helvetica');
    if (employee.deductions && employee.deductions.length > 0) {
      employee.deductions.forEach(deduction => {
        let desc = deduction.description || '';
        if (deduction.is_loan && deduction.loan_balance > 0) {
          const loanBal = parseFloat(deduction.loan_balance) || 0;
          const formattedLoanBal = loanBal.toLocaleString('en-NG', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          });
          desc += ` (Bal: NGN ${formattedLoanBal})`;
        }
        
        const currentY = yPos;
        doc.text(desc, leftCol, currentY, { 
          width: pageWidth - 160, 
          continued: false 
        });
        
        const dedAmount = parseFloat(deduction.amount) || 0;
        const formattedDed = dedAmount.toLocaleString('en-NG', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        });
        doc.text(`NGN ${formattedDed}`, rightColStart, currentY, { 
          width: 140, 
          align: 'right', 
          continued: false 
        });
        yPos += 14;
      });
    }

    yPos += 8;
    doc.lineWidth(0.5);
    doc.moveTo(rightColStart - 10, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 10;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 10;

    doc.font('Helvetica-Bold').fontSize(10);
    const currentY2 = yPos;
    doc.text('TOTAL DEDUCTIONS', leftCol, currentY2, { continued: false });
    const totalDed = parseFloat(employee.total_deductions) || 0;
    const formattedTotalDed = totalDed.toLocaleString('en-NG', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
    doc.text(`NGN ${formattedTotalDed}`, rightColStart, currentY2, { 
      width: 140, 
      align: 'right', 
      continued: false 
    });
    yPos += 15;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 25;

    // ========== NET PAY ==========
    doc.lineWidth(1.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 15;

    doc.fontSize(13).font('Helvetica-Bold');
    const currentY3 = yPos;
    doc.text('NET PAY', leftCol, currentY3, { continued: false });
    const netPay = parseFloat(employee.net_pay) || 0;
    const formattedNetPay = netPay.toLocaleString('en-NG', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
    doc.text(`NGN ${formattedNetPay}`, rightColStart, currentY3, { 
      width: 140, 
      align: 'right', 
      continued: false 
    });
    yPos += 18;

    doc.lineWidth(1.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 35;

    // ========== YEAR-TO-DATE SUMMARY ==========
    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 15;

    doc.fontSize(10).font('Helvetica-Bold')
       .text(`YEAR-TO-DATE TOTALS (Jan - ${employee.payroll_month} ${employee.payroll_year})`, 
             leftCol, yPos, { continued: false });
    yPos += 16;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 14;

    const ytdGross = parseFloat(employee.ytd_gross) || 0;
    const ytdTax = parseFloat(employee.ytd_tax) || 0;
    const ytdNet = ytdGross - ytdTax;

    const ytdItems = [
      { 
        label: 'YTD Gross:', 
        value: ytdGross.toLocaleString('en-NG', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        }) 
      },
      { 
        label: 'YTD Tax:', 
        value: ytdTax.toLocaleString('en-NG', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        }) 
      },
      { 
        label: 'YTD Net:', 
        value: ytdNet.toLocaleString('en-NG', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        }) 
      }
    ];

    doc.fontSize(10);
    ytdItems.forEach(item => {
      const currentY = yPos;
      doc.font('Helvetica-Bold').text(item.label, leftCol, currentY, { 
        width: pageWidth - 160, 
        continued: false 
      });
      doc.font('Helvetica').text(`NGN ${item.value}`, rightColStart, currentY, { 
        width: 140, 
        align: 'right', 
        continued: false 
      });
      yPos += 14;
    });
    yPos += 10;

    doc.lineWidth(0.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();

    // ========== FOOTER ==========
    yPos = doc.page.height - 90;
    doc.lineWidth(1.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 15;

    doc.fontSize(9).font('Helvetica')
       .text('This is a computer-generated document. No signature required.', 
             leftCol, yPos, { width: pageWidth, align: 'center', continued: false });
    yPos += 12;
    doc.text('For queries, contact the Human Resources Department', 
             leftCol, yPos, { width: pageWidth, align: 'center', continued: false });
    yPos += 12;

    doc.lineWidth(1.5);
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
    yPos += 3;
    doc.moveTo(leftCol, yPos).lineTo(leftCol + pageWidth, yPos).stroke();
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
            format: 'A4'
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
        return this.generatePaymentsByBankExcel(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsByBankExcel(data, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments by Bank');

    worksheet.columns = [
      { header: 'Bank Name', key: 'bank_name', width: 25 },
      { header: 'Branch', key: 'bank_branch', width: 20 },
      { header: 'Employee Count', key: 'employee_count', width: 15 },
      { header: 'Total Gross', key: 'total_gross', width: 18 },
      { header: 'Total Tax', key: 'total_tax', width: 18 },
      { header: 'Total Net', key: 'total_net', width: 18 }
    ];

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

    // Format currency
    ['D', 'E', 'F'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // REPORT 3: EARNINGS/DEDUCTIONS ANALYSIS
  // ==========================================================================
  async generateEarningsDeductionsAnalysis(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getEarningsDeductionsAnalysis(filters);

      if (format === 'excel') {
        return this.generateEarningsAnalysisExcel(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating earnings analysis:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generateEarningsAnalysisExcel(data, res) {
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

  // ==========================================================================
  // REPORT 4: LOAN ANALYSIS
  // ==========================================================================
  async generateLoanAnalysis(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getLoanAnalysis(filters);

      if (format === 'excel') {
        return this.generateLoanAnalysisExcel(data, res);
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

  // ==========================================================================
  // REPORT 5: PAYMENTS/DEDUCTIONS BY BANK
  // ==========================================================================
  async generatePaymentsDeductionsByBank(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getPaymentsDeductionsByBank(filters);

      if (format === 'excel') {
        return this.generatePaymentsByBankDetailExcel(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payments by bank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePaymentsByBankDetailExcel(data, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments by Bank Detail');

    worksheet.columns = [
      { header: 'Bank', key: 'bank_name', width: 25 },
      { header: 'Branch', key: 'bank_branch', width: 20 },
      { header: 'Payment Code', key: 'payment_code', width: 15 },
      { header: 'Description', key: 'payment_description', width: 35 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Employee Count', key: 'employee_count', width: 15 },
      { header: 'Total Amount', key: 'total_amount', width: 18 }
    ];

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
      const bankKey = `${row.bank_name} - ${row.bank_branch}`;
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
      worksheet.mergeCells(headerRow.number, 1, headerRow.number, 7);

      // Add bank data
      banks[bank].forEach(row => {
        worksheet.addRow(row);
      });

      // Bank subtotal
      const subtotalRow = worksheet.lastRow.number + 1;
      worksheet.getCell(`E${subtotalRow}`).value = 'Subtotal:';
      worksheet.getCell(`E${subtotalRow}`).font = { bold: true };
      worksheet.getCell(`G${subtotalRow}`).value = {
        formula: `SUBTOTAL(9,G${headerRow.number + 1}:G${subtotalRow - 1})`
      };
      worksheet.getCell(`G${subtotalRow}`).font = { bold: true };
    });

    // Format currency
    worksheet.getColumn('G').numFmt = '₦#,##0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_by_bank_detail.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // REPORT 6: PAYROLL REGISTER
  // ==========================================================================
  async generatePayrollRegister(req, res) {
    try {
      const { format, ...filters } = req.query;
      const data = await reportService.getPayrollRegister(filters);

      if (format === 'excel') {
        return this.generatePayrollRegisterExcel(data, res);
      } else if (format === 'pdf') {
        return this.generatePayrollRegisterPDF(data, res);
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error generating payroll register:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async generatePayrollRegisterExcel(data, res) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payroll Register');

    // Title
    worksheet.mergeCells('A1:J1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'NIGERIAN NAVY - PAYROLL REGISTER';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Period info
    if (data.length > 0) {
      worksheet.mergeCells('A2:J2');
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `Period: ${this.getMonthName(data[0].month)} ${data[0].year}`;
      periodCell.font = { size: 12 };
      periodCell.alignment = { horizontal: 'center' };
    }

    worksheet.addRow([]);

    // Headers
    const headerRow = worksheet.addRow([
      'Service No',
      'Name',
      'Department',
      'Grade',
      'Class',
      'Gross Pay',
      'Tax',
      'Net Pay',
      'Bank',
      'Account Number'
    ]);
    
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };

    // Add data
    data.forEach(row => {
      worksheet.addRow([
        row.empl_id,
        row.empl_name,
        row.department,
        row.gradelevel,
        row.payrollclass,
        row.gross_pay,
        row.tax,
        row.net_pay,
        row.bank_name,
        row.bank_account_number
      ]);
    });

    // Format currency
    ['F', 'G', 'H'].forEach(col => {
      worksheet.getColumn(col).numFmt = '₦#,##0.00';
      worksheet.getColumn(col).width = 18;
    });

    // Set column widths
    worksheet.getColumn('A').width = 15;
    worksheet.getColumn('B').width = 30;
    worksheet.getColumn('C').width = 20;
    worksheet.getColumn('D').width = 10;
    worksheet.getColumn('E').width = 10;
    worksheet.getColumn('I').width = 25;
    worksheet.getColumn('J').width = 20;

    // Add totals
    const totalRow = worksheet.lastRow.number + 1;
    worksheet.getCell(`E${totalRow}`).value = 'TOTALS:';
    worksheet.getCell(`E${totalRow}`).font = { bold: true };
    
    ['F', 'G', 'H'].forEach(col => {
      worksheet.getCell(`${col}${totalRow}`).value = {
        formula: `SUM(${col}4:${col}${totalRow - 1})`
      };
      worksheet.getCell(`${col}${totalRow}`).font = { bold: true };
      worksheet.getCell(`${col}${totalRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payroll_register.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ==========================================================================
  // REPORT 7-13: Similar implementations...
  // (Continue with remaining reports)
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
      const { format, ...filters } = req.query;
      const data = await reportService.getPaymentStaffList(filters);

      if (format === 'excel') {
        return this.generateGenericExcel(data, 'Payment Staff List', res);
      }

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
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