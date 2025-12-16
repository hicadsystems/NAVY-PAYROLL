// services/helpers/periodValidatorService.js
const pool = require('../../config/db');

class PeriodValidatorService {
  
  /**
   * Validate period and determine data source
   * Returns: { 
   *   isValid: boolean, 
   *   dataSource: 'current' | 'history',
   *   errorMessage: string | null,
   *   period: { year, month, status }
   * }
   */
  async validateAndGetDataSource(year, month, database = null) {
    try {
      // Get current period from BT05
      const currentPeriod = await this.getCurrentPeriod(database);
      
      if (!currentPeriod) {
        return {
          isValid: false,
          dataSource: null,
          errorMessage: 'Current period not found. Please initialize BT05 in py_stdrate.',
          period: null
        };
      }

      const requestedYear = parseInt(year);
      const requestedMonth = parseInt(month);
      const currentYear = currentPeriod.year;
      const currentMonth = currentPeriod.month;

      // Check if requesting future period
      if (requestedYear > currentYear || 
          (requestedYear === currentYear && requestedMonth > currentMonth)) {
        return {
          isValid: false,
          dataSource: null,
          errorMessage: `Cannot select future period. Current period is ${this.getMonthName(currentMonth)} ${currentYear}.`,
          period: currentPeriod
        };
      }

      // Check if requesting current period
      if (requestedYear === currentYear && requestedMonth === currentMonth) {
        // Current period - check calculation status
        if (currentPeriod.status !== 999) {
          return {
            isValid: false,
            dataSource: 'current',
            errorMessage: `Calculation not completed for ${this.getMonthName(requestedMonth)} ${requestedYear}. Current status: ${currentPeriod.status} - ${this.getStatusMessage(currentPeriod.status)}. Please complete payroll calculation before generating reports.`,
            period: currentPeriod
          };
        }

        // Check if data exists
        const hasData = await this.checkCurrentPeriodData(requestedYear, requestedMonth, database);
        if (!hasData) {
          return {
            isValid: false,
            dataSource: 'current',
            errorMessage: `No payroll data found for ${this.getMonthName(requestedMonth)} ${requestedYear}.`,
            period: currentPeriod
          };
        }

        return {
          isValid: true,
          dataSource: 'current',
          errorMessage: null,
          period: currentPeriod
        };
      }

      // Previous period - check if data exists in history
      const hasHistoryData = await this.checkHistoryData(requestedYear, requestedMonth, database);
      if (!hasHistoryData) {
        return {
          isValid: false,
          dataSource: 'history',
          errorMessage: `No historical data found for ${this.getMonthName(requestedMonth)} ${requestedYear}. Month-end may not have been processed for this period.`,
          period: currentPeriod
        };
      }

      return {
        isValid: true,
        dataSource: 'history',
        errorMessage: null,
        period: currentPeriod
      };

    } catch (error) {
      console.error('Period validation error:', error);
      return {
        isValid: false,
        dataSource: null,
        errorMessage: `Validation error: ${error.message}`,
        period: null
      };
    }
  }

  /**
   * Get current period from BT05
   */
  async getCurrentPeriod(database = null) {
    const db = database || process.env.DB_OFFICERS;
    const query = `
      SELECT ord AS year, mth AS month, pmth AS prev_month, sun AS status
      FROM ${db}.py_stdrate
      WHERE type = 'BT05'
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query);
    return rows[0] || null;
  }

  /**
   * Check if current period has data
   */
  async checkCurrentPeriodData(year, month, database = null) {
    const db = database || process.env.DB_OFFICERS;
    const query = `
      SELECT COUNT(*) as count
      FROM ${db}.py_mastercum
      WHERE his_type = ?
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query, [month]);
    return rows[0].count > 0;
  }

  /**
   * Check if historical data exists
   */
  async checkHistoryData(year, month, database = null) {
    const db = database || process.env.DB_OFFICERS;
    const monthColumn = `amtthismth${month}`;
    
    const query = `
      SELECT COUNT(*) as count
      FROM ${db}.py_payhistory
      WHERE his_year = ?
        AND his_type = 'PY01'
        AND ${monthColumn} > 0
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query, [year]);
    return rows[0].count > 0;
  }

  /**
   * Get month name
   */
  getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(month)] || `Month ${month}`;
  }

  /**
   * Get status message
   */
  getStatusMessage(status) {
    const statusMap = {
      0: 'Data Entry Open',
      666: 'Data Entry Closed',
      775: 'First Report Generated',
      777: 'Two Reports Generated',
      888: 'Update Completed',
      999: 'Calculation Completed'
    };
    return statusMap[status] || `Unknown Status (${status})`;
  }

  /**
   * Build history query helper - SIMPLIFIED
   * py_payhistory has ALL data from py_masterpayded
   * Just use different column names: amtthismth → amtthismth{N}
   */
  getHistoryColumns(month) {
    return {
      // All columns from py_masterpayded, just with month suffix
      amountThisMonth: `amtthismth${month}`,
      totalAmountPayable: `totamtpayable${month}`,
      totalPaidToDate: `totpaidtodate${month}`,
      initialLoan: `Initialloan${month}`,
      paymentIndicator: `payindic${month}`,
      numMonths: `nmth${month}`,
      loanBalance: `loan${month}`,
      bankCode: `bankcode${month}`,
      bankBranch: `bankbranch${month}`,
      bankAccount: `bankacnumber${month}`
    };
  }

  /**
   * Build simple history query for ANY payment type
   * Works for NHF, Tax, Pension, Loans, Allowances, EVERYTHING!
   */
  buildHistoryQuery(year, month, paymentType, alias = 'ph') {
    const cols = this.getHistoryColumns(month);
    
    return {
      where: `
        ${alias}.his_year = ?
        AND ${alias}.his_type = ?
        AND ${alias}.${cols.amountThisMonth} > 0
      `,
      params: [year, paymentType],
      columns: cols
    };
  }

  /**
   * Get breakdown query - for summary reports
   * Groups by his_type prefix (BP/BT, PT, PR, PL)
   */
  buildHistoryBreakdownQuery(year, month, empnoField = 'his_empno') {
    const amtCol = `amtthismth${month}`;
    
    return {
      grossPaySubquery: `
        (SELECT COALESCE(SUM(${amtCol}), 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND LEFT(his_type, 2) IN ('BP', 'BT')
           AND ${amtCol} > 0)
      `,
      allowancesSubquery: `
        (SELECT COALESCE(SUM(${amtCol}), 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND LEFT(his_type, 2) = 'PT'
           AND ${amtCol} > 0)
      `,
      deductionsSubquery: `
        (SELECT COALESCE(SUM(${amtCol}), 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND LEFT(his_type, 2) = 'PR'
           AND ${amtCol} > 0)
      `,
      loansSubquery: `
        (SELECT COALESCE(SUM(${amtCol}), 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND LEFT(his_type, 2) = 'PL'
           AND ${amtCol} > 0)
      `,
      netPaySubquery: `
        (SELECT COALESCE(${amtCol}, 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND his_type = 'PY01'
           AND ${amtCol} > 0
         LIMIT 1)
      `,
      taxSubquery: `
        (SELECT COALESCE(${amtCol}, 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND his_type = 'PY02'
           AND ${amtCol} > 0
         LIMIT 1)
      `,
      nhfSubquery: `
        (SELECT COALESCE(${amtCol}, 0)
         FROM py_payhistory
         WHERE his_empno = ${empnoField}
           AND his_year = ${year}
           AND his_type = 'PR309'
           AND ${amtCol} > 0
         LIMIT 1)
      `
    };
  }

  /**
   * Get payment elements - ALL types from history
   * Returns JSON array like current period does
   */
  buildHistoryPaymentElementsQuery(year, month, empnoField = 'his_empno') {
    const amtCol = `amtthismth${month}`;
    const payindicCol = `payindic${month}`;
    const totPaidCol = `totpaidtodate${month}`;
    
    return `
      (SELECT JSON_ARRAYAGG(
        JSON_OBJECT(
          'code', his_type,
          'description', COALESCE(et.elmDesc, his_type),
          'amount', ROUND(${amtCol}, 2),
          'category', LEFT(his_type, 2),
          'payment_indicator', ${payindicCol},
          'total_paid', ROUND(${totPaidCol}, 2)
        )
      )
       FROM py_payhistory ph
       LEFT JOIN py_elementType et ON et.PaymentType = ph.his_type
       WHERE ph.his_empno = ${empnoField}
         AND ph.his_year = ${year}
         AND ph.${amtCol} > 0
         AND ph.his_type != 'PY01')
    `;
  }
}

module.exports = new PeriodValidatorService();