const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const verifyToken = require('../../middware/authentication');
const pool  = require('../../config/db'); // mysql2 pool

const SECRET = process.env.JWT_SECRET;

// Map frontend class names to backend database identifiers
const CLASS_MAPPING = {
  'OFFICER': 'hicaddata',      // officers -> hicaddata
  'W/OFFICER': 'hicaddata1',   // wofficers -> hicaddata1
  'RATINGS': 'hicaddata2',     // ratings -> hicaddata2  
  'RATINGS A': 'hicaddata3',   // ratingsA -> hicaddata3
  'RATINGS B': 'hicaddata4',   // ratingsB -> hicaddata4
  'JUNIOR TRAINEE': 'hicaddata5' // juniorTrainee -> hicaddata5
};

// Reverse mapping for display
const DISPLAY_MAPPING = {
  'hicaddata': 'OFFICER',
  'hicaddata1': 'W/OFFICER', 
  'hicaddata2': 'RATINGS',
  'hicaddata3': 'RATINGS A',
  'hicaddata4': 'RATINGS B',
  'hicaddata5': 'JUNIOR TRAINEE'
};

// Get all available database classes (for populating the table)
router.get('/dbclasses', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, display_name, db_name, is_active FROM db_classes WHERE is_active = 1'
    );

    // mark which is primary & current
    const classes = rows.map(row => ({
      id: row.db_name, // unique db identifier
      display: row.display_name,
      dbName: row.db_name,
      isPrimary: row.db_name === req.primary_class,
      isActive: row.db_name === req.current_class,
      hasAccess: true
    }));

    res.json({
      classes,
      currentClass: req.current_class,
      primaryClass: req.primary_class,
      userId: req.user_id
    });

  } catch (err) {
    console.error('❌ Error loading db_classes:', err);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

// Switch payroll class (temporary for session)
router.post('/switch-class', verifyToken, async (req, res) => {
  try {
    const { targetClass } = req.body; // could be display_name OR db_name
    const userId = req.user_id;

    // First try lookup by display_name
    let [classRows] = await pool.query(
      'SELECT id, display_name, db_name FROM db_classes WHERE display_name = ? AND is_active = 1',
      [targetClass]
    );

    // If not found, try lookup by db_name
    if (classRows.length === 0) {
      [classRows] = await pool.query(
        'SELECT id, display_name, db_name FROM db_classes WHERE db_name = ? AND is_active = 1',
        [targetClass]
      );
    }

    if (classRows.length === 0) {
      return res.status(400).json({ error: 'Invalid class selected' });
    }

    const selectedClass = classRows[0];

    // validate user exists + get primary_class
    const [userRows] = await pool.query(
      'SELECT primary_class FROM users WHERE user_id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const primaryClass = userRows[0].primary_class;

    // generate new token with updated current_class
    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: primaryClass,
      current_class: selectedClass.db_name
    };

    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: '6h' });

    res.json({
      success: true,
      message: `Switched to ${selectedClass.display_name}`,
      token: newToken,
      newClass: {
        id: selectedClass.db_name,       // internal name
        display: selectedClass.display_name // friendly name
      },
      isPrimary: selectedClass.db_name === primaryClass,
      switchedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Switch class error:', err);
    res.status(500).json({ error: 'Failed to switch class' });
  }
});

// Get current session info
router.get('/session-info', verifyToken, (req, res) => {
  res.json({
    userId: req.user_id,
    fullName: req.user_fullname,
    role: req.user_role,
    primaryClass: {
      id: req.primary_class,
      display: DISPLAY_MAPPING[req.primary_class] || req.primary_class.toUpperCase()
    },
    currentClass: {
      id: req.current_class,
      display: DISPLAY_MAPPING[req.current_class] || req.current_class.toUpperCase()
    },
    isWorkingOnPrimary: req.primary_class === req.current_class
  });
});

// Reset to primary class
router.post('/reset-to-primary', verifyToken, (req, res) => {
  try {
    // Create new JWT with current_class reset to primary_class
    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: req.primary_class,
      current_class: req.primary_class // Reset to primary (e.g., back to 'hicaddata')
    };
    
    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: '24h' });
    
    console.log(`🔄 User ${req.user_fullname} reset to primary class: ${req.primary_class}`);
    
    res.json({
      success: true,
      message: `Reset to primary class: ${DISPLAY_MAPPING[req.primary_class] || req.primary_class}`,
      token: newToken,
      resetAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Reset to primary error:', error);
    res.status(500).json({ 
      error: 'Failed to reset to primary class',
      message: error.message 
    });
  }
});

module.exports = router;