const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYSLIP REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, reportsController.generatePayslips.bind(reportsController));

// PAYSLIP REPORT - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, reportsController.generatePayslipPDFEnhanced.bind(reportsController));

// PAYSLIP REPORT - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, reportsController.generatePayslipExcel.bind(reportsController));

module.exports = router;