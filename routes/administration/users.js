const express = require('express');
const {pool, switchDatabase} = require('../../config/db'); // mysql2 pool()
const router = express.Router();
const jwt = require('jsonwebtoken');
const verifyToken = require('../../middware/authentication');

// User login
router.post("/login", async (req, res) => {
  const { user_id, password, payroll_class } = req.body;

  if (!user_id || !password || !payroll_class) {
    return res.status(400).json({ error: "User ID, password, and payroll class are required" });
  }

  try {
    // Look up user by ID
    const [rows] = await pool().query(
      "SELECT * FROM users WHERE user_id = ?",
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    const user = rows[0];

    // Check account status
    if (user.status !== "active") {
      return res.status(403).json({ error: "Account is inactive or suspended" });
    }

    // Plain password check (no bcrypt)
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    // Verify payroll class
    if (user.primary_class !== payroll_class) {
      return res.status(403).json({ error: "Unauthorized payroll class selection" });
    }

    // 🔹 Switch DB pool() dynamically
    await switchDatabase(payroll_class);

    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        full_name: user.full_name,
        role: user.user_role,
        primary_class: user.primary_class,
        current_class: payroll_class
      },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.json({
      message: "✅ Login successful",
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.user_role,
        status: user.status,
        primary_class: user.primary_class,
        current_class: payroll_class
      }
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//  Get all users
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool().query('SELECT * FROM users');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Get single user by ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool().query('SELECT * FROM users WHERE user_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error fetching user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Create user
router.post('/', verifyToken, async (req, res) => {
  const { user_id, fullName, payroll_class, email, role, status, phone, password, expiryDate } = req.body;

  try {
    if (!user_id || !fullName || !email || !role || !payroll_class) {
      return res.status(400).json({ error: 'User ID, Payroll Class, full name, email, and role are required' });
    }

    const [] = await pool().query(
      `INSERT INTO users (user_id, full_name, primary_class, email, user_role, status, phone_number, password, expiry_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, fullName, payroll_class, email, role, status, phone, password, expiryDate]
    );

    res.status(201).json({ message: '✅ User created', user_id });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update user
router.put('/:user_id', verifyToken, async (req, res) => {
  const { full_name, email, user_role, status, phone_number, password, expiry_date } = req.body;

  try {
    const sets = [];
    const params = [];

    if (typeof full_name !== 'undefined') {
      sets.push('full_name = ?'); params.push(full_name);
    }
    if (typeof email !== 'undefined') {
      sets.push('email = ?'); params.push(email);
    }
    if (typeof user_role !== 'undefined') {
      sets.push('user_role = ?'); params.push(user_role);
    }
    if (typeof status !== 'undefined') {
      sets.push('status = ?'); params.push(status);
    }
    if (typeof phone_number !== 'undefined') {
      sets.push('phone_number = ?'); params.push(phone_number);
    }
    if (typeof expiry_date !== 'undefined') {
      sets.push('expiry_date = ?'); params.push(expiry_date);
    }

    // Only include password when a non-empty value is provided
    if (typeof password !== 'undefined' && password !== '') {
      sets.push('password = ?'); params.push(password);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const sql = `UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`;
    params.push(req.params.user_id);

    const [result] = await pool().query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });

    // return updated row for frontend to update UI and show success reliably
    const [rows] = await pool().query('SELECT * FROM users WHERE user_id = ?', [req.params.user_id]);
    res.json({ message: 'User updated', user: rows[0] });
  } catch (err) {
    console.error('❌ Error updating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Delete user
router.delete('/:user_id', verifyToken, async (req, res) => {
  try {
    const [result] = await pool().query('DELETE FROM users WHERE user_id = ?', [req.params.user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: '✅ User deleted', user_id: req.params.user_id });
  } catch (err) {
    console.error('❌ Error deleting user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
