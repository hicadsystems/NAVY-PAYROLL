const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { inputVariableChanges } = require('../../controllers/file-update/inputVariable');
router.post('/changes', verifyToken, inputVariableChanges);

const { getInputVariableChangesView } = require('../../controllers/file-update/inputVariable');
router.get('/view', verifyToken, getInputVariableChangesView);

const { getHighRiskInputChanges } = require('../../controllers/file-update/inputVariable');
router.get('/high-risk', getHighRiskInputChanges);

const { getLoanChanges } = require('../../controllers/file-update/inputVariable');
router.get('/loans', getLoanChanges);

const { exportInputVariablesPdf } = require('../../controllers/file-update/inputVariable');
router.post('/pdf', verifyToken, exportInputVariablesPdf);

const { exportInputVariablesExcel } = require('../../controllers/file-update/inputVariable');
router.post('/excel', verifyToken, exportInputVariablesExcel);

module.exports = router;
