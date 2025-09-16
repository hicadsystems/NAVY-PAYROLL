const path = require("path");
const dotenv = require("dotenv");

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
dotenv.config({ path: path.resolve(__dirname, envFile) });

module.exports = {
  user: process.env.DB_USER || "Hicad",
  password: process.env.DB_PASSWORD || "H1cadServer",
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  
  // Payroll class to database mapping
  databases: {
    officers: process.env.DB_OFFICERS || "hicaddata",
    wofficers: process.env.DB_WOFFICERS || "hicaddata1", 
    ratings: process.env.DB_RATINGS || "hicaddata2",
    ratingsA: process.env.DB_RATINGS_A || "hicaddata3",
    ratingsB: process.env.DB_RATINGS_B || "hicaddata4",
    juniorTrainee: process.env.DB_JUNIOR_TRAINEE || "hicaddata5"
  }
};