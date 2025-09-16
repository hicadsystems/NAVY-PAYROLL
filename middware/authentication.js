const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET is not set in environment variables');
}

const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization'];

  if (!bearerHeader) {
    return res.status(403).json({ message: 'No token provided' });
  }

  const token = bearerHeader.split(' ')[1]; // Removes "Bearer " part

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token has expired' });
      }
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Attach entire payload
    req.user_id = decoded.user_id;  // Changed from decoded.id to decoded.user_id
    req.user_fullname = decoded.full_name;
    req.user_role = decoded.role;
    req.primary_class = decoded.primary_class;
    req.current_class = decoded.current_class;

    // Set database context based on user's current class
    try {
      if (decoded.current_class) {
        const pool = require('../config/db'); // Adjust path as needed
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