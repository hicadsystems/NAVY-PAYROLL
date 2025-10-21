const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();

// Create a new bank
router.post("/bankcreate", verifyToken, async (req, res) => {
  try {
    const {
      bankcode, branchcode, bankname, branchname, address,
      CompanyAcctNo, ContactMgrAccountant, remarks,
      telephone, email, contact,
      cbn_code, cbn_branch
    } = req.body;

    const createdby = req.user_fullname || "Admin User";
    const datecreated = new Date();

    await pool.query(
      `INSERT INTO py_bank 
       (bankcode, branchcode, bankname, branchname, address, CompanyAcctNo, ContactMgrAccountant, remarks, telephone, email, contact, createdby, datecreated, cbn_code, cbn_branch) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bankcode, branchcode, bankname, branchname, address, CompanyAcctNo, ContactMgrAccountant, remarks, telephone, email, contact, createdby, datecreated, cbn_code, cbn_branch]
    );

    res.status(201).json({ message: "Bank created successfully" });
  } catch (err) {
    console.error("❌ Error creating bank:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get all banks
router.get("/bank", verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await pool.query("SELECT COUNT(*) AS total FROM py_bank");
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    const [rows] = await pool.query(
      "SELECT * FROM py_bank ORDER BY bankname ASC LIMIT ? OFFSET ?",
      [limit, offset]
    );

    res.json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching banks:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching banks",
      error: err.message,
    });
  }
});

// Get single bank by composite key
router.get("/:bankcode/:branchcode", verifyToken, async (req, res) => {
  try {
    const { bankcode, branchcode } = req.params;
    const [rows] = await pool.query(
      "SELECT * FROM py_bank WHERE bankcode = ? AND branchcode = ?",
      [bankcode, branchcode]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Bank not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching bank:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Search
router.get('/employees-current/search', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id);
    console.log('🔍 Search database:', currentDb);
    console.log('🔍 User ID:', req.user_id);
    
    const searchTerm = req.query.q || req.query.search || '';
    
    console.log('🔎 Search term:', searchTerm);

    let query = `
      SELECT * FROM py_bank
    `;

    const params = [];

    // Add search conditions if search term provided
    if (searchTerm) {
      query += ` AND (
        bankcode LIKE ? OR
        branchcode LIKE ? OR
        branchname LIKE ? OR
        bankname LIKE ? OR
        CONCAT(branchcode, ' ', branchname) LIKE ?
      )`;
      
      const searchPattern = `%${searchTerm}%`;
      params.push(
        searchPattern, // bankcode
        searchPattern, // branchcode
        searchPattern, // branchname
        searchPattern, // bankname
        searchPattern  // Full name
      );
    }

    query += 'ORDER BY bankname ASC'

    const [rows] = await pool.query(query, params);

    console.log('🔍 Search returned:', rows.length, 'records');

    res.json({ 
      success: true, 
      data: rows,
      searchTerm: searchTerm,
      resultCount: rows.length
    });
  } catch (err) {
    console.error('❌ Search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update bank
router.put("/:bankcode/:branchcode", verifyToken, async (req, res) => {
  try {
    const { bankcode, branchcode } = req.params;

    const { bankname, branchname, address,
      CompanyAcctNo, ContactMgrAccountant, remarks,
      telephone, email, contact,
      cbn_code, cbn_branch
    } = req.body;

    // Build dynamic update query
    const params = [];
    const sets = [];

    if (typeof bankname !== 'undefined' && bankname !== null) {
      sets.push('bankname = ?'); params.push(bankname);
    }
    if (typeof bankcode !== 'undefined' && bankcode !== null) {
      sets.push('bankcode = ?'); params.push(bankcode);
    }
    if (typeof branchcode !== 'undefined' && branchcode !== null) {
      sets.push('branchcode = ?'); params.push(branchcode);
    }
    if (typeof branchname !== 'undefined' && branchname !== null) {
      sets.push('branchname = ?'); params.push(branchname);
    }
    if (typeof address !== 'undefined' && address !== null) {
      sets.push('address = ?'); params.push(address);
    }
    if (typeof CompanyAcctNo !== 'undefined' && CompanyAcctNo !== null) {
      sets.push('CompanyAcctNo = ?'); params.push(CompanyAcctNo);
    }
    if (typeof ContactMgrAccountant !== 'undefined' && ContactMgrAccountant !== null) {
      sets.push('ContactMgrAccountant = ?'); params.push(ContactMgrAccountant);
    }
    if (typeof remarks !== 'undefined' && remarks !== null) {
      sets.push('remarks = ?'); params.push(remarks);
    }
    if (typeof telephone !== 'undefined' && telephone !== null) {
      sets.push('telephone = ?'); params.push(telephone);
    }
    if (typeof email !== 'undefined' && email !== null) {
      sets.push('email = ?'); params.push(email);
    }
    if (typeof contact !== 'undefined' && contact !== null) {
      sets.push('contact = ?'); params.push(contact);
    }
    if (typeof cbn_code !== 'undefined' && cbn_code !== null) {
      sets.push('cbn_code = ?'); params.push(cbn_code);
    }
    if (typeof cbn_branch !== 'undefined' && cbn_branch !== null) {
      sets.push('cbn_branch = ?'); params.push(cbn_branch);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add PaymentType for WHERE clause
    params.push(bankcode, branchcode);

    const sql = `UPDATE py_bank SET ${sets.join(', ')} WHERE bankcode = ? AND branchcode = ?`;
    const [result] = await pool.query(sql, params);

    // Get updated record
    const [updatedRows] = await pool.query('SELECT * FROM py_bank WHERE bankcode = ? AND branchcode = ?', [bankcode, branchcode]);

    res.json({ 
        message: "Bank updated successfully",
        elementType: updatedRows[0]
     });
  } catch (err) {
    console.error("❌ Error updating bank:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// 📌 Delete bank
router.delete("/:bankcode/:branchcode", verifyToken, async (req, res) => {
  try {
    const { bankcode, branchcode } = req.params;

    await pool.query(
      "DELETE FROM py_bank WHERE bankcode = ? AND branchcode = ?",
      [bankcode, branchcode]
    );

    res.json({ message: "Bank deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting bank:", err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
