const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken  = require('../../middware/authentication');
const { NOTIFICATIONS_DIR } = require('../../middware/notifications');

// Get notifications for current user
router.get('/', verifyToken, (req, res) => {
  const userId = req.user_id;
  const dbName = req.current_class;
  
  const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);
  
  if (!fs.existsSync(notificationFile)) {
    return res.json({
      success: true,
      notifications: []
    });
  }
  
  try {
    const fileContent = fs.readFileSync(notificationFile, 'utf8');
    const notifications = JSON.parse(fileContent);
    
    // Sort by timestamp (newest first)
    notifications.sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({
      success: true,
      notifications: notifications.slice(0, 50)
    });
  } catch (error) {
    console.error('Failed to read notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load notifications'
    });
  }
});

// Clear notifications for current user
router.delete('/delete', verifyToken, (req, res) => {
  const userId = req.user_id;
  const dbName = req.current_class;
  
  const notificationFile = path.join(NOTIFICATIONS_DIR, `${userId}_${dbName}.json`);
  
  try {
    if (fs.existsSync(notificationFile)) {
      fs.unlinkSync(notificationFile);
    }
    res.json({ 
      success: true, 
      message: 'All notifications cleared' 
    });
  } catch (error) {
    console.error('Failed to clear notifications:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear notifications' 
    });
  }
});

module.exports = router;