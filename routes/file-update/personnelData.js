const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { personnelChanges } = require('../../controllers/file-update/personnelData');
router.get('/', verifyToken, personnelChanges);

module.exports = router;