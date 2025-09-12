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

    // Attach entire payload instead of just id
    req.user_id = decoded.id;
    req.user_fullname = decoded.full_name;
    req.user_role = decoded.role; 

    next();
  });
};

module.exports = verifyToken;