const dbConfig = require('./db-config.js');
const sql = require('mssql');

// Create pool and connect
const poolPromise = new sql.ConnectionPool({
    user: dbConfig.user,
    password: dbConfig.password,
    server: dbConfig.host,
    database: dbConfig.database,
    port: dbConfig.port,
    options: {
        encrypt: false,              // change to true if using Azure
        trustServerCertificate: true // true for local / self-signed certs
    }
})
.connect()
.then(pool => {
    console.log('✅ Connected to SQL Server');
    return pool;
})
.catch(err => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
});

module.exports = poolPromise;
