// diagnose-db-pool.js
//
// Standalone diagnostic — bypasses the app's session/Map bookkeeping
// entirely and opens connections the exact same way MySQLAdapter._getPool()
// does, using the real resolved config. Prints what MySQL itself reports
// as the active schema for each configured database.
//
// Run from the project root:
//   node diagnose-db-pool.js
//
// Safe to delete after use — makes no writes, only SELECT DATABASE()
// and a couple of read-only session/status checks.

const mysql = require("mysql2/promise");
const { getConfig } = require("./config/db-config");

(async () => {
  console.log("🔍 Loading resolved db config (same path the app uses)...\n");
  const dbConfig = await getConfig();

  console.log("Host:", dbConfig.host);
  console.log("Port:", dbConfig.port);
  console.log("User:", dbConfig.user);
  console.log("Configured databases:", dbConfig.databases);
  console.log("\n" + "=".repeat(70) + "\n");

  for (const [className, dbName] of Object.entries(dbConfig.databases)) {
    if (!dbName) {
      console.log(`⚠️  ${className}: no database name configured — skipping\n`);
      continue;
    }

    console.log(`▶ Testing class "${className}" → requested database "${dbName}"`);

    let connection;
    try {
      // Deliberately open a FRESH single connection (not a pool) so
      // there's zero chance of connection reuse/pooling artifacts —
      // this isolates whether the mismatch is at the driver/server
      // level or something specific to how the app pools connections.
      connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port || 3306,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbName,
        connectTimeout: 10000,
      });

      const [rows] = await connection.query(
        "SELECT DATABASE() AS active_db, CURRENT_USER() AS curr_user, @@hostname AS server_hostname, @@port AS server_port, CONNECTION_ID() AS connection_id",
      );

      const info = rows[0];
      const match = info.active_db === dbName;

      console.log(`   requested="${dbName}"  active_db="${info.active_db}"  ${match ? "✅ MATCH" : "🚨 MISMATCH"}`);
      console.log(`   curr_user=${info.curr_user}  server=${info.server_hostname}:${info.server_port}  connection_id=${info.connection_id}`);

      // Also show row counts for a couple of tables we know differ,
      // if this happens to be one of the affected classes.
      try {
        const [cnt] = await connection.query(
          "SELECT COUNT(*) AS c FROM py_elementType",
        );
        console.log(`   py_elementType row count on this connection: ${cnt[0].c}`);
      } catch (e) {
        console.log(`   (couldn't count py_elementType: ${e.message})`);
      }
    } catch (err) {
      console.log(`   ❌ Connection/query failed: ${err.message}`);
    } finally {
      if (connection) await connection.end();
    }

    console.log("");
  }

  console.log("=".repeat(70));
  console.log("Done. Paste this whole output back.");
  process.exit(0);
})().catch((err) => {
  console.error("Fatal error running diagnostic:", err);
  process.exit(1);
});
