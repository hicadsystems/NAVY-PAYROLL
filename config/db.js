const dbConfig = require("./db-config");
const mysql = require("mysql2");

let pool = mysql.createPool({
  user: dbConfig.user,
  password: dbConfig.password,
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database, // default OFFICERS (hicaddata)
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}).promise();

// Function to switch DB dynamically (used at login / admin switch)
async function switchDatabase(dbName) {
  try {
    if (pool && pool.end) {
      await pool.end(); // close old pool
      console.log("🔒 Closed previous pool");
    }

    pool = mysql.createPool({
      user: dbConfig.user,
      password: dbConfig.password,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    }).promise();

    console.log(`✅ Switched pool to ${dbName}`);
  } catch (err) {
    console.error("❌ Failed to switch DB:", err.message);
  }
}

// Test default connection
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅ Connected to MySQL Server [${dbConfig.database}]`);
    conn.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
})();

module.exports = { pool: () => pool, switchDatabase };
