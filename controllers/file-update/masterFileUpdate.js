const pool = require('../../config/db');
const masterFileUpdate = require('../../services/file-update/masterFileUpdate');

exports.masterFileUpdate = async (req, res) => {
  try {
    // Get the current database from user's primary class
    const currentDb = req.primary_class;
    
    if (!currentDb) {
      return res.status(400).json({ 
        error: 'No primary class found',
        hint: 'Please ensure you have selected a payroll class'
      });
    }

    // Map database name to indicator (1-6)
    const dbToIndicator = {
      [process.env.DB_OFFICERS]: '1',
      [process.env.DB_WOFFICERS]: '2',
      [process.env.DB_RATINGS]: '3',
      [process.env.DB_RATINGS_A]: '4',
      [process.env.DB_RATINGS_B]: '5',
      [process.env.DB_JUNIOR_TRAINEE]: '6'
    };
    
    const indicator = dbToIndicator[currentDb];
    
    if (!indicator) {
      return res.status(400).json({ 
        error: `Cannot map database '${currentDb}' to indicator`,
        currentDb,
        hint: 'Database not recognized. Available databases: ' + Object.keys(dbToIndicator).join(', ')
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });

    const { year, month, sun } = bt05Rows[0];
    if (sun < 777) return res.status(400).json({ error: 'Input variable report must be processed first.' });
    if (sun > 777) return res.status(400).json({ error: 'Master update already completed.' });

    const user = req.user_fullname || 'System Update';
    
    console.log(`🎯 Master file update - Database: ${currentDb}, Indicator: ${indicator}, User: ${user}`);
    
    // Now passing all 4 parameters in correct order: year, month, indicator, user
    const result = await masterFileUpdate.runUpdates(year, month, indicator, user);

    await pool.query("UPDATE py_stdrate SET sun = 888, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({
      status: 'SUCCESS',
      stage: 4,
      progress: 'Master file updates completed',
      nextStage: 'Calculation',
      database: currentDb,
      indicator,
      logId: result.logId || result.insertId || null,
      result
    });
  } catch (err) {
    console.error('Error running master file update:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};
