// db-config.js
const path = require('path');
const dotenv = require('dotenv');

// Load correct .env file based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';

dotenv.config({ path: path.resolve(__dirname, envFile) });
module.exports = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'your_password',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hicaddata',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
};
