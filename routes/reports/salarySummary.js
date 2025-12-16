const express = require('express');
const router = express.Router();
const salarySummaryController = require('../../controllers/Reports/salarySummaryController');
const verifyToken = require('../../middware/authentication');


// TAX REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, salarySummaryController.generateSalarySummary.bind(salarySummaryController));

// TAX - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, salarySummaryController.generateSalarySummaryPDF.bind(salarySummaryController));

// TAX - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, salarySummaryController.generateSalarySummaryExcel.bind(salarySummaryController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, salarySummaryController.getFilterOptions.bind(salarySummaryController));

module.exports = router;