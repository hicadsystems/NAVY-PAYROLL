const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// LOAN REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, reportsController.generateLoanAnalysis.bind(reportsController));

// LOAN REPORT - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, reportsController.generateLoanAnalysisPDF.bind(reportsController));

// LOAN REPORT - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, reportsController.generateLoanAnalysisExcel.bind(reportsController));

module.exports = router;