const sql = require('mssql');
const mysql = require('mysql2/promise');

// 1. Configure MSSQL
const mssqlConfig = {
  user: 'sa',
  password: 'H1cadServer',
  server: 'HICAD-THREEONE\\SQL2022',
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

const tablesToMigrate = [
  /*"dbo.py_totalemolument",
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
  "dbo.py_workpayslip"*/
  "dbo.py_tblstates"
];

// Helper: Check if two strings match with at least 5 consecutive letters
function fuzzyMatch(str1, str2, minMatch = 5) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  for (let i = 0; i <= s1.length - minMatch; i++) {
    const substr = s1.substring(i, i + minMatch);
    if (s2.includes(substr)) {
      return true;
    }
  }
  return false;
}

// Helper: Map MSSQL data type to MySQL data type
function mapDataType(mssqlType, length, precision, scale) {
  const typeMap = {
    'int': 'INT',
    'bigint': 'BIGINT',
    'smallint': 'SMALLINT',
    'tinyint': 'TINYINT',
    'bit': 'TINYINT(1)',
    'decimal': `DECIMAL(${precision || 18},${scale || 0})`,
    'numeric': `DECIMAL(${precision || 18},${scale || 0})`,
    'money': 'DECIMAL(19,4)',
    'smallmoney': 'DECIMAL(10,4)',
    'float': 'DOUBLE',
    'real': 'FLOAT',
    'datetime': 'DATETIME',
    'datetime2': 'DATETIME',
    'smalldatetime': 'DATETIME',
    'date': 'DATE',
    'time': 'TIME',
    'timestamp': 'TIMESTAMP',
    'char': `CHAR(${length || 1})`,
    'varchar': `VARCHAR(${length === -1 ? 'MAX' : length || 255})`,
    'text': 'TEXT',
    'nchar': `CHAR(${length || 1})`,
    'nvarchar': `VARCHAR(${length === -1 ? 'MAX' : length || 255})`,
    'ntext': 'TEXT',
    'binary': `BINARY(${length || 1})`,
    'varbinary': `VARBINARY(${length === -1 ? 'MAX' : length || 255})`,
    'image': 'BLOB',
    'uniqueidentifier': 'VARCHAR(36)'
  };

  const baseType = mssqlType.toLowerCase();
  let mysqlType = typeMap[baseType] || 'VARCHAR(255)';
  
  // Handle VARCHAR(MAX)
  if (mysqlType.includes('MAX')) {
    mysqlType = mysqlType.replace('MAX', '65535');
  }
  
  return mysqlType;
}

// Parse table name to extract schema and table
function parseTableName(fullTableName) {
  const parts = fullTableName.split('.');
  if (parts.length === 2) {
    return {
      schema: parts[0],
      table: parts[1]
    };
  }
  return {
    schema: 'dbo', // default schema
    table: fullTableName
  };
}

// Get column definitions from MSSQL
async function getMSSQLColumns(mssqlPool, tableName) {
  const { schema, table } = parseTableName(tableName);
  
  const query = `
    SELECT 
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      IS_NULLABLE,
      COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = @tableName
    ORDER BY ORDINAL_POSITION
  `;
  
  const result = await mssqlPool.request()
    .input('schema', sql.VarChar, schema)
    .input('tableName', sql.VarChar, table)
    .query(query);
  
  return result.recordset;
}

// Get existing MySQL columns
async function getMySQLColumns(mysqlConn, tableName) {
  try {
    const [rows] = await mysqlConn.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return rows.map(row => row.Field);
  } catch (err) {
    return []; // Table doesn't exist
  }
}

// Check if MySQL table exists
async function tableExists(mysqlConn, tableName) {
  const [rows] = await mysqlConn.query(
    `SELECT COUNT(*) as count FROM information_schema.tables 
     WHERE table_schema = ? AND table_name = ?`,
    [mysqlConfig.database, tableName]
  );
  return rows[0].count > 0;
}

// Create MySQL table from MSSQL schema
async function createMySQLTable(mysqlConn, mysqlTableName, mssqlColumns) {
  const columnDefs = mssqlColumns.map(col => {
    const mysqlType = mapDataType(
      col.DATA_TYPE,
      col.CHARACTER_MAXIMUM_LENGTH,
      col.NUMERIC_PRECISION,
      col.NUMERIC_SCALE
    );
    
    const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
    let defaultVal = '';
    
    if (col.COLUMN_DEFAULT) {
      // Clean up MSSQL default value syntax
      let defVal = col.COLUMN_DEFAULT.replace(/[()]/g, '').trim();
      if (defVal.toLowerCase() !== 'null') {
        defaultVal = `DEFAULT ${defVal}`;
      }
    }
    
    return `\`${col.COLUMN_NAME}\` ${mysqlType} ${nullable} ${defaultVal}`.trim();
  });

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS \`${mysqlTableName}\` (
      ${columnDefs.join(',\n      ')}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;

  await mysqlConn.query(createTableSQL);
  console.log(`📋 Created table: ${mysqlTableName}`);
}

// Add missing columns to existing table
async function addMissingColumns(mysqlConn, mysqlTableName, mssqlColumns, existingColumns) {
  for (const col of mssqlColumns) {
    const columnName = col.COLUMN_NAME;
    
    // Check exact match first
    let found = existingColumns.includes(columnName);
    
    // If not found, check fuzzy match
    if (!found) {
      found = existingColumns.some(existing => 
        fuzzyMatch(columnName, existing) || fuzzyMatch(existing, columnName)
      );
    }
    
    if (!found) {
      const mysqlType = mapDataType(
        col.DATA_TYPE,
        col.CHARACTER_MAXIMUM_LENGTH,
        col.NUMERIC_PRECISION,
        col.NUMERIC_SCALE
      );
      
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      
      const alterSQL = `ALTER TABLE \`${mysqlTableName}\` ADD COLUMN \`${columnName}\` ${mysqlType} ${nullable}`;
      
      try {
        await mysqlConn.query(alterSQL);
        console.log(`  ➕ Added column: ${columnName} (${mysqlType})`);
      } catch (err) {
        console.warn(`  ⚠️  Could not add column ${columnName}: ${err.message}`);
      }
    }
  }
}

// Map column names (fuzzy matching)
function mapColumnNames(mssqlColumns, mysqlColumns) {
  const mapping = {};
  
  for (const mssqlCol of mssqlColumns) {
    // First try exact match
    if (mysqlColumns.includes(mssqlCol)) {
      mapping[mssqlCol] = mssqlCol;
      continue;
    }
    
    // Then try fuzzy match
    const match = mysqlColumns.find(mysqlCol => 
      fuzzyMatch(mssqlCol, mysqlCol) || fuzzyMatch(mysqlCol, mssqlCol)
    );
    
    if (match) {
      mapping[mssqlCol] = match;
      console.log(`  🔗 Mapped column: ${mssqlCol} → ${match}`);
    } else {
      mapping[mssqlCol] = mssqlCol; // Use original if no match
    }
  }
  
  return mapping;
}

// Check if a column has a unique constraint or is a primary key
async function hasUniqueConstraint(mysqlConn, tableName, columnName) {
  const [rows] = await mysqlConn.query(`
    SELECT COLUMN_KEY 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_NAME = ?
  `, [mysqlConfig.database, tableName, columnName]);
  
  if (rows.length > 0) {
    const key = rows[0].COLUMN_KEY;
    return key === 'PRI' || key === 'UNI';
  }
  return false;
}

// Find primary key or unique identifier column
async function findIdentifierColumn(mysqlConn, mysqlTableName, mssqlColNames) {
  // First check for primary key
  const [pkRows] = await mysqlConn.query(`
    SELECT COLUMN_NAME 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_KEY = 'PRI'
    ORDER BY ORDINAL_POSITION
  `, [mysqlConfig.database, mysqlTableName]);
  
  if (pkRows.length > 0) {
    return pkRows[0].COLUMN_NAME;
  }
  
  // Then check for unique keys that exist in MSSQL data
  const [uniqueRows] = await mysqlConn.query(`
    SELECT COLUMN_NAME 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_KEY = 'UNI'
    ORDER BY ORDINAL_POSITION
  `, [mysqlConfig.database, mysqlTableName]);
  
  for (const row of uniqueRows) {
    if (mssqlColNames.includes(row.COLUMN_NAME)) {
      return row.COLUMN_NAME;
    }
  }
  
  // Fallback: look for common ID column names in MSSQL data
  const commonIdNames = ['id', 'ID', 'Id', mysqlTableName + 'ID', mysqlTableName + 'Id', mysqlTableName.toLowerCase() + '_id'];
  for (const idName of commonIdNames) {
    if (mssqlColNames.includes(idName)) {
      return idName;
    }
  }
  
  return null;
}

// Main migration function
async function migrateTable(fullTableName) {
  let mssqlPool, mysqlConn;
  
  try {
    const { schema, table } = parseTableName(fullTableName);
    const mysqlTableName = table; // Use only table name for MySQL
    
    console.log(`\n🔄 Processing table: ${fullTableName}`);
    
    mssqlPool = await sql.connect(mssqlConfig);
    mysqlConn = await mysql.createConnection(mysqlConfig);

    // Get MSSQL schema
    const mssqlColumns = await getMSSQLColumns(mssqlPool, fullTableName);
    
    if (mssqlColumns.length === 0) {
      console.log(`  ⚠️  Table ${fullTableName} not found in MSSQL`);
      console.log(`  💡 Tip: Check if table exists in schema '${schema}'`);
      return;
    }

    // Check if MySQL table exists
    const exists = await tableExists(mysqlConn, mysqlTableName);
    
    if (!exists) {
      // Create table
      await createMySQLTable(mysqlConn, mysqlTableName, mssqlColumns);
    } else {
      // Add missing columns
      const existingColumns = await getMySQLColumns(mysqlConn, mysqlTableName);
      await addMissingColumns(mysqlConn, mysqlTableName, mssqlColumns, existingColumns);
    }

    // Get data from MSSQL (use full table name with schema)
    const selectQuery = schema ? `SELECT * FROM [${schema}].[${table}]` : `SELECT * FROM [${table}]`;
    const result = await mssqlPool.request().query(selectQuery);
    const rows = result.recordset;

    if (rows.length === 0) {
      console.log(`  ℹ️  No data to migrate in ${fullTableName}`);
      return;
    }

    // Get current MySQL columns for mapping
    const currentMySQLColumns = await getMySQLColumns(mysqlConn, mysqlTableName);
    
    // Map MSSQL columns to MySQL columns
    const mssqlColNames = mssqlColumns.map(c => c.COLUMN_NAME);
    const columnMapping = mapColumnNames(mssqlColNames, currentMySQLColumns);

    // Find identifier column for UPDATE operations
    const identifierCol = await findIdentifierColumn(mysqlConn, mysqlTableName, mssqlColNames);
    
    // Determine which columns to insert (only those from MSSQL)
    const columnsToInsert = mssqlColNames.map(col => columnMapping[col]);
    
    // Check for extra columns in MySQL
    const extraMySQLColumns = currentMySQLColumns.filter(mysqlCol => {
      return !columnsToInsert.includes(mysqlCol) && 
             !Object.values(columnMapping).includes(mysqlCol);
    });
    
    if (extraMySQLColumns.length > 0) {
      console.log(`  📌 MySQL has ${extraMySQLColumns.length} extra column(s): ${extraMySQLColumns.join(', ')}`);
    }

    // Insert or Update data with batch processing
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const batchSize = 100;
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      for (const row of batch) {
        try {
          const values = mssqlColNames.map(col => {
            const val = row[col];
            return val === undefined || val === null ? null : val;
          });
          
          // If we have an identifier column, use INSERT ... ON DUPLICATE KEY UPDATE
          if (identifierCol && columnMapping[identifierCol]) {
            const idValue = row[identifierCol];
            
            if (idValue !== null && idValue !== undefined) {
              // Check if record exists
              const [existing] = await mysqlConn.query(
                `SELECT COUNT(*) as count FROM \`${mysqlTableName}\` WHERE \`${columnMapping[identifierCol]}\` = ?`,
                [idValue]
              );
              
              if (existing[0].count > 0) {
                // UPDATE existing record (preserves extra MySQL columns)
                const updatePairs = columnsToInsert
                  .filter(col => col !== columnMapping[identifierCol])
                  .map(col => `\`${col}\` = ?`)
                  .join(', ');
                
                const updateValues = mssqlColNames
                  .filter(col => col !== identifierCol)
                  .map(col => row[col] === undefined || row[col] === null ? null : row[col]);
                
                updateValues.push(idValue);
                
                const updateQuery = `UPDATE \`${mysqlTableName}\` SET ${updatePairs} WHERE \`${columnMapping[identifierCol]}\` = ?`;
                await mysqlConn.execute(updateQuery, updateValues);
                updatedCount++;
                continue; // ← PREVENTS DUPLICATE INSERT
              }
            }
          }
          
          // INSERT new record (only if it doesn't exist)
          try {
            const placeholders = columnsToInsert.map(() => '?').join(',');
            const insertQuery = `INSERT INTO \`${mysqlTableName}\` (${columnsToInsert.map(c => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
            await mysqlConn.execute(insertQuery, values);
            insertedCount++;
          } catch (insertErr) {
            // Handle duplicate key errors gracefully
            if (insertErr.code === 'ER_DUP_ENTRY') {
              skippedCount++;
              console.log(`  ⏭️  Skipped duplicate record in ${mysqlTableName}`);
            } else {
              throw insertErr;
            }
          }
          
        } catch (err) {
          console.warn(`  ⚠️  Error processing row: ${err.message}`);
        }
      }
    }

    if (updatedCount > 0 || skippedCount > 0) {
      console.log(`  ✅ Inserted ${insertedCount} | Updated ${updatedCount} | Skipped ${skippedCount} | Total: ${insertedCount + updatedCount}/${rows.length} rows`);
    } else {
      console.log(`  ✅ Migrated ${insertedCount}/${rows.length} rows to ${mysqlTableName}`);
    }
    
  } catch (err) {
    console.error(`  ❌ Error migrating ${fullTableName}:`, err.message);
  } finally {
    if (mssqlPool) await mssqlPool.close();
    if (mysqlConn) await mysqlConn.end();
  }
}

// Main execution
(async () => {
  console.log('🚀 Starting MSSQL to MySQL Migration\n');
  console.log('=' .repeat(50));
  
  for (const table of tablesToMigrate) {
    await migrateTable(table);
  }

  console.log('\n' + '='.repeat(50));
  console.log('🎉 Migration completed!');
  process.exit(0);
})();