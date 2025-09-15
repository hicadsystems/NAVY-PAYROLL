const path = require("path");
const dotenv = require("dotenv");

// Load correct .env file based on NODE_ENV
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";

dotenv.config({ path: path.resolve(__dirname, envFile) });

module.exports = {
  user: process.env.DB_USER || "Hicad",
  password: process.env.DB_PASSWORD || "H1cadServer",
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,

  // Default DB = OFFICERS
  database: process.env.DB_NAME || "hicaddata",

  // Other DBs (for reference)
  databases: {
    officers: process.env.DB_NAME || "hicaddata",
    wofficers: process.env.DB1_NAME || "hicaddata1",
    ratings: process.env.DB2_NAME || "hicaddata2",
    ratingsA: process.env.DB3_NAME || "hicaddata3",
    ratingsB: process.env.DB4_NAME || "hicaddata4",
    juniorTrainee: process.env.DB5_NAME || "hicaddata5",
  },
};
