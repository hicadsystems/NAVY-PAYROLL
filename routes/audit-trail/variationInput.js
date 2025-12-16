const express = require('express');
const router = express.Router();
const veriftyToken = require('../../middware/authentication');
router.use(veriftyToken);
const payPeriodReportController = require('../../controllers/audit-trail/inputVariationController');

/**
 * @route   GET /api/reports/pay-period
 * @desc    Generate Pay Period Variation Input Listings Report
 * @access  Private
 * @query   {string} fromPeriod - Start period in YYYYMM format (e.g., "202401")
 * @query   {string} toPeriod - End period in YYYYMM format (e.g., "202412")
 * @query   {string} [emplId] - Filter by specific employee ID
 * @query   {string} [createdBy] - Filter by operator/username
 * @query   {string} [payType] - Filter by pay element type (e.g., "BP102")
 * @query   {string} [format] - Output format: "json" | "excel" | "pdf" (default: "json")
 * 
 * @example /api/reports/pay-period?fromPeriod=202401&toPeriod=202412&format=excel
 * @example /api/reports/pay-period?fromPeriod=202404&toPeriod=202404&emplId=NN/001&format=pdf
 * @example /api/reports/pay-period?fromPeriod=202401&toPeriod=202406&payType=BP102&format=json
 */
router.get(
  '/',
  payPeriodReportController.generatePayPeriodReport.bind(payPeriodReportController)
);

/**
 * @route   GET /api/reports/pay-period/filter-options
 * @desc    Get available filter options for Pay Period Report
 * @access  Private
 * @returns {Object} Available pay periods, pay types, operators, employees, and current period
 * 
 * @example Response:
 * {
 *   "success": true,
 *   "data": {
 *     "payPeriods": [
 *       { "pay_period": "202412", "year": "2024", "month": "12" },
 *       { "pay_period": "202411", "year": "2024", "month": "11" }
 *     ],
 *     "payTypes": [
 *       { "code": "BP102", "description": "Basic Salary" },
 *       { "code": "PR309", "description": "Housing Allowance" }
 *     ],
 *     "operators": [
 *       { "operator_name": "hicad 001" },
 *       { "operator_name": "admin" }
 *     ],
 *     "employees": [
 *       { "employee_id": "NN/001", "full_name": "JOHN DOE" }
 *     ],
 *     "currentPeriod": "202412"
 *   }
 * }
 */
router.get(
  '/filter-options',
  payPeriodReportController.getPayPeriodFilterOptions.bind(payPeriodReportController)
);

module.exports = router;