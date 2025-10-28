const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.getInputVariableChanges = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'InputVariableChanges', year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.empl_id,
        c.pay_type,
        IFNULL(p.amtad, 0) AS PrevAmount,
        IFNULL(c.amtad, 0) AS CurrAmount,
        (IFNULL(c.amtad,0) - IFNULL(p.amtad,0)) AS Difference,
        CASE 
          WHEN IFNULL(p.amtad,0) <> IFNULL(c.amtad,0) THEN 'CHANGED'
          ELSE 'UNCHANGED'
        END AS Status
      FROM py_payded c
      LEFT JOIN py_bakpy_payded p 
        ON c.empl_id = p.empl_id AND c.pay_type = p.pay_type
      WHERE IFNULL(p.amtad,0) <> IFNULL(c.amtad,0);
    `);

    await updateLog(logId, 'SUCCESS', `Detected ${rows.length} variable changes.`);
    return { totalChanges: rows.length, records: rows };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
