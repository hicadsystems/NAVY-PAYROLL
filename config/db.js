const dbConfig = require("./db-config");
const mysql = require("mysql2/promise");

// ==========================================
// MASTER DATABASE CONFIGURATION
// ==========================================

const MASTER_DB = process.env.DB_OFFICERS || 'hicaddata';

// List of master tables that need to be qualified
const MASTER_TABLES = new Set([
  // Employee and Personal Info
  'hr_employees',
  'Spouse',
  'Children',
  'NextOfKin',
  
  // Organizational Structure
  'ac_businessline',
  'ac_costcentre',
  'accchart',
  'ac_months',
  'py_navalcommand',
  'py_paysystem',
  
  // Payroll Configuration
  'py_bank',
  //'py_elementType',
  //'py_exclusiveType',
  'py_functionType',
  'py_Grade',
  'py_gradelevel',
  'py_paydesc',
  'py_payind',
  'py_payrollclass',
  'py_paysystem',
  //'py_stdrate',
  //'py_tax',
  'py_salarygroup',
  'py_salaryscale',
  'py_exittype',
  'entrymode',
  'py_specialisationarea',
  
  // Lookup/Reference Tables
  'py_MaritalStatus',
  'py_pfa',
  'py_relationship',
  'py_religion',
  'py_status',
  'py_tblLga',
  'py_tblstates',
  'geozone',
  'py_Country',
  'py_Title',
  'py_sex',
  
  // System Tables
  'roles',
  'users'
]);

// Create connection pool
const connectionPool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  idleTimeout: 900000,
  connectTimeout: 60000, // Connection establishment timeout
  multipleStatements: false, // Security best practice
  timezone: '+00:00',
  charset: 'utf8mb4',
  flags: '+MULTI_STATEMENTS'
});

// Cache for database validation
const validDatabasesCache = new Set();
let cacheInitialized = false;

// Session-based database storage - each session/user has their own database context
const sessionDatabases = new Map();

// Context detection using AsyncLocalStorage for automatic session detection
const { AsyncLocalStorage } = require('async_hooks');
const sessionContext = new AsyncLocalStorage();

// Initialize cache with valid databases
const initializeDatabaseCache = () => {
  if (!cacheInitialized) {
    Object.values(dbConfig.databases).forEach(db => validDatabasesCache.add(db));
    cacheInitialized = true;
  }
};

// Middleware to set session context automatically (JWT-aware)
const setSessionContext = (req, res, next) => {
  const sessionId = req.user_id || req.session?.id || req.sessionID || 'default';
  sessionContext.run(sessionId, () => {
    next();
  });
};

// ==========================================
// HELPER: QUALIFY MASTER TABLES
// ==========================================

function qualifyMasterTables(sql, currentDb) {
  if (currentDb === MASTER_DB) return sql;
  
  let processedSql = sql;
  let modificationsCount = 0;
  
  MASTER_TABLES.forEach(table => {
    const regex = new RegExp(`(?<![.\\w])\\b${table}\\b(?=\\s|,|\\)|;|$|\\b(?!\\.))`, 'gi');
    const matches = sql.match(regex);
    if (matches) {
      processedSql = processedSql.replace(regex, `${MASTER_DB}.${table}`);
      modificationsCount += matches.length;
    }
  });
  
  if (modificationsCount > 0 && process.env.NODE_ENV !== 'production') {
    console.log(`🔗 Auto-qualified ${modificationsCount} master table(s) in ${currentDb}`);
  }
  
  return processedSql;
}

// ==========================================
// POOL OBJECT
// ==========================================

const pool = {
  // Middleware function to be used in Express app (optional - JWT middleware handles it)
  middleware: setSessionContext,

  // Method to switch database context for a specific session
  useDatabase(databaseName, sessionId = null) {
    initializeDatabaseCache();

    // Auto-detect session if not provided
    if (!sessionId) sessionId = sessionContext.getStore() || 'default';
    // Check if the database name exists in our config values or is a valid database name directly
    const validDatabases = Array.from(validDatabasesCache);
    const dbToUse = validDatabases.includes(databaseName) ? databaseName : dbConfig.databases[databaseName];
    
    if (!dbToUse) {
      throw new Error(`❌ Invalid database: ${databaseName}`);
    }
    
    sessionDatabases.set(sessionId, dbToUse);
    console.log(`📊 Database context: ${dbToUse} for session: ${sessionId}`);
    return this; // Allow chaining
  },

  // Get current database for a session (auto-detects session)
  getCurrentDatabase(sessionId = null) {
    if (!sessionId) sessionId = sessionContext.getStore() || 'default';
    return sessionDatabases.get(sessionId) || null;
  },

  // SMART QUERY METHODS (with auto-qualification)
  async smartQuery(sql, params = []) {
    const sessionId = sessionContext.getStore() || 'default';
    const currentDatabase = sessionDatabases.get(sessionId);
    
    if (!currentDatabase) {
      throw new Error(`❌ No database selected for session ${sessionId}`);
    }

    let connection;
    try {
      connection = await connectionPool.getConnection();
      // Switch to the current database
      await connection.query(`USE \`${currentDatabase}\``);
      
      const processedSql = qualifyMasterTables(sql, currentDatabase);

      // Execute the actual query
      const [rows, fields] = await connection.query(processedSql, params);
      return [rows, fields];
    } catch (error) {
      console.error(`❌ Query error on ${currentDatabase}for session ${sessionId}:`, error.message);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  },

  async smartExecute(sql, params = []) {
    const sessionId = sessionContext.getStore() || 'default';
    const currentDatabase = sessionDatabases.get(sessionId);

    if (!currentDatabase) {
      throw new Error(`❌ No database selected for session ${sessionId}`);
    }

    let connection;
    try {
      connection = await connectionPool.getConnection();
      await connection.query(`USE \`${currentDatabase}\``);

      const processedSql = qualifyMasterTables(sql, currentDatabase);

      // Use query() instead of execute() to avoid prepared statement cache issues
      // after USE database - execute() can return stale data from wrong database
      const [rows, fields] = await connection.query(processedSql, params);
      return [rows, fields];
    } catch (error) {
      console.error(`❌ Execute error on ${currentDatabase}:`, error.message);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  },

  // Get raw connection with automatic session database context
  async getConnection() {
    const connection = await connectionPool.getConnection();
    const sessionId = sessionContext.getStore() || 'default';
    const currentDatabase = sessionDatabases.get(sessionId);
    
    if (currentDatabase) {
      await connection.query(`USE \`${currentDatabase}\``);
    }
    return connection;
  },

  // Transaction support with automatic session Context
  async smartTransaction(callback) {
    const sessionId = sessionContext.getStore() || 'default';
    const currentDatabase = sessionDatabases.get(sessionId);
    
    if (!currentDatabase) {
      throw new Error(`❌ No database selected for session ${sessionId}`);
    }

    let connection;
    try {
      connection = await connectionPool.getConnection();
      await connection.query(`USE \`${currentDatabase}\``);
      await connection.beginTransaction();
      
      const smartConnection = {
        ...connection,
        query: async (sql, params = []) => {
          const processedSql = qualifyMasterTables(sql, currentDatabase);
          return connection.query(processedSql, params);
        },
        execute: async (sql, params = []) => {
          const processedSql = qualifyMasterTables(sql, currentDatabase);
          return connection.query(processedSql, params);
        }
      };
      
      const result = await callback(smartConnection);
      await connection.commit();
      return result;
    } catch (error) {
      if (connection) await connection.rollback();
      console.error(`❌ Transaction error on ${currentDatabase}:`, error.message);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  },

  // Batch operations for efficiency
  async batchQuery(queries) {
    const sessionId = sessionContext.getStore() || 'default';
    const currentDatabase = sessionDatabases.get(sessionId);
    
    if (!currentDatabase) {
      throw new Error(`❌ No database selected for session ${sessionId}`);
    }

    let connection;
    try {
      connection = await connectionPool.getConnection();
      await connection.query(`USE \`${currentDatabase}\``);
      
      const results = [];
      for (const { sql, params = [] } of queries) {
        const processedSql = qualifyMasterTables(sql, currentDatabase);
        const [rows, fields] = await connection.query(processedSql, params);
        results.push([rows, fields]);
      }
      return results;
    } catch (error) {
      console.error(`❌ Batch query error:`, error.message);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  },

  // Raw query without database context (for system queries)
  async rawQuery(sql, params = []) {
    let connection;
    try {
      connection = await connectionPool.getConnection();
      const [rows, fields] = await connection.query(sql, params);
      return [rows, fields];
    } catch (error) {
      console.error('❌ Raw query error:', error.message);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  },

  // Clear session database context (on logout)
  clearSession(sessionId = null) {
    if (!sessionId) sessionId = sessionContext.getStore() || 'default';
    const wasCleared = sessionDatabases.delete(sessionId);
    if (wasCleared) console.log(`Session cleared: ${sessionId}`);
    return wasCleared;
  },

  // Get all active sessions
  getActiveSessions() {
    return Array.from(sessionDatabases.keys());
  },

  // Get session database mappings
  getSessionMappings() {
    return Object.fromEntries(sessionDatabases);
  },

  // Utility methods
  getAvailableDatabases() {
    initializeDatabaseCache();
    return Array.from(validDatabasesCache);
  },

  // Helper method to get class name from database name
  getPayrollClassFromDatabase(databaseName) {
    for (const [className, dbName] of Object.entries(dbConfig.databases)) {
      if (dbName === databaseName) return className;
    }
    return null;
  },

  // Get database name from class name
  getDatabaseFromPayrollClass(className) {
    return dbConfig.databases[className] || null;
  },

  // Master DB utilities
  getMasterDb() {
    return MASTER_DB;
  },

  isMasterTable(tableName) {
    return MASTER_TABLES.has(tableName);
  },

  getMasterTables() {
    return Array.from(MASTER_TABLES);
  },

  qualify(tableName) {
    return MASTER_TABLES.has(tableName) ? `${MASTER_DB}.${tableName}` : tableName;
  },

  // Pool statistics
  getPoolStats() {
    const sessionId = sessionContext.getStore() || 'default';
    return {
      totalConnections: connectionPool.pool._allConnections.length,
      freeConnections: connectionPool.pool._freeConnections.length,
      usedConnections: connectionPool.pool._allConnections.length - connectionPool.pool._freeConnections.length,
      queuedRequests: connectionPool.pool._connectionQueue.length,
      activeSessions: sessionDatabases.size,
      currentSession: sessionId,
      currentDatabase: sessionDatabases.get(sessionId),
      sessionMappings: this.getSessionMappings(),
      masterDatabase: MASTER_DB,
      totalMasterTables: MASTER_TABLES.size
    };
  },

  // Health check
  async healthCheck() {
    try {
      const connection = await connectionPool.getConnection();
      await connection.query('SELECT 1 as health_check');
      connection.release();
      const sessionId = sessionContext.getStore() || 'default';
      return { 
        status: 'healthy', 
        timestamp: new Date(), 
        currentSession: sessionId,
        currentDatabase: sessionDatabases.get(sessionId),
        activeSessions: sessionDatabases.size,
        poolStats: this.getPoolStats()
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message, 
        timestamp: new Date() 
      };
    }
  },

  // Session cleanup (call periodically to clean up old sessions)
  cleanupInactiveSessions(activeSessionIds) {
    let cleanedCount = 0;
    for (const sessionId of sessionDatabases.keys()) {
      if (!activeSessionIds.includes(sessionId)) {
        sessionDatabases.delete(sessionId);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} inactive session(s)`);
    }
    return cleanedCount;
  },

  // End pool connections gracefully
  async end() {
    try {
      // Clear all sessions
      sessionDatabases.clear();
      await connectionPool.end();
      console.log('✅ Database pool closed successfully');
    } catch (error) {
      console.error('❌ Error closing database pool:', error.message);
      throw error;
    }
  }
};

pool._getSessionContext = () => sessionContext;

// ==========================================
// Redirect all old methods to smart versions
// ==========================================

pool.query = pool.smartQuery;
pool.execute = pool.smartExecute;
pool.transaction = pool.smartTransaction;

console.log('✅ Cross-database queries enabled');
console.log(`📊 Master Database: ${MASTER_DB}`);
console.log(`🔗 Master Tables: ${MASTER_TABLES.size} configured`);

// ==========================================
// STARTUP CONNECTIVITY TEST
// ==========================================
(async () => {
  try {
    console.log('🔄 Initializing database connection pool...');
    const connection = await connectionPool.getConnection();
    console.log("✅ Connected to MySQL Server successfully");
    
    // Test all databases exist
    console.log("🔍 Checking database accessibility...");
    const dbResults = [];
    
    for (const [payrollClass, dbName] of Object.entries(dbConfig.databases)) {
      try {
        await connection.query(`USE \`${dbName}\``);
        console.log(`  ✓ ${payrollClass} → ${dbName} - OK`);
        dbResults.push({ class: payrollClass, database: dbName, status: 'OK' });
      } catch (err) {
        console.warn(`  ⚠️  ${payrollClass} → ${dbName} - ${err.message}`);
        dbResults.push({ class: payrollClass, database: dbName, status: 'ERROR', error: err.message });
      }
    }
    
    connection.release();
    
    const failedDbs = dbResults.filter(db => db.status === 'ERROR');
    if (failedDbs.length > 0) {
      console.warn(`⚠️  ${failedDbs.length} database(s) are not accessible`);
    } else {
      console.log('✅ All databases are accessible');
    }
    
    // Initialize cache
    initializeDatabaseCache();
    console.log('🚀 Database pool initialized successfully');
    
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    console.error("💡 Please check your database configuration and ensure MySQL server is running");
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  try {
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
  try {
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
});

module.exports = pool;