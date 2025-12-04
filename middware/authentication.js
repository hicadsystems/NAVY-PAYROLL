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
    token = bearerHeader.split(' ')[1];
  } 

  // 2. Fallback: Check the query parameter 'token'
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // 3. Reject if no token is found
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
            const pool = require('../config/db');
            const { AsyncLocalStorage } = require('async_hooks');
            
            // Get the sessionContext from pool
            const sessionContext = pool._getSessionContext ? pool._getSessionContext() : null;
            
            const databaseName = decoded.current_class;
            const sessionId = decoded.user_id.toString();
            
            if (sessionContext) {
                // 🔧 FIX: Run the rest of the request in the user's session context
                sessionContext.run(sessionId, () => {
                    pool.useDatabase(databaseName, sessionId);
                    req.current_database = databaseName;
                    console.log(`🔄 DB set to: ${databaseName} for user: ${decoded.user_id}`);
                    next();
                });
            } else {
                // Fallback if sessionContext not available
                pool.useDatabase(databaseName, sessionId);
                req.current_database = databaseName;
                console.log(`🔄 DB set to: ${databaseName} for user: ${decoded.user_id}`);
                next();
            }
        } else {
            next();
        }
    } catch (dbError) {
        console.error('❌ Database context error:', dbError);
        return res.status(500).json({ message: 'Database context error' });
    }
  });
};

module.exports = verifyToken;