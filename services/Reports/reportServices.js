const pool = require('../../config/db');

class ReportService {
  
  // REPORT 1: PAY SLIPS (USES payslipGenerationService)

  // ========================================================================
  // REPORT 2: PAYMENTS BY BANK (BRANCH)
  // ========================================================================
  async getPaymentsByBank(filters = {}) {
    const { year, month, bankName, summaryOnly } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        we.Bankcode,
        we.bankbranch,
        ${summaryOnly ? '' : 'we.empl_id, we.Surname, we.BankACNumber,'}
        COUNT(DISTINCT we.empl_id) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      WHERE 1=1
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${bankName ? 'AND we.Bankcode = ?' : ''}
      GROUP BY sr.ord, sr.mth, we.Bankcode, we.bankbranch
        ${summaryOnly ? '' : ', we.empl_id, we.Surname, we.BankACNumber'}
      ORDER BY we.Bankcode, we.bankbranch, we.empl_id
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (bankName) params.push(bankName);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 3: ANALYSIS OF EARNINGS/DEDUCTIONS
  // ========================================================================
  async getEarningsDeductionsAnalysis(filters = {}) {
    const { year, month, paymentType, summaryOnly } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        mp.his_type as payment_code,
        et.elmDesc as payment_description,
        CASE 
          WHEN LEFT(mp.his_type, 2) IN ('BP', 'BT') THEN 'Earnings'
          WHEN LEFT(mp.his_type, 2) = 'FP' THEN 'Tax-Free Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PT' THEN 'Taxable Allowance'
          WHEN LEFT(mp.his_type, 2) = 'PR' THEN 'Deduction'
          WHEN LEFT(mp.his_type, 2) = 'PL' THEN 'Loan'
          ELSE 'Other'
        END as category,
        ${summaryOnly ? '' : 'mp.his_empno, we.Surname,'}
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount,
        ROUND(AVG(mp.amtthismth), 2) as average_amount,
        ROUND(MIN(mp.amtthismth), 2) as min_amount,
        ROUND(MAX(mp.amtthismth), 2) as max_amount
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      LEFT JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE mp.amtthismth != 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${paymentType ? 'AND mp.his_type = ?' : ''}
      GROUP BY sr.ord, sr.mth, mp.his_type, et.elmDesc
        ${summaryOnly ? '' : ', mp.his_empno, we.Surname'}
      ORDER BY category, mp.his_type, mp.his_empno
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (paymentType) params.push(paymentType);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 4: LOAN ANALYSIS
  // ========================================================================
  async getLoanAnalysis(filters = {}) {
    const { year, month } = filters;
    
    const query = `
      SELECT 
        mp.his_empno as employee_id,
        we.Surname,
        we.Location,
        mp.his_type as loan_type,
        et.elmDesc as loan_description,
        ROUND(mp.initialloan, 2) as original_loan,
        ROUND(mp.totpaidtodate, 2) as total_paid,
        ROUND(mp.totamtpayable, 2) as outstanding_balance,
        mp.nmth as months_remaining,
        ROUND(mp.amtthismth, 2) as this_month_payment,
        et.std as annual_interest_rate,
        ROUND(mp.initialloan * et.std / 1200, 2) as monthly_interest,
        CASE 
          WHEN mp.nmth = 0 THEN 'COMPLETED'
          WHEN mp.totpaidtodate > mp.initialloan THEN 'OVERPAID'
          WHEN mp.nmth <= 3 THEN 'FINAL MONTHS'
          ELSE 'ACTIVE'
        END as status,
        ROUND((mp.totpaidtodate / NULLIF(mp.initialloan, 0)) * 100, 2) as percent_paid
      FROM py_masterpayded mp
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE LEFT(mp.his_type, 2) = 'PL'
        AND (mp.totamtpayable > 0 OR mp.totpaidtodate > 0)
      ORDER BY mp.his_empno, mp.his_type
    `;
    
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // REPORT 5: ANALYSIS OF PAYMENTS/DEDUCTIONS BY BANK
  // ========================================================================
  async getPaymentsDeductionsByBank(filters = {}) {
    const { year, month, bankName, paymentType, summaryOnly } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        we.Bankcode,
        we.bankbranch,
        mp.his_type as payment_code,
        et.elmDesc as payment_description,
        CASE 
          WHEN LEFT(mp.his_type, 2) IN ('BP', 'BT') THEN 'Earnings'
          WHEN LEFT(mp.his_type, 2) IN ('FP', 'PT') THEN 'Allowances'
          WHEN LEFT(mp.his_type, 2) = 'PR' THEN 'Deduction'
          WHEN LEFT(mp.his_type, 2) = 'PL' THEN 'Loan'
        END as category,
        ${summaryOnly ? '' : 'mp.his_empno, we.Surname,'}
        COUNT(DISTINCT mp.his_empno) as employee_count,
        ROUND(SUM(mp.amtthismth), 2) as total_amount
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE mp.amtthismth != 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${bankName ? 'AND we.Bankcode = ?' : ''}
        ${paymentType ? 'AND mp.his_type = ?' : ''}
      GROUP BY sr.ord, sr.mth, we.Bankcode, we.bankbranch, mp.his_type, et.elmDesc
        ${summaryOnly ? '' : ', mp.his_empno, we.Surname'}
      ORDER BY we.Bankcode, category, mp.his_type
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (bankName) params.push(bankName);
    if (paymentType) params.push(paymentType);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 6: PAYROLL REGISTER
  // ========================================================================
  async getPayrollRegister(filters = {}) {
    const { year, month, Location, includeElements, summaryOnly } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        we.empl_id,
        we.Surname,
        we.Location,
        we.gradelevel,
        we.payrollclass,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND(mc.his_taxmth, 2) as tax,
        ROUND(mc.his_netmth, 2) as net_pay,
        ${includeElements ? `
          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'code', mp2.his_type,
                'description', et.elmDesc,
                'amount', ROUND(mp2.amtthismth, 2),
                'category', LEFT(mp2.his_type, 2)
              )
            )
            FROM py_masterpayded mp2
            LEFT JOIN py_elementType et ON et.PaymentType = mp2.his_type
            WHERE mp2.his_empno = we.empl_id
              AND mp2.amtthismth != 0
          ) as payment_elements,
        ` : ''}
        we.Bankcode,
        we.BankACNumber,
        DATE_FORMAT(mc.datecreated, '%Y-%m-%d %H:%i:%s') as processed_date
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      WHERE 1=1
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${Location ? 'AND we.Location = ?' : ''}
      ORDER BY we.Location, we.empl_id
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (Location) params.push(Location);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 7: LISTING OF PAYROLL FILES
  // ========================================================================
  async getPayrollFilesListing(filters = {}) {
    const { year, month, Location } = filters;
    
    const query = `
      SELECT 
        mc.his_type as month_number,
        CASE mc.his_type
          WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March'
          WHEN 4 THEN 'April' WHEN 5 THEN 'May' WHEN 6 THEN 'June'
          WHEN 7 THEN 'July' WHEN 8 THEN 'August' WHEN 9 THEN 'September'
          WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
        END as month_name,
        DATE_FORMAT(mc.datecreated, '%Y') as process_year,
        COUNT(DISTINCT mc.his_empno) as total_employees,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        MIN(DATE_FORMAT(mc.datecreated, '%Y-%m-%d %H:%i:%s')) as first_processed,
        MAX(DATE_FORMAT(mc.datecreated, '%Y-%m-%d %H:%i:%s')) as last_processed,
        mc.createpooly as processed_by,
        'CALCULATED' as status
      FROM py_mastercum mc
      INNER JOIN py_wkemployees we ON we.empl_id = mc.his_empno
      WHERE mc.his_type BETWEEN 1 AND 12
        ${year ? 'AND YEAR(mc.datecreated) = ?' : ''}
        ${month ? 'AND mc.his_type = ?' : ''}
        ${Location ? 'AND we.Location = ?' : ''}
      GROUP BY mc.his_type, process_year, mc.createpooly
      ORDER BY process_year DESC, mc.his_type DESC
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (Location) params.push(Location);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 8: PAYMENT STAFF LIST
  // ========================================================================
  async getPaymentStaffList(filters = {}) {
    const { year, month, payrollClass, bankName } = filters;
    
    const query = `
      SELECT 
        we.empl_id as service_number,
        we.Surname,
        we.payrollclass,
        we.Location,
        we.Bankcode,
        we.bankbranch,
        we.BankACNumber,
        ROUND(mc.his_netmth, 2) as net_pay,
        we.gsm_number
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      WHERE mc.his_netmth > 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${payrollClass ? 'AND we.payrollclass = ?' : ''}
        ${bankName ? 'AND we.Bankcode = ?' : ''}
      ORDER BY we.Bankcode, we.empl_id
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (payrollClass) params.push(payrollClass);
    if (bankName) params.push(bankName);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 9: NSITF CONTRIBUTIONS
  // ========================================================================
  async getNSITFReport(filters = {}) {
    const { year, month, Location } = filters;
    
    const query = `
      SELECT 
        mp.his_empno as employee_id,
        we.Surname,
        we.Location,
        we.NSITFcode,
        ROUND(mp.amtthismth, 2) as nsitf_contribution,
        ROUND(mc.his_grossmth, 2) as gross_pay,
        ROUND((mp.amtthismth / NULLIF(mc.his_grossmth, 0)) * 100, 2) as contribution_percent
      FROM py_masterpayded mp
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      INNER JOIN py_mastercum mc ON mc.his_empno = mp.his_empno AND mc.his_type = sr.mth
      WHERE mp.his_type = 'PR01'  -- NSITF deduction code
        AND mp.amtthismth > 0
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${Location ? 'AND we.Location = ?' : ''}
      ORDER BY we.Location, mp.his_empno
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (Location) params.push(Location);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 10: SALARY SUMMARY
  // ========================================================================
  async getSalarySummary(filters = {}) {
    const { year, month, Location } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        we.Location,
        we.payrollclass,
        COUNT(DISTINCT we.empl_id) as employee_count,
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        ROUND(AVG(mc.his_grossmth), 2) as avg_gross,
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        ROUND(SUM(mc.his_netmth), 2) as total_net,
        ROUND(AVG(mc.his_netmth), 2) as avg_net,
        ROUND(MIN(mc.his_netmth), 2) as min_net,
        ROUND(MAX(mc.his_netmth), 2) as max_net
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      WHERE 1=1
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
        ${Location ? 'AND we.Location = ?' : ''}
      GROUP BY sr.ord, sr.mth, we.Location, we.payrollclass
      ORDER BY we.Location, we.payrollclass
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (Location) params.push(Location);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 11: SALARY RECONCILIATION
  // ========================================================================
  async getSalaryReconciliation(filters = {}) {
    const { year, month } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        'Summary from Cumulative' as source,
        (SELECT ROUND(SUM(his_grossmth), 2) FROM py_mastercum WHERE his_type = sr.mth) as total_gross,
        (SELECT ROUND(SUM(his_taxmth), 2) FROM py_mastercum WHERE his_type = sr.mth) as total_tax,
        (SELECT ROUND(SUM(his_netmth), 2) FROM py_mastercum WHERE his_type = sr.mth) as total_net,
        
        'Detail from Payments' as source2,
        (SELECT ROUND(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 2) 
         FROM py_masterpayded) as detail_earnings,
        (SELECT ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 2) 
         FROM py_masterpayded) as detail_deductions,
        (SELECT ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 2) 
         FROM py_masterpayded) as detail_loans,
        (SELECT ROUND(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 2) 
         FROM py_masterpayded) as detail_allowances,
        
        ABS((SELECT SUM(his_netmth) FROM py_mastercum WHERE his_type = sr.mth) - 
            ((SELECT SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END) FROM py_masterpayded) -
             (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END) FROM py_masterpayded) -
             (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END) FROM py_masterpayded) +
             (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END) FROM py_masterpayded))) as variance,
        
        CASE 
          WHEN ABS((SELECT SUM(his_netmth) FROM py_mastercum WHERE his_type = sr.mth) - 
               ((SELECT SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END) FROM py_masterpayded) -
                (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END) FROM py_masterpayded) -
                (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END) FROM py_masterpayded) +
                (SELECT SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END) FROM py_masterpayded))) < 1
          THEN 'BALANCED'
          ELSE 'VARIANCE DETECTED'
        END as status
      FROM (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      WHERE 1=1
        ${year ? 'AND sr.ord = ?' : ''}
        ${month ? 'AND sr.mth = ?' : ''}
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    
    const [rows] = await pool.query(query, params);
    return rows[0];
  }

  // ========================================================================
  // REPORT 12: OVERPAYMENT REPORT
  // ========================================================================
  async getOverpaymentReport(filters = {}) {
    const { year, month, bankName } = filters;
    
    const query = `
      SELECT 
        mp.his_empno as employee_id,
        we.Surname,
        we.Location,
        we.Bankcode,
        mp.his_type as loan_type,
        et.elmDesc as loan_description,
        ROUND(mp.initialloan, 2) as original_loan,
        ROUND(mp.totpaidtodate, 2) as total_paid,
        ROUND(mp.totpaidtodate - mp.initialloan, 2) as overpayment_amount,
        ROUND(((mp.totpaidtodate - mp.initialloan) / NULLIF(mp.initialloan, 0)) * 100, 2) as overpayment_percent
      FROM py_masterpayded mp
      INNER JOIN py_wkemployees we ON we.empl_id = mp.his_empno
      LEFT JOIN py_elementType et ON et.PaymentType = mp.his_type
      WHERE mp.totpaidtodate > mp.initialloan
        AND mp.initialloan > 0
        ${bankName ? 'AND we.Bankcode = ?' : ''}
      ORDER BY overpayment_amount DESC
    `;
    
    const params = [];
    if (bankName) params.push(bankName);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

  // ========================================================================
  // REPORT 13: DUPLICATE ACCOUNT NUMBERS
  // ========================================================================
  async getDuplicateAccounts(filters = {}) {
    const { bankName } = filters;
    
    const query = `
      SELECT 
        we.BankACNumber,
        we.Bankcode,
        we.bankbranch,
        COUNT(*) as occurrence_count,
        GROUP_CONCAT(we.empl_id ORDER BY we.empl_id SEPARATOR ', ') as employee_ids,
        GROUP_CONCAT(we.Surname ORDER BY we.empl_id SEPARATOR ', ') as employee_names,
        GROUP_CONCAT(we.Location ORDER BY we.empl_id SEPARATOR ', ') as departments
      FROM py_wkemployees we
      WHERE we.BankACNumber IS NOT NULL 
        AND we.BankACNumber != ''
        ${bankName ? 'AND we.Bankcode = ?' : ''}
		  GROUP BY we.BankACNumber, we.Bankcode, we.bankbranch
      HAVING COUNT(*) > 1
      ORDER BY occurrence_count DESC, we.Bankcode;
    `;
    
    const params = [];
    if (bankName) params.push(bankName);
    
    const [rows] = await pool.query(query, params);
    return rows;
  }

   // ========================================================================
  // HELPER: Get Available Banks
  // ========================================================================
  async getAvailableBanks() {
    const query = `
      SELECT DISTINCT bank_name, bank_branch
      FROM py_wkemployees
      WHERE bank_name IS NOT NULL
      ORDER BY bank_name, bank_branch
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Available Departments
  // ========================================================================
  async getAvailableDepartments() {
    const query = `
      SELECT DISTINCT department
      FROM py_wkemployees
      WHERE department IS NOT NULL
      ORDER BY department
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Payment Types
  // ========================================================================
  async getPaymentTypes() {
    const query = `
      SELECT PaymentType, elmDesc, 
        CASE 
          WHEN LEFT(PaymentType, 2) IN ('BP', 'BT') THEN 'Earnings'
          WHEN LEFT(PaymentType, 2) = 'FP' THEN 'Tax-Free Allowance'
          WHEN LEFT(PaymentType, 2) = 'PT' THEN 'Taxable Allowance'
          WHEN LEFT(PaymentType, 2) = 'PR' THEN 'Deduction'
          WHEN LEFT(PaymentType, 2) = 'PL' THEN 'Loan'
          ELSE 'Other'
        END as category
      FROM py_elementType
      WHERE status = 'Active'
      ORDER BY category, PaymentType
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    const query = `
      SELECT ord as year, mth as month, pmth as prev_month
      FROM py_stdrate 
      WHERE type = 'BT05'
      LIMIT 1
    `;
    const [rows] = await pool.query(query);
    return rows[0];
  }
}

module.exports = new ReportService();