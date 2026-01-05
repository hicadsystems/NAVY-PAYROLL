const express = require('express');
const router = express.Router();
const controlSheetController = require('../../controllers/Reports/controlSheetController');
const verifyToken = require('../../middware/authentication');


// CONTROL SHEET - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, controlSheetController.generateControlSheet.bind(controlSheetController));

// CONTROL SHEET - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, controlSheetController.generateControlSheetPDF.bind(controlSheetController));

// CONTROL SHEET - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, controlSheetController.generateControlSheetExcel.bind(controlSheetController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, controlSheetController.getControlSheetFilterOptions.bind(controlSheetController));

module.exports = router;