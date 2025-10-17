const express = require('express');
const router = express.Router();
const pool = require('../../../config/db.js');
const verifyToken = require('../../../middware/authentication.js');

//Get individual payment by empno
router.get('/:his_empno', verifyToken, async (req, res) => {
    const his_empno = req.params.his_empno;
    try {
        const [rows] = await pool.query('SELECT * FROM py_calculation WHERE his_empno = ?', [his_empno]);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching individual payments:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

//get all
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM py_calculation');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching all individual payments:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

//Add new individual payment
router.post('/create', verifyToken, async (req, res) => {
    const { his_empno, his_type, amtthismth } = req.body;
    const createdby = req.user_fullname;

    try {
        const [result] = await pool.query(
            'INSERT INTO py_calculation (his_empno, his_type, amtthismth, createdby) VALUES (?, ?, ?, ?)',
            [his_empno, his_type, amtthismth, createdby]
        );
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error adding individual payment:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

//update individual payment (using composite key)
router.put('/:his_empno/:his_type', verifyToken, async (req, res) => {
    const { his_empno, his_type } = req.params;
    const { amtthismth } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE py_calculation SET amtthismth = ? WHERE his_empno = ? AND his_type = ?',
            [amtthismth, his_empno, his_type]
        );
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error updating individual payment:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

//delete individual payment (using composite key)
router.delete('/:his_empno/:his_type', verifyToken, async (req, res) => {
    const { his_empno, his_type } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM py_calculation WHERE his_empno = ? AND his_type = ?', [his_empno, his_type]);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error deleting individual payment:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

module.exports = router;