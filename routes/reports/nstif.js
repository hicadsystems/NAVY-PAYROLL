const express = require('express');
const router = express.Router();
const nsitfReportController = require('../../controllers/Reports/nsitfReportController');
const verifyToken = require('../../middware/authentication');


// NSITF REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, nsitfReportController.generateNSITFReport.bind(nsitfReportController));

// NSITF - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, nsitfReportController.generateNSITFReportPDF.bind(nsitfReportController));

// NSITF - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, nsitfReportController.generateNSITFReportExcel.bind(nsitfReportController));

// FILTER OPTIONS - GET AVAILABLE STATES
router.get('/filter-options', verifyToken, nsitfReportController.getNSITFFilterOptions.bind(nsitfReportController));

module.exports = router;