// db-config.js
module.exports = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'your_password',
  host: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'navy_payroll',
  port: parseInt(process.env.DB_PORT, 10) || 1433
};
