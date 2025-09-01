const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const mysql = require('mysql2/promise');

// 1. Configure MSSQL
const mssqlConfig = {
  user: 'sa',
  password: 'H1cadServer',
  server: 'DESKTOP-NIL5C6H\\SQL2022',
  port: 1433,
  database: 'HicadData',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// 2. Configure MySQL
const mysqlConfig = {
  host: 'localhost',
  user: 'Hicad',
  password: 'H1cadServer',
  database: 'HicadData'
};

// 3. List of all tables (from your SQL script)
const tablesToMigrate = [
  "dbo.py_totalemolument",
  "dbo.hr_employees",
  "dbo.py_temprecon",
  "dbo.py_masterpayded",
  "dbo.py_elementType",
  "dbo.py_salarygroup",
  "dbo.py_salaryscale",
  "dbo.py_oneoffhistory",
  "dbo.py_wkemployees",
  "dbo.py_stdrate",
  "dbo.py_mastercum",
  "dbo.ac_months",
  "dbo.aa_salaryscale",
  "dbo.ac_businessline",
  "dbo.ac_costcentre",
  "dbo.accchart",
  "dbo.fl_pendingSMS",
  "dbo.hr_employees_230910",
  "dbo.payrolljournals",
  "dbo.py_b4kelement",
  "dbo.py_b4kmascum",
  "dbo.py_b4kmaspayded",
  "dbo.py_b4kstdrate",
  "dbo.py_bakelement",
  "dbo.py_bakinpcumulated",
  "dbo.py_bakinpheader",
  "dbo.py_bakinpoperative",
  "dbo.py_bakinpover",
  "dbo.py_bakinppayded",
  "dbo.py_bakmascum",
  "dbo.py_bakmascum_bad",
  "dbo.py_bakmasope",
  "dbo.py_bakmasover",
  "dbo.py_bakmaspayded",
  "dbo.py_bakstdrate",
  "dbo.py_bank",
  "dbo.py_bank_OLD170808",
  "dbo.py_bankCPO",
  "dbo.py_bankvouchers",
  "dbo.py_calculation",
  "dbo.py_calculation_5mthsconafss",
  "dbo.py_Country",
  "dbo.py_cumulated",
  "dbo.py_department",
  "dbo.py_documentation",
  "dbo.py_emplhistory",
  "dbo.py_emplhistory_201709",
  "dbo.py_emplhistory_XXX",
  "dbo.py_exclusiveType",
  "dbo.py_factory",
  "dbo.py_formfile",
  "dbo.py_FunctionType",
  "dbo.py_Grade",
  "dbo.py_gradelevel",
  "dbo.py_header",
  "dbo.py_inputhistory",
  "dbo.py_ipis_payhistory",
  "dbo.py_journals",
  "dbo.py_journals_bad",
  "dbo.py_journals_old",
  "dbo.py_MaritalStatus",
  "dbo.py_masterope",
  "dbo.py_masterover",
  "dbo.py_masterpayded_0805",
  "dbo.py_navalcommand",
  "dbo.py_oneoffrank",
  "dbo.py_oneofftype",
  "dbo.py_operative",
  "dbo.py_overtime",
  "dbo.py_payaccess",
  "dbo.py_payded",
  "dbo.py_payded_off",
  "dbo.py_paydesc",
  "dbo.py_payhistory",
  "dbo.py_payind",
  "dbo.py_paylogfile",
  "dbo.py_paypassword",
  "dbo.py_paypassword_20200715",
  "dbo.py_paypassword_bad",
  "dbo.py_payperrank",
  "dbo.py_payrollclass",
  "dbo.py_paysystem",
  "dbo.py_pfa",
  "dbo.py_pkeeppasswd",
  "dbo.py_relationship",
  "dbo.py_salary",
  "dbo.py_salarymax",
  "dbo.py_salaryrecon",
  "dbo.py_salaryscale_2012",
  "dbo.py_salaryscale_2018",
  "dbo.py_salaryscale_old",
  "dbo.py_salaryscalew",
  "dbo.py_specialisationarea",
  "dbo.py_Status",
  "dbo.py_stdrate_bad",
  "dbo.py_tabcont",
  "dbo.py_tax",
  "dbo.py_tblLGA",
  "dbo.py_tblstates",
  "dbo.py_TEMP_payhistory",
  "dbo.py_tempbankoneoff",
  "dbo.py_tempbranchcode",
  "dbo.py_tempemployees",
  "dbo.py_temploan",
  "dbo.py_tempnewpayslip",
  "dbo.py_tempnsitf",
  "dbo.py_tempreghistory",
  "dbo.py_tempregister",
  "dbo.py_tempsalaryscale",
  "dbo.py_tempslipnlpc",
  "dbo.py_tempstafflist",
  "dbo.py_tempsumm",
  "dbo.py_temptypereport",
  "dbo.py_Title",
  "dbo.py_webpayslip",
  "dbo.py_wkemployees_bad",
  "dbo.py_workpayslip"
];

// 4. Stored procedure list
const proceduresToExport = [
  "dbo.changecodes",
  "dbo.py_calc_backup",
  "dbo.py_calc_pay",
  "dbo.py_calc_restore",
  "dbo.py_calculate_01",
  "dbo.py_calculate_02",
  "dbo.py_calculate_tax",
  "dbo.py_change_recordkey",
  "dbo.py_changecodes",
  "dbo.py_collate_payslip",
  "dbo.py_Compute_Arrears",
  "dbo.py_correct_histperiod",
  "dbo.py_extractrec",
  "dbo.py_get_value",
  "dbo.py_ippis_payslip",
  "dbo.py_pullippis_payments",
  "dbo.py_py24slip",
  "dbo.py_py37Monthend",
  "dbo.py_recall_payrollfiles",
  "dbo.py_save_payrollfiles",
  "dbo.py_SendPaySMS",
  "dbo.py_update_payrollfiles",
  "dbo.py_updatepayroll_00",
  "dbo.py_updatepayroll_01",
  "dbo.py_updatepayroll_02",
  "dbo.py_updatepayroll_03",
  "dbo.py_updatepayroll_04",
  "dbo.py_updatepayroll_05",
  "dbo.py_updatepayroll_06",
  "dbo.sp_getPayslip",
  "dbo.sp_getPendingsSms",
  "dbo.sp_updatePendingsSms",
  "dbo.UpdateSuccess"
];

// 5. Function to migrate a table
async function migrateTable(tableName) {
  try {
    const mssqlPool = await sql.connect(mssqlConfig);
    const mysqlConn = await mysql.createConnection(mysqlConfig);

    const result = await mssqlPool.request().query(`SELECT * FROM ${tableName}`);
    const rows = result.recordset;

    if (rows.length === 0) {
      console.log(`⚠️  No data in ${tableName}`);
      return;
    }

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(',');
    const insertQuery = `INSERT INTO ${tableName.replace('dbo.', '')} (${columns.join(',')}) VALUES (${placeholders})`;

    for (const row of rows) {
      const values = columns.map(col => row[col] === undefined ? null : row[col]);
      await mysqlConn.execute(insertQuery, values);
    }

    console.log(`✅ Migrated ${rows.length} rows to ${tableName}`);
  } catch (err) {
    console.error(`❌ Error migrating ${tableName}:`, err.message);
  }
}

// 6. Function to export stored procedures
async function exportProcedures() {
  try {
    const mssqlPool = await sql.connect(mssqlConfig);
    const outputDir = path.join(__dirname, "procedures_export");

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    for (const proc of proceduresToExport) {
      try {
        const result = await mssqlPool.request().query(`sp_helptext '${proc}'`);
        const lines = result.recordset.map(r => r.Text).join('');
        const filePath = path.join(outputDir, `${proc.replace('dbo.', '')}.sql`);
        fs.writeFileSync(filePath, lines, 'utf8');
        console.log(`📦 Exported procedure: ${proc}`);
      } catch (err) {
        console.error(`⚠️ Failed to export ${proc}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("❌ Error exporting procedures:", err.message);
  }
}

// 7. Run migration
(async () => {
  for (const table of tablesToMigrate) {
    await migrateTable(table);
  }

  await exportProcedures();

  console.log('🎉 Migration complete: all tables + stored procedures exported!');
  process.exit();
})();
