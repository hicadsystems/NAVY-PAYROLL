const pool = require('../../config/db');
const { startLog, updateLog } = require('../../services/logService');

exports.getPersonnelChanges = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'PersonnelChanges', year, month, user);
  try {
    // Use the view we created
    const [rows] = await pool.query(`
      SELECT 
        Empl_ID,
        full_name,
        Location,
        Factory,
        current_values,
        previous_values,
        change_summary,
        change_category,
        risk_level,
        detected_at
      FROM vw_personnel_changes
      ORDER BY 
        FIELD(risk_level, 'HIGH', 'MEDIUM', 'LOW'),
        change_category,
        full_name
    `);

    // No need to parse - MySQL JSON columns are already objects
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

    await updateLog(logId, 'SUCCESS', `Detected ${records.length} personnel changes.`);
    
    // Return summary statistics
    const summary = {
      totalChanges: records.length,
      byRisk: {
        high: records.filter(r => r.risk_level === 'HIGH').length,
        medium: records.filter(r => r.risk_level === 'MEDIUM').length,
        low: records.filter(r => r.risk_level === 'LOW').length
      },
      byCategory: {
        newEmployee: records.filter(r => r.change_category === 'NEW_EMPLOYEE').length,
        terminated: records.filter(r => r.change_category === 'TERMINATED').length,
        statusChanged: records.filter(r => r.change_category === 'STATUS_CHANGED').length,
        promoted: records.filter(r => r.change_category === 'PROMOTED/DOWNGRADED').length,
        bankChanged: records.filter(r => r.change_category === 'BANK_DETAILS_CHANGED').length,
        other: records.filter(r => r.change_category === 'OTHER_CHANGE').length
      },
      criticalChanges: records.filter(r => 
        r.change_summary.includes('BANK_CODE') || 
        r.change_summary.includes('ACCOUNT_NUMBER') ||
        r.change_summary.includes('GRADE_LEVEL')
      ).length
    };

    return { summary, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get only HIGH RISK personnel changes (bank/account changes)
exports.getHighRiskPersonnelChanges = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'HighRiskPersonnelChanges', year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_personnel_changes
      WHERE risk_level = 'HIGH'
      ORDER BY full_name
    `);

    const records = rows.map(row => ({
      ...row,
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Found ${records.length} high-risk personnel changes.`);
    return { totalChanges: records.length, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get changes by category
exports.getPersonnelChangesByCategory = async (category, year, month, user) => {
  const logId = await startLog('FileUpdate', `PersonnelChanges_${category}`, year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_personnel_changes
      WHERE change_category = ?
      ORDER BY full_name
    `, [category]);

    const records = rows.map(row => ({
      ...row,
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Found ${records.length} ${category} changes.`);
    return { totalChanges: records.length, records };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};