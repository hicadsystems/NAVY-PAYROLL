const pool = require('../../config/db');

exports.runCalculations = async (year, month, user) => {
  const startTime = Date.now();
  
  try {
    // Sequential SP calls
    const procedures = [
      'sp_calculate_01_complete_optimized',
      //'sp_calculate_02_optimized', 
      //'py_calculate_tax_optimized'
    ];
    
    for (const sp of procedures) {
      await pool.query(`CALL ${sp}(?, ?, ?, ?)`, [user, 500, 'NAVY', 'No']);
    }

    // Get reconciliation after calculations
    const reconciliationQuery = `
      SELECT 
          sr.ord as year,
          sr.mth as month,
          
          -- From cumulative (summary)
          (SELECT ROUND(COALESCE(SUM(his_netmth), 0), 2) 
           FROM py_mastercum WHERE his_type = sr.mth) as total_net_cumulative,
          
          -- From detail breakdown
          (SELECT ROUND(
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
           FROM py_masterpayded) as total_net_detail,
          
          -- Gross pay
          (SELECT ROUND(COALESCE(SUM(his_grossmth), 0), 2) 
           FROM py_mastercum WHERE his_type = sr.mth) as total_gross,
          
          -- Tax
          (SELECT ROUND(COALESCE(SUM(his_taxmth), 0), 2) 
           FROM py_mastercum WHERE his_type = sr.mth) as total_tax,
          
          -- Deductions
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0), 2)
           FROM py_masterpayded) as total_deductions,
          
          -- Allowances
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
           FROM py_masterpayded) as total_allowances,
          
          -- Employee count
          (SELECT COUNT(DISTINCT his_empno) 
           FROM py_mastercum WHERE his_type = sr.mth) as employee_count,
          
          -- Variance
          ABS((SELECT COALESCE(SUM(his_netmth), 0) FROM py_mastercum WHERE his_type = sr.mth) - 
              (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
               FROM py_masterpayded)) as variance,
          
          -- Status check
          CASE 
              WHEN ABS((SELECT COALESCE(SUM(his_netmth), 0) FROM py_mastercum WHERE his_type = sr.mth) - 
                       (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                               COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                               COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                               COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
                        FROM py_masterpayded)) < 1
              THEN 'BALANCED'
              ELSE 'VARIANCE_DETECTED'
          END as reconciliation_status
      FROM (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
    `;
    
    const [reconciliation] = await pool.query(reconciliationQuery);
    const recon = reconciliation[0] || {};
    
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    return {
      year: recon.year || year,
      month: recon.month || month,
      employees_processed: parseInt(recon.employee_count) || 0,
      time_seconds: executionTime,
      reconciliation: {
        total_net_cumulative: parseFloat(recon.total_net_cumulative) || 0,
        total_net_detail: parseFloat(recon.total_net_detail) || 0,
        total_gross: parseFloat(recon.total_gross) || 0,
        total_tax: parseFloat(recon.total_tax) || 0,
        total_deductions: parseFloat(recon.total_deductions) || 0,
        total_allowances: parseFloat(recon.total_allowances) || 0,
        variance: parseFloat(recon.variance) || 0,
        status: recon.reconciliation_status,
        is_balanced: recon.reconciliation_status === 'BALANCED'
      }
    };
  } catch (err) {
    console.error('Payroll calculation service error:', err);
    throw err;
  }
};