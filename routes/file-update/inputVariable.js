const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { inputVariableChanges } = require('../../controllers/file-update/inputVariable');
router.get('/', verifyToken, inputVariableChanges);

module.exports = router;