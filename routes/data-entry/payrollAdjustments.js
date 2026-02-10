const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const config = require('../../config');

const router = express.Router();


// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'batch-adjustments-' + uniqueSuffix + path.extname(file.originalname));
    }
});


const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedExtensions = ['.xlsx', '.xls', '.csv'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
        }
    }
});

// converts keys to lowercase and spaces to _
function normalize(row) {
    const normalized = {};

    for (const key in row) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;

        const lowerKey = key.trim().toLowerCase().replace(/\s+/g, "_")
        normalized[lowerKey] = row[key];
    }

    return normalized;
}

const PAYCLASS_MAPPING = {
    '1': config.databases.officers,
    '2': config.databases.wofficers,
    '3': config.databases.ratings,
    '4': config.databases.ratingsA,
    '5': config.databases.ratingsB,
    '6': config.databases.juniorTrainee
};

// Helper function to parse Excel file
function parseExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}

// Helper function to parse CSV file
function parseCSVFile(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

function rowSignature(row) {
    const sortedKeys = Object.keys(row).sort();
    const normalized = {};

    for (const key of sortedKeys) {
        const value = row[key];
        normalized[key] = typeof value === 'string' ? value.trim() : value;
    }

    return JSON.stringify(normalized);
}

function deduplicate(rows) {
    const seen = new Set();
    const cleaned = [];
    const duplicates = [];

    for (const row of rows) {
        const sig = rowSignature(row);
        if (!seen.has(sig)) {
            seen.add(sig);
            cleaned.push(row);
        } else {
            duplicates.push(row);
        }
    }

    return { cleaned, duplicates };
}

router.post('/adjustments', verifyToken, upload.single('file'), async (req, res) => {
    try {

        let filePath = null;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        const createdBy = req.user_id || 'SYSTEM';

        // Parse file
        let rawData;
        if (fileExt === '.csv') {
            rawData = (await parseCSVFile(filePath)).map(normalize);
        } else {
            rawData = parseExcelFile(filePath).map(normalize);
        }

        if (!rawData || rawData.length === 0) {
            return res.status(400).json({ error: 'File is empty or invalid' });
        }
        rawData = rawData?.filter(row => Object.keys(row).length > 0);

        // Cleanup, Authentication, Filtering(actual business logic)

        const { cleaned, duplicates } = deduplicate(rawData)



        const query = 'SELECT Empl_id FROM hr_employees WHERE DateLeft IS NULL AND exittype IS NULL'

        const [rows] = await pool.query(query)

        const activeEmployeeSet = new Set(rows.map(r => r.Empl_id));


        const filtered = cleaned.filter(row =>
            activeEmployeeSet.has(row.numb?.trim())
        );




        // Clean up file
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        return res.status(200).json({
            message: 'Batch adjustment upload completed',
            summary: results
        });

        // Shape of Response
        // { totalUniqueRecords: '', inactive: 0, Uploaded:'', existing:''}

    } catch (error) {
        console.error('Error processing adjustments:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing adjustments',
            error: error.message
        });
    }
});

// GET: Download sample template
router.get('/template', verifyToken, (req, res) => {

    // Create sample data
    const sampleData = [{
        'Service Number': 'NN001',
        'Payment Type': 'PT330',
        'Maker 1': 'No',
        'Amount Payable': '5000.00',
        'Maker 2': 'No',
        'Amount': '5000.00',
        //'Amount Already Deducted': '0.00',
        'Amount To Date': '0.00',
        'Payment Indicator': 'T',
        'Number of Months': '12',
        'Created By': 'Admin'
    }];

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment-Deductions');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Send file
    res.setHeader('Content-Disposition', 'attachment; filename=payment-deductions_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});


// Error handling middleware
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds 10MB limit' });
        }
        return res.status(400).json({ error: error.message });
    }

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    next();
});

module.exports = router;
