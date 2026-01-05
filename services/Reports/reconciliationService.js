const pool = require('../../config/db');

class ReconciliationService {
  
  /**
   * Get overall salary reconciliation summary
   */
  async getSalaryReconciliationSummary(filters = {}) {
    const { year, month, database } = filters;
    
    const useDb = database || process.env.DB_OFFICERS;
    
    // Extract just the month part (01, 02, etc.)
    let monthOnly;
    if (month && month.length === 6) {
      monthOnly = month.substring(4, 6); // Extract MM from YYYYMM
    } else {
      monthOnly = month;
    }
    
    console.log(`📊 Summary for year: ${year}, month: ${monthOnly} in database: ${useDb}`);
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        
        -- Summary from Cumulative (py_mastercum)
        ROUND(COALESCE(SUM(mc.his_grossmth), 0), 2) as total_gross,
        ROUND(COALESCE(SUM(mc.his_taxmth), 0), 2) as total_tax,
        ROUND(COALESCE(SUM(mc.his_netmth), 0), 2) as total_net,
        ROUND(COALESCE(SUM(mc.his_roundup), 0), 2) as total_roundup,
        
        -- Detail from Payments (pre-aggregated)
        ROUND(COALESCE(SUM(mpd.detail_earnings), 0), 2) as detail_earnings,
        ROUND(COALESCE(SUM(mpd.detail_deductions), 0), 2) as detail_deductions,
        
        -- Calculate variance
        ROUND(
          COALESCE(SUM(mpd.detail_earnings), 0) -
          COALESCE(SUM(mpd.detail_deductions), 0) +
          COALESCE(SUM(mc.his_roundup), 0) -
          COALESCE(SUM(mc.his_netmth), 0) -
          COALESCE(SUM(mc.his_taxmth), 0)
        , 2) as calculated_variance,
        
        COUNT(DISTINCT mc.his_empno) as total_employees
        
      FROM \`${useDb}\`.py_stdrate sr
      INNER JOIN \`${useDb}\`.py_mastercum mc ON mc.his_type = sr.mth
      LEFT JOIN (
        SELECT 
          his_empno,
          SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT', 'PT', 'PU') THEN amtthismth ELSE 0 END) as detail_earnings,
          SUM(CASE WHEN LEFT(his_type, 2) IN ('PR', 'PL') THEN amtthismth ELSE 0 END) as detail_deductions
        FROM \`${useDb}\`.py_masterpayded
        GROUP BY his_empno
      ) mpd ON mpd.his_empno = mc.his_empno
      WHERE sr.type = 'BT05'
        AND sr.ord = ?
        AND sr.mth = ?
      GROUP BY sr.ord, sr.mth
    `;
    
    const [rows] = await pool.query(query, [year, monthOnly, parseInt(monthOnly)]);
    
    console.log(`📊 Summary result:`, rows);
    
    return rows.map(row => ({
      ...row,
      status: Math.abs(row.calculated_variance || 0) < 0.01 ? 'BALANCED' : 'VARIANCE DETECTED',
      variance_threshold: 0.01
    }));
  }

  /**
   * Get detailed employee-level reconciliation (matches VB logic exactly)
   */
  async getEmployeeReconciliation(filters = {}) {
    const { year, month, database, showErrorsOnly = true } = filters;
    
    const useDb = database || process.env.DB_OFFICERS;
    
    // Extract just the month part
    let monthOnly;
    if (month && month.length === 6) {
      monthOnly = month.substring(4, 6);
    } else {
      monthOnly = month;
    }
    
    console.log(`🔍 Reconciliation for year: ${year}, month: ${monthOnly} in database: ${useDb}`);
    
    // Get ALL employees from hr_employees
    const employeesQuery = `
      SELECT DISTINCT 
        e.Empl_ID,
        CONCAT(e.Surname, ' ', COALESCE(e.OtherName, '')) as employee_name,
        e.Title as Title,
        ttl.Description as title_description
      FROM hr_employees e
	  LEFT JOIN py_Title ttl ON ttl.TitleCode = e.Title
      WHERE (e.DateLeft IS NULL OR e.DateLeft = '')
        AND (e.exittype IS NULL OR e.exittype = '')
      ORDER BY e.Empl_ID
    `;
    
    const [employees] = await pool.query(employeesQuery);
    
    console.log(`📋 Found ${employees.length} active employees in ${useDb}`);
    
    const reconciliationResults = [];
    
    for (const emp of employees) {
      try {
        // Step 1: Calculate earnings (BP, BT, PT, PU)
        const [earningsResult] = await pool.query(
          `SELECT 
            COUNT(*) as count,
            COALESCE(SUM(amtthismth), 0) as total
          FROM \`${useDb}\`.py_masterpayded 
          WHERE his_empno = ? 
          AND LEFT(his_type, 2) IN ('BP', 'BT', 'PT', 'PU')`,
          [emp.Empl_ID]
        );
        
        let wmth = parseFloat(earningsResult[0].total);
        
        // Step 2: Subtract deductions (PR, PL)
        const [deductionsResult] = await pool.query(
          `SELECT 
            COUNT(*) as count,
            COALESCE(SUM(amtthismth), 0) as total
          FROM \`${useDb}\`.py_masterpayded 
          WHERE his_empno = ? 
          AND LEFT(his_type, 2) IN ('PR', 'PL')`,
          [emp.Empl_ID]
        );

        const [allowanceResult] = await pool.query(
          `SELECT 
            COUNT(*) as count,
            COALESCE(SUM(amtthismth), 0) as total
          FROM \`${useDb}\`.py_masterpayded 
          WHERE his_empno = ? 
          AND LEFT(his_type, 2) IN ('PT', 'PU')`,
          [emp.Empl_ID]
        );
        
        wmth = wmth - parseFloat(deductionsResult[0].total);
        
        // Step 3: Get cumulative data - try both month formats
        const [cumResult] = await pool.query(
          `SELECT 
            his_roundup,
            his_netmth,
            his_taxmth,
            his_grossmth,
            his_type
          FROM \`${useDb}\`.py_mastercum 
          WHERE his_empno = ? 
          AND (his_type = ? OR his_type = CAST(? AS CHAR))
          LIMIT 1`,
          [emp.Empl_ID, monthOnly, parseInt(monthOnly)]
        );
        
        let roundup = 0;
        let netmth = 0;
        let taxmth = 0;
        let grossmth = 0;
        
        if (cumResult.length > 0) {
          const cum = cumResult[0];
          roundup = parseFloat(cum.his_roundup || 0);
          netmth = parseFloat(cum.his_netmth || 0);
          taxmth = parseFloat(cum.his_taxmth || 0);
          grossmth = parseFloat(cum.his_grossmth || 0);
          
          // Apply VB logic: wmth = wmth + roundup - netmth - taxmth
          wmth = wmth + roundup - netmth - taxmth;
        }
        
        // Get detailed breakdown
        const [paymentBreakdown] = await pool.query(
          `SELECT 
            his_type,
            et.elmDesc as type_description,
            LEFT(his_type, 2) as type_prefix,
            COALESCE(SUM(amtthismth), 0) as amount
          FROM py_masterpayded
          LEFT JOIN py_elementType et ON et.PaymentType = his_type
          WHERE his_empno = ?
          GROUP BY his_type
          ORDER BY his_type`,
          [emp.Empl_ID]
        );
        
        // If wmth != 0, there's an error
        const hasError = Math.abs(wmth) >= 0.01;
        
        // Only include if there are actual records
        const hasRecords = earningsResult[0].total > 0 || deductionsResult[0].total > 0 || cumResult.length > 0 || allowanceResult[0].total > 0;
        
        if (hasRecords && (!showErrorsOnly || hasError)) {
          reconciliationResults.push({
            employee_number: emp.Empl_ID,
            employee_name: emp.employee_name,
            title: emp.Title,
            title_description: emp.title_description,
            year: year,
            period: monthOnly,
            
            // Breakdown
            total_earnings: parseFloat(earningsResult[0].total),
            total_allowances: parseFloat(allowanceResult[0].total),
            total_deductions: parseFloat(deductionsResult[0].total),
            gross_from_cum: grossmth,
            roundup: roundup,
            net_from_cum: netmth,
            tax_from_cum: taxmth,
            
            // Calculated variance
            error_amount: Math.round(wmth * 100) / 100,
            
            // Status
            status: hasError ? 'ERROR' : 'BALANCED',
            
            // Payment breakdown
            payment_breakdown: paymentBreakdown.map(pb => ({
              type: pb.his_type,
              type_description: pb.type_description,
              category: this.categorizePaymentType(pb.type_prefix),
              amount: parseFloat(pb.amount)
            }))
          });
        }
      } catch (error) {
        console.error(`Error processing employee ${emp.Empl_ID}:`, error);
      }
    }
    
    console.log(`✅ Reconciliation complete: ${reconciliationResults.length} employees with records, ${reconciliationResults.filter(r => r.status === 'ERROR').length} with errors`);
    
    return reconciliationResults;
  }

  /**
   * Get reconciliation report with summary and details
   */
  async getReconciliationReport(filters = {}) {
    const summary = await this.getSalaryReconciliationSummary(filters);
    const details = await this.getEmployeeReconciliation(filters);
    
    const errorsOnly = details.filter(d => d.status === 'ERROR');
    
    return {
      summary: summary[0] || null,
      total_employees_checked: details.length,
      employees_with_errors: errorsOnly.length,
      total_error_amount: errorsOnly.reduce((sum, d) => sum + Math.abs(d.error_amount), 0),
      details: errorsOnly,
      all_details: details // Include all if needed
    };
  }

  /**
   * Categorize payment type prefixes
   */
  categorizePaymentType(prefix) {
    const categories = {
      'BP': 'Basic Pay',
      'BT': 'Basic Pay Component',
      'PT': 'Allowance',
      'PU': 'Round Up',
      'PR': 'Deduction',
      'PL': 'Loan'
    };
    return categories[prefix] || 'Other';
  }

  /**
   * Get payment type analysis - which types are causing errors
   */
  async getPaymentTypeErrorAnalysis(filters = {}) {
    const { year, month, database } = filters;
    
    const reconciliation = await this.getEmployeeReconciliation({ ...filters, showErrorsOnly: true });
    
    // Aggregate by payment type
    const typeAnalysis = {};
    
    reconciliation.forEach(emp => {
      emp.payment_breakdown.forEach(payment => {
        if (!typeAnalysis[payment.type]) {
          typeAnalysis[payment.type] = {
            type: payment.type,
            category: payment.category,
            occurrences: 0,
            total_amount: 0,
            employees: []
          };
        }
        
        typeAnalysis[payment.type].occurrences++;
        typeAnalysis[payment.type].total_amount += payment.amount;
        typeAnalysis[payment.type].employees.push({
          employee_number: emp.employee_number,
          employee_name: emp.employee_name,
          amount: payment.amount
        });
      });
    });
    
    return Object.values(typeAnalysis).sort((a, b) => b.occurrences - a.occurrences);
  }
}

module.exports = new ReconciliationService();