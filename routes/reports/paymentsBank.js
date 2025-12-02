const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');

const reportsController = require('../../controllers/Reports/reportsControllers');

// PAYMENTS-BANK REPORT - DATA GENERATION (Returns JSON data)
router.get('/generate', verifyToken, reportsController.generatePaymentsByBank.bind(reportsController));

// PAYMENTS-BANK - PDF EXPORT (Receives data in body, returns PDF file)
router.post('/export/pdf', verifyToken, reportsController.generatePaymentsByBankPDF.bind(reportsController));

// PAYMENTS-BANK - EXCEL EXPORT (Receives data in body, returns Excel file)
router.post('/export/excel', verifyToken, reportsController.generatePaymentsByBankExcel.bind(reportsController));

module.exports = router;