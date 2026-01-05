const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYDED-BANK REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, reportsController.generatePaymentsDeductionsByBank.bind(reportsController));

// PAYDED-BANK - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, reportsController.generatePaymentsDeductionsByBankPDF.bind(reportsController));

// PAYDED-BANK - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, reportsController.generatePaymentsDeductionsByBankExcel.bind(reportsController));

module.exports = router;