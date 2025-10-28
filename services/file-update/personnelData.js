const pool = require('../../config/db');
const { startLog, updateLog } = require('../../routes/helpers/logService');

exports.getPersonnelChanges = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'PersonnelChanges', year, month, user);
  try {
    // Compare current vs last month's master data
    const [rows] = await pool.query(`
      SELECT 
        cur.Empl_ID,
        cur.Name,
        cur.GradeLevel AS CurrentGrade,
        prev.GradeLevel AS PreviousGrade,
        cur.BasicSalary AS CurrentBasic,
        prev.BasicSalary AS PreviousBasic,
        CASE 
          WHEN cur.BasicSalary != prev.BasicSalary THEN 'SALARY CHANGED'
          WHEN cur.GradeLevel != prev.GradeLevel THEN 'GRADE CHANGED'
          WHEN cur.BankCode != prev.BankCode THEN 'BANK CHANGED'
          ELSE 'UNCHANGED'
        END AS ChangeType
      FROM py_masterfile cur
      LEFT JOIN py_bakmasfile prev
        ON cur.Empl_ID = prev.Empl_ID
      WHERE (cur.BasicSalary != prev.BasicSalary 
          OR cur.GradeLevel != prev.GradeLevel 
          OR cur.BankCode != prev.BankCode);
    `);

    await updateLog(logId, 'SUCCESS', `Detected ${rows.length} personnel changes.`);
    return { totalChanges: rows.length, records: rows };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};
