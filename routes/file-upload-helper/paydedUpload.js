const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

module.exports = router;