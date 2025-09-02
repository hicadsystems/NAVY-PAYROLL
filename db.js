const dbConfig = require('./db-config.js');
const mysql = require('mysql2');

// Create pool and connect
const pool = mysql.createPool({
    user: dbConfig.user,
    password: dbConfig.password,
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

// Test connection
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connected to MySQL Server');
    conn.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
})();

module.exports = pool;
