const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { getAvailablePeriods } = require('../../controllers/file-update/personnelData');
router.get('/periods', verifyToken, getAvailablePeriods);

const { getEmployeesList } = require('../../controllers/file-update/personnelData');
router.get('/employees', verifyToken, getEmployeesList);


const { getPreviousPersonnelDetails } = require('../../controllers/file-update/personnelData');
router.get('/previous', verifyToken, getPreviousPersonnelDetails);

const {getCurrentPersonnelDetails  } = require('../../controllers/file-update/personnelData');
router.get('/current', verifyToken, getCurrentPersonnelDetails );

const { getPersonnelDetailsComparison } = require('../../controllers/file-update/personnelData');
router.get('/compare', verifyToken, getPersonnelDetailsComparison);

const { exportPreviousDetailsExcel  } = require('../../controllers/file-update/personnelData');
router.get('/export/excel-prev', verifyToken, exportPreviousDetailsExcel);

const { exportCurrentDetailsExcel } = require('../../controllers/file-update/personnelData');
router.get('/export/excel-cur', verifyToken, exportCurrentDetailsExcel);

const { exportPreviousDetailsPDF } = require('../../controllers/file-update/personnelData');
router.get('/export/pdf-prev', verifyToken, exportPreviousDetailsPDF);

const { exportCurrentDetailsPDF } = require('../../controllers/file-update/personnelData');
router.get('/export/pdf-cur', verifyToken, exportCurrentDetailsPDF);

module.exports = router;