// db-config.js
module.exports = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'your_password',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'navy_payroll',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
};
