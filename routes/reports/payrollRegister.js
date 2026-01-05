const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYROLL REGISTER REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, reportsController.generatePayrollRegister.bind(reportsController));

// PAYROLL REGISTER - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, reportsController.generatePayrollRegisterPDF.bind(reportsController));

// PAYROLL REGISTER - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, reportsController.generatePayrollRegisterExcel.bind(reportsController));

module.exports = router;