const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

exports.getInputVariableChanges = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'InputVariableChanges', year, month, user);
  try {
    // Use the view we created - much simpler!
    const [rows] = await pool.query(`
      SELECT 
        Empl_id,
        full_name,
        Location,
        pay_type,
        element_name,
        function_type_desc,
        function_type_code,
        pay_indicator_desc,
        pay_indicator_code,
        element_category,
        current_values,
        previous_values,
        amt_difference,
        amtp_difference,
        amttd_difference,
        change_summary,
        change_category,
        risk_level,
        detected_at
      FROM vw_input_variable_changes
      ORDER BY 
        FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'),
        ABS(amt_difference) DESC,
        full_name,
        pay_type
    `);

    // Parse JSON fields for easier frontend consumption
    const records = rows.map(row => ({
      ...row,
      // Only parse if they're strings (defensive coding)
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Detected ${records.length} variable changes.`);
    
    // Return summary statistics
    const summary = {
      totalChanges: records.length,
      byRisk: {
        high: records.filter(r => r.risk_level === 'HIGH').length,
        medium: records.filter(r => r.risk_level === 'MEDIUM').length,
        low: records.filter(r => r.risk_level === 'LOW').length
      },
      byCategory: {
        newEntry: records.filter(r => r.change_category === 'NEW_ENTRY').length,
        paymentTypeChanged: records.filter(r => r.change_category === 'PAYMENT_TYPE_CHANGED').length,
        payIndicatorChanged: records.filter(r => r.change_category === 'PAY_INDICATOR_CHANGED').length,
        amountIncreased: records.filter(r => r.change_category === 'AMOUNT_INCREASED').length,
        amountDecreased: records.filter(r => r.change_category === 'AMOUNT_DECREASED').length,
        directionChanged: records.filter(r => r.change_category === 'DIRECTION_CHANGED').length,
        otherModified: records.filter(r => r.change_category === 'OTHER_MODIFIED').length
      },
      byElementType: {
        required: records.filter(r => r.element_category === 'REQUIRED_FOR_ALL').length,
        allowances: records.filter(r => r.element_category === 'ALLOWANCE').length,
        deductions: records.filter(r => r.element_category === 'DEDUCTION').length,
        other: records.filter(r => r.element_category === 'OTHER').length
      },
      byFunctionType: {
        loans: records.filter(r => r.function_type_code === 'L').length,
        permanent: records.filter(r => r.function_type_code === 'P').length,
        temporary: records.filter(r => r.function_type_code === 'T').length,
        hourly: records.filter(r => r.function_type_code === 'H').length,
        freePay: records.filter(r => r.function_type_code === 'F').length,
        independent: records.filter(r => r.function_type_code === 'X').length
      },
      financialImpact: {
        totalAmtDifference: records.reduce((sum, r) => sum + (r.amt_difference || 0), 0),
        totalAmtpDifference: records.reduce((sum, r) => sum + (r.amtp_difference || 0), 0),
        totalAmttdDifference: records.reduce((sum, r) => sum + (r.amttd_difference || 0), 0),
        netImpact: records.reduce((sum, r) => {
          const current = r.current_values || {};
          const amtad = current.amtad || '';
          const diff = r.amt_difference || 0;
          // Positive for additions, negative for deductions
          return sum + (amtad === 'Add' ? diff : -diff);
        }, 0)
      },
      topChanges: {
        largestIncrease: records
          .filter(r => r.amt_difference > 0)
          .sort((a, b) => b.amt_difference - a.amt_difference)
          .slice(0, 5)
          .map(r => ({
            Empl_id: r.Empl_id,
            full_name: r.full_name,
            element_name: r.element_name,
            amt_difference: r.amt_difference
          })),
        largestDecrease: records
          .filter(r => r.amt_difference < 0)
          .sort((a, b) => a.amt_difference - b.amt_difference)
          .slice(0, 5)
          .map(r => ({
            Empl_id: r.Empl_id,
            full_name: r.full_name,
            element_name: r.element_name,
            amt_difference: r.amt_difference
          }))
      }
    };

    return { summary, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get filtered changes by risk level
exports.getInputVariableChangesByRisk = async (riskLevel, year, month, user) => {
  const logId = await startLog('FileUpdate', `InputVariableChanges_${riskLevel}`, year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variable_changes
      WHERE risk_level = ?
      ORDER BY full_name, pay_type
    `, [riskLevel]);

    const records = rows.map(row => ({
      ...row,
      // Only parse if they're strings (defensive coding)
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Found ${records.length} ${riskLevel} risk changes.`);
    return { totalChanges: records.length, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get changes by payment indicator (e.g., LOAN)
exports.getInputVariableChangesByIndicator = async (indicator, year, month, user) => {
  const logId = await startLog('FileUpdate', `InputVariableChanges_${indicator}`, year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variable_changes
      WHERE payment_indicator = ?
      ORDER BY 
        FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'),
        full_name
    `, [indicator]);

    const records = rows.map(row => ({
      ...row,
      // Only parse if they're strings (defensive coding)
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Found ${records.length} ${indicator} changes.`);
    return { totalChanges: records.length, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
