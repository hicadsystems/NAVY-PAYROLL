// routes/monthend.js
const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const verifyToken  = require('../../middware/authentication');

// ==================== MONTH END PROCESSING ====================
router.post('/process-monthend', verifyToken, async (req, res) => {
  const { month, year } = req.body;
  
  // Validate inputs
  if (!month || !year || month < 1 || month > 12) {
    return res.status(400).json({
      success: false,
      error: 'Invalid month or year'
    });
  }
  
  const currentDb = req.current_class;
  const userId = req.user_id;
  
  let connection = null;
  
  try {
    // ✅ CHECK IF ALREADY PROCESSED
    const [existingProcess] = await pool.query(
      `SELECT * FROM py_monthend_processing_log 
       WHERE year = ? AND month = ? AND database_name = ? AND status = 'COMPLETED'
       ORDER BY start_time DESC LIMIT 1`,
      [year, month, currentDb],
      req.requestId
    );
    
    if (existingProcess.length > 0) {
      const lastProcess = existingProcess[0];
      return res.status(400).json({
        success: false,
        error: `Month-end for ${getMonthName(month)} ${year} has already been processed`,
        details: {
          processedBy: lastProcess.processed_by,
          processedAt: lastProcess.end_time,
          employeesProcessed: lastProcess.employees_processed,
          paymentsProcessed: lastProcess.payments_processed
        },
        allowReprocess: true // Optional: Allow admin to force reprocess
      });
    }
    
    // ✅ VALIDATE MONTH IS NOT IN THE FUTURE
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    if (year > currentYear || (year === currentYear && month > currentMonth)) {
      return res.status(400).json({
        success: false,
        error: `Cannot process future month: ${getMonthName(month)} ${year}`
      });
    }
    
    console.log(`🔄 Starting month-end processing: ${year}-${month} for database: ${currentDb}`);
    console.log(`   User: ${userId} (${req.user_fullname})`);
    
    connection = await pool.getConnection();
    await connection.query(`USE \`${currentDb}\``);
    
    // Call the stored procedure
    await connection.query(
      `CALL sp_monthend_processing(?, ?, ?, ?, @status, @message)`,
      [month, year, userId, currentDb]
    );
    
    // Get output parameters
    const [[output]] = await connection.query('SELECT @status AS status, @message AS message');
    
    connection.release();
    
    if (output.status === 'SUCCESS') {
      console.log(`✅ Month-end completed: ${output.message}`);
      
      // Get the processing details from log
      const [logDetails] = await pool.query(
        `SELECT * FROM py_monthend_processing_log 
         WHERE year = ? AND month = ? AND database_name = ?
         ORDER BY start_time DESC LIMIT 1`,
        [year, month, currentDb],
        req.requestId
      );
      
      const log = logDetails[0] || {};
      
      res.json({
        success: true,
        message: output.message,
        data: {
          year,
          month,
          database: currentDb,
          processedBy: userId,
          timestamp: new Date().toISOString(),
          employeesProcessed: log.employees_processed || 0,
          paymentsProcessed: log.payments_processed || 0,
          duration: log.duration_seconds || 0
        }
      });
    } else {
      console.error(`❌ Month-end failed: ${output.message}`);
      
      res.status(500).json({
        success: false,
        error: output.message
      });
    }
    
  } catch (error) {
    if (connection) connection.release();
    
    console.error('❌ Month-end processing error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Month-end processing failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Helper function
function getMonthName(month) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[parseInt(month)];
}

// ==================== GET MONTH END STATUS ====================
router.get('/monthend-status/:year/:month', verifyToken, async (req, res) => {
  const { year, month } = req.params;
  const currentDb = req.current_class;
  
  try {
    const [logs] = await pool.query(
      `SELECT * FROM py_monthend_processing_log 
       WHERE year = ? AND month = ? AND database_name = ?
       ORDER BY start_time DESC LIMIT 1`,
      [year, month, currentDb],
      req.requestId
    );
    
    if (logs.length === 0) {
      return res.json({
        processed: false,
        message: 'Month-end not yet processed for this period'
      });
    }
    
    const log = logs[0];
    
    res.json({
      processed: true,
      status: log.status,
      startTime: log.start_time,
      endTime: log.end_time,
      duration: log.duration_seconds,
      statistics: {
        employeesProcessed: log.employees_processed,
        paymentsProcessed: log.payments_processed,
        netPayRecords: log.net_pay_records
      },
      processedBy: log.processed_by
    });
    
  } catch (error) {
    console.error('Error fetching month-end status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch status',
      message: error.message 
    });
  }
});

// ==================== GET PAYMENT HISTORY ====================
router.get('/payment-history/:empno', verifyToken, async (req, res) => {
  const { empno } = req.params;
  const { year, month, paymentType } = req.query;
  
  try {
    let query = 'SELECT * FROM py_payment_history WHERE empno = ?';
    const params = [empno];
    
    if (year) {
      query += ' AND year = ?';
      params.push(year);
    }
    
    if (month) {
      query += ' AND month = ?';
      params.push(month);
    }
    
    if (paymentType) {
      query += ' AND payment_type = ?';
      params.push(paymentType);
    }
    
    query += ' ORDER BY year DESC, month DESC';
    
    const [history] = await pool.query(query, params, req.requestId);
    
    res.json({
      success: true,
      data: history
    });
    
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch payment history',
      message: error.message 
    });
  }
});

// ==================== GET ALL PROCESSING LOGS ====================
router.get('/processing-logs', verifyToken, async (req, res) => {
  const currentDb = req.current_class;
  const { limit = 10 } = req.query;
  
  try {
    const [logs] = await pool.query(
      `SELECT * FROM py_monthend_processing_log 
       WHERE database_name = ?
       ORDER BY start_time DESC 
       LIMIT ?`,
      [currentDb, parseInt(limit)],
      req.requestId
    );
    
    res.json({
      success: true,
      data: logs
    });
    
  } catch (error) {
    console.error('Error fetching processing logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch logs',
      message: error.message 
    });
  }
});


// year-end processing
router.post('/process-yearend', verifyToken, async (req, res) => {
  const { year } = req.body;
  
  if (!year || year < 2020 || year > new Date().getFullYear()) {
    return res.status(400).json({
      success: false,
      error: 'Invalid year'
    });
  }
  
  const currentDb = req.current_class;
  const userId = req.user_id;
  
  let connection = null;
  
  try {
    // Check if already processed
    const [existingProcess] = await pool.query(
      `SELECT * FROM py_yearend_processing_log 
       WHERE year = ? AND database_name = ? AND status = 'COMPLETED'`,
      [year, currentDb],
      req.requestId
    );
    
    if (existingProcess.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Year-end for ${year} has already been processed`,
        details: existingProcess[0]
      });
    }
    
    console.log(`🎯 Starting year-end processing: ${year} for ${currentDb}`);
    
    connection = await pool.getConnection();
    await connection.query(`USE \`${currentDb}\``);
    
    await connection.query(
      `CALL sp_yearend_processing(?, ?, ?, @status, @message)`,
      [year, userId, currentDb]
    );
    
    const [[output]] = await connection.query('SELECT @status AS status, @message AS message');
    
    connection.release();
    
    if (output.status === 'SUCCESS') {
      res.json({
        success: true,
        message: output.message,
        data: { year, database: currentDb, processedBy: userId }
      });
    } else {
      res.status(500).json({
        success: false,
        error: output.message
      });
    }
    
  } catch (error) {
    if (connection) connection.release();
    console.error('❌ Year-end error:', error);
    res.status(500).json({
      success: false,
      error: 'Year-end processing failed',
      message: error.message
    });
  }
});

module.exports = router;