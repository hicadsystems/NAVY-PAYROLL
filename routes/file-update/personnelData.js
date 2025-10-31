const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { personnelChanges } = require('../../controllers/file-update/personnelData');
router.post('/process', verifyToken, personnelChanges);

const { getPersonnelChangesView } = require('../../controllers/file-update/personnelData');
router.get('/', verifyToken, getPersonnelChangesView);

// Filtered view endpoints
const { getHighRiskPersonnelChanges } = require('../../controllers/file-update/personnelData');
router.get('/high-risk', verifyToken, getHighRiskPersonnelChanges);

const {getTerminatedEmployees } = require('../../controllers/file-update/personnelData');
router.get('/terminated', verifyToken, getTerminatedEmployees);

const { getNewEmployees } = require('../../controllers/file-update/personnelData');
router.get('/new', verifyToken, getNewEmployees);

const { exportPersonnelChangesExcel  } = require('../../controllers/file-update/personnelData');
router.post('/excel', verifyToken, exportPersonnelChangesExcel );

const { exportPersonnelChangesPDF } = require('../../controllers/file-update/personnelData');
router.post('/pdf', verifyToken, exportPersonnelChangesPDF);

module.exports = router;