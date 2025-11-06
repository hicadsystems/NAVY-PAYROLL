const express = require('express');
const pool  = require('../../config/db'); // mysql2 pool
const router = express.Router();
const path = require('path');
const dotenv = require('dotenv');
const envFile = '.env.local';
dotenv.config({ path: path.resolve(__dirname, envFile) });
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const verifyToken = require('../../middware/authentication');



// User login - searches across all databases
router.post("/login", async (req, res) => {
  const { user_id, password, payroll_class } = req.body;
  // payroll_class comes from frontend as: 'hicaddata', 'hicaddata1'

  try {
    const userCandidates = []; // Store all found user instances

    // Get list of all available databases to search
    let databasesToSearch = [];
    
    try {
      // Try to get all db_classes from officers database
      pool.useDatabase(process.env.DB_OFFICERS);
      const [dbClasses] = await pool.query("SELECT db_name FROM db_classes");
      
      // Build list: officers first, then all other databases
      const otherDatabases = dbClasses.map(row => row.db_name).filter(db => db !== process.env.DB_OFFICERS);
      databasesToSearch = [process.env.DB_OFFICERS, ...otherDatabases];
      
      console.log("📋 Databases to search:", databasesToSearch);
    } catch (err) {
      // If db_classes table doesn't exist, fallback to searching common databases
      console.log("⚠️ Could not fetch db_classes, using fallback list");
      databasesToSearch = [
        process.env.DB_OFFICERS,
        process.env.DB_WOFFICERS,
        process.env.DB_RATINGS,
        process.env.DB_RATINGS_A,
        process.env.DB_RATINGS_B,
        process.env.DB_JUNIOR_TRAINEE
      ];
    }

    // Search for user in ALL databases and collect all instances
    for (const dbName of databasesToSearch) {
      if (!dbName) continue; // Skip null/undefined entries
      
      try {
        console.log(`🔍 Searching for user ${user_id} in database: ${dbName}`);
        pool.useDatabase(dbName);
        
        const [rows] = await pool.query(
          "SELECT * FROM users WHERE user_id = ?",
          [user_id]
        );
        
        if (rows.length > 0) {
          const foundUser = rows[0];
          userCandidates.push({
            user: foundUser,
            database: dbName
          });
          console.log(`✅ User found in database: ${dbName}`);
          console.log(`   👤 Name: ${foundUser.full_name}, Primary Class: ${foundUser.primary_class}`);
          console.log(`   🔐 Password: "${foundUser.password}" (type: ${typeof foundUser.password})`);
        }
      } catch (err) {
        // If database doesn't exist or has no users table, continue to next
        console.log(`❌ Error searching database ${dbName}:`, err.message);
        continue;
      }
    }

    // If user not found in ANY database
    if (userCandidates.length === 0) {
      console.log(`❌ User ${user_id} not found in any database`);
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    console.log(`\n📊 Found ${userCandidates.length} instance(s) of user ${user_id}`);

    // Now validate password and find matching user
    let authenticatedUser = null;
    let authenticatedDatabase = null;

    for (const candidate of userCandidates) {
      const { user, database } = candidate;
      
      console.log(`\n🔐 Checking credentials for user in ${database}:`);
      console.log(`   Stored password: "${user.password}" (${typeof user.password})`);
      console.log(`   Provided password: "${password}" (${typeof password})`);
      console.log(`   Match: ${user.password === password}`);
      console.log(`   Status: ${user.status}`);
      console.log(`   Primary class: ${user.primary_class}`);
      console.log(`   Requested class: ${payroll_class}`);

      // Check if password matches, status is active, and primary_class matches
      if (user.password === password && 
          user.status === "active" && 
          user.primary_class === payroll_class) {
        authenticatedUser = user;
        authenticatedDatabase = database;
        console.log(`✅ Valid credentials found in ${database}!`);
        break; // Found valid match, stop searching
      } else {
        console.log(`❌ Invalid credentials in ${database}:`);
        if (user.password !== password) console.log(`   - Password mismatch`);
        if (user.status !== "active") console.log(`   - Account status: ${user.status}`);
        if (user.primary_class !== payroll_class) console.log(`   - Class mismatch (has: ${user.primary_class}, wants: ${payroll_class})`);
      }
    }

    // If no valid match found after checking all instances
    if (!authenticatedUser) {
      console.log(`\n❌ No valid credentials found for user ${user_id} across all databases`);
      
      // Provide specific error message
      const hasPasswordMatch = userCandidates.some(c => c.user.password === password);
      const hasInactiveAccount = userCandidates.some(c => c.user.status !== "active");
      const hasClassMismatch = userCandidates.some(c => c.user.primary_class !== payroll_class);
      
      if (hasInactiveAccount && hasPasswordMatch) {
        return res.status(403).json({ error: "Account is inactive or suspended" });
      } else if (hasClassMismatch && hasPasswordMatch) {
        return res.status(403).json({ 
          error: "Unauthorized payroll class selection. You can only login to your assigned class." 
        });
      } else {
        return res.status(401).json({ error: "Invalid User ID or password" });
      }
    }

    // Switch to user's assigned database (their primary_class)
    pool.useDatabase(payroll_class);

    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: authenticatedUser.user_id,
        full_name: authenticatedUser.full_name,
        role: authenticatedUser.user_role,
        primary_class: authenticatedUser.primary_class,
        current_class: payroll_class,
        created_in: authenticatedDatabase
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    console.log(`\n✅ Login successful for user ${user_id} from ${authenticatedDatabase}`);

    res.json({
      message: "✅ Login successful",
      token,
      user: {
        user_id: authenticatedUser.user_id,
        full_name: authenticatedUser.full_name,
        email: authenticatedUser.email,
        role: authenticatedUser.user_role,
        status: authenticatedUser.status,
        primary_class: authenticatedUser.primary_class,
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
    const [rows] = await pool.query(`
      SELECT u.*, c.display_name AS class_display_name
      FROM users u
      LEFT JOIN db_classes c ON u.primary_class = c.db_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


// Get single user by ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.*, c.display_name AS class_display_name
      FROM users u
      LEFT JOIN db_classes c ON u.primary_class = c.db_name
      WHERE u.user_id = ?
    `, [req.params.id]);

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

    const [] = await pool.query(
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
  const {payroll_class, full_name, email, user_role, status, phone_number, password, expiry_date } = req.body;

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
    if (typeof payroll_class !== 'undefined') {
      sets.push('primary_class = ?'); params.push(payroll_class);
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

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });

    // return updated row for frontend to update UI and show success reliably
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.params.user_id]);
    res.json({ message: 'User updated', user: rows[0] });
  } catch (err) {
    console.error('❌ Error updating user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

//  Delete user
router.delete('/:user_id', verifyToken, async (req, res) => {
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
