const express = require('express');
const pool = require('../db'); // your mysql2 pool
const router = express.Router();

// ✅ Get all users
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ✅ Get single user by ID
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error fetching user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ✅ Create user
router.post('/', async (req, res) => {
  const { user_id, fullName, email, role, status, phone, password, expiryDate } = req.body;

  try {
    if (!user_id || !fullName || !email || !role) {
      return res.status(400).json({ error: 'User ID, full name, email, and role are required' });
    }

    const [] = await pool.query(
      `INSERT INTO users (user_id, full_name, email, user_role, status, phone_number, password, expiry_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, fullName, email, role, status, phone, password, expiryDate]
    );

    res.status(201).json({ message: '✅ User created', user_id });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ✅ Update user
router.put('/:user_id', async (req, res) => {
  const { fullName, email, role, status, phone, password, expiryDate } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE users 
       SET full_name = ?, email = ?, user_role = ?, status = ?, phone_number = ?, password = ?, expiry_date = ?
       WHERE user_id = ?`,
      [fullName, email, role, status, phone, password, expiryDate, req.params.user_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: '✅ User updated', user_id: req.params.user_id });
  } catch (err) {
    console.error('❌ Error updating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ✅ Delete user
router.delete('/:user_id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM users WHERE user_id = ?', [req.params.user_id]);

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
