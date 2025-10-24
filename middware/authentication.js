const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET is not set in environment variables');
}

const verifyToken = (req, res, next) => {
  // 1. Attempt to get the token from the Authorization header (Standard)
  const bearerHeader = req.headers['authorization'];
  let token = null;

  if (bearerHeader && bearerHeader.startsWith('Bearer ')) {
    token = bearerHeader.split(' ')[1]; // Extracts the token part
  } 

  // 2. Fallback: Check the query parameter 'token' (For file downloads/reports)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // 3. Reject if no token is found in either location
  if (!token) {
    return res.status(403).json({ message: 'No token provided' });
  }

  // 4. Verify the token
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token has expired' });
        }
        return res.status(401).json({ message: 'Invalid token' });
    }

    // Attach user info to the request object
    req.user_id = decoded.user_id;
    req.user_fullname = decoded.full_name;
    req.user_role = decoded.role;
    req.primary_class = decoded.primary_class;
    req.current_class = decoded.current_class;

    // Set database context based on user's current class
    try {
        if (decoded.current_class) {
            // Ensure 'pool' variable is correctly in scope if moved inside
            const pool = require('../config/db'); 
            pool.useDatabase(decoded.current_class);
            console.log(`🔄 Database context set to: ${decoded.current_class} for user: ${decoded.user_id}`);
        }
    } catch (dbError) {
        console.error('❌ Database context error:', dbError);
        return res.status(500).json({ message: 'Database context error' });
    }

    next();
  });
};

module.exports = verifyToken;