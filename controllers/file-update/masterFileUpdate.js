const pool = require('../../config/db');
const masterFileUpdate = require('../../services/file-update/masterFileUpdate');

exports.masterFileUpdate = async (req, res) => {
  try {
    // Get the current database from user's primary class
    const currentDb = req.primary_class;
    
    if (!currentDb) {
      return res.status(400).json({ 
        error: 'No primary class found. Please ensure you have selected a payroll class'
      });
    }

    // Map primary_class values to database names and indicators
    const classToDbAndIndicator = {
      'OFFICERS': { db: process.env.DB_OFFICERS, indicator: '1' },
      'W/OFFICERS': { db: process.env.DB_WOFFICERS, indicator: '2' },
      'RATE A': { db: process.env.DB_RATINGS, indicator: '3' },
      'RATE B': { db: process.env.DB_RATINGS_A, indicator: '4' },
      'RATE C': { db: process.env.DB_RATINGS_B, indicator: '5' },
      'TRAINEE': { db: process.env.DB_JUNIOR_TRAINEE, indicator: '6' }
    };
    
    const mapping = classToDbAndIndicator[currentDb];
    
    if (!mapping) {
      return res.status(400).json({ 
        error: `Invalid payroll class: '${currentDb}'. Please contact system administrator.`
      });
    }

    const { db: databaseName, indicator } = mapping;

    // Switch to the correct database
    await pool.query(`USE ${databaseName}`);

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        error: 'Payroll period not found. Please ensure BT05 record exists.' 
      });
    }

    const { year, month, sun } = bt05Rows[0];
    
    if (sun < 777) {
      return res.status(400).json({ 
        error: 'Input Variable Report must be processed first before updating master files.' 
      });
    }
    
    if (sun >= 888) {
      return res.status(400).json({ 
        error: 'Master file update has already been completed for this period.' 
      });
    }

    const user = req.user_fullname || 'System Update';
    
    console.log(`🎯 Master file update - Class: ${currentDb}, Database: ${databaseName}, Indicator: ${indicator}, User: ${user}`);
    
    // Run the master file updates with all 4 parameters
    const result = await masterFileUpdate.runUpdates(year, month, indicator, user);

    // Update the stage to 888 (master file update completed)
    await pool.query(
      "UPDATE py_stdrate SET sun = 888, createdby = ? WHERE type = 'BT05'", 
      [user]
    );

    res.json({
      status: 'SUCCESS',
      message: 'Master file updated successfully',
      stage: 888,
      year,
      month,
      database: databaseName,
      class: currentDb,
      indicator,
      recordsProcessed: result.recordsProcessed || 0,
      logId: result.logId || result.insertId || null
    });
    
  } catch (err) {
    console.error('❌ Error running master file update:', err);
    
    // Return user-friendly error messages
    const errorMessage = err.message || 'An unexpected error occurred during master file update';
    
    res.status(500).json({ 
      status: 'FAILED', 
      error: errorMessage
    });
  }
};
