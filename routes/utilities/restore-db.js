const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { exec } = require("child_process");
const dbConfig = require("../../config/db-config");
const mysql = require('mysql2/promise');
const router = express.Router();
const verifyToken = require('../../middware/authentication'); 

const RESTORE_DIR = path.join(process.cwd(), 'restores');
const HISTORY_FILE = path.join(RESTORE_DIR, 'restore-history.json');

// Ensure restore directory exists
if (!fs.existsSync(RESTORE_DIR)) {
    fs.mkdirSync(RESTORE_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, RESTORE_DIR);
    },
    filename: (req, file, cb) => {
        // Keep original filename for easier management
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common backup file extensions
        const allowedExtensions = ['.sql', '.dump', '.bak', '.gz', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(ext) || ext === '') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload a valid backup file.'), false);
        }
    }
});

// Helper functions for managing restore history
const loadHistory = () => {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            return [];
        }
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading history:', err);
        return [];
    }
};

const saveHistory = (history) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (err) {
        console.error('Error saving history:', err);
    }
};

const addToHistory = (entry) => {
    const history = loadHistory();
    history.push({
        ...entry,
        id: Date.now(),
        date: new Date().toISOString()
    });
    saveHistory(history);
    return history;
};

/**
 * Utility to run shell command with better error handling
 */
function runCommand(command, callback) {
    console.log('Executing command:', command);
    
    exec(command, { 
        shell: true,
        timeout: 300000, // 5 minute timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    }, (err, stdout, stderr) => {
        if (err) {
            console.error("Command failed:", err.message);
            console.error("STDERR:", stderr);
            return callback(err, null);
        }
        
        console.log("Command output:", stdout);
        if (stderr) {
            console.warn("Command warnings:", stderr);
        }
        
        callback(null, stdout);
    });
}

// Connection status route
router.get("/status", verifyToken, async (req, res) => {
    let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            await connection.execute('SELECT 1'); // Simple connectivity test
            res.json({ status: "connected", engine: "mysql" });
        } catch (err) {
        console.error("DB connection failed:", err.message);
        res.json({
            status: "disconnected",
            engine: "mysql",
            error: err.message,
        });
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (closeErr) {
                console.error("Error closing connection:", closeErr.message);
            }
        }
    }
});

// Get database name
router.get('/database', verifyToken, (req, res) => {
    const dbName = process.env.DB_NAME || dbConfig.database || 'default';
    res.json({ database: dbName });
});

/**
 * POST /api/restore-db/restore
 * Upload and restore database
 */
router.post("/restore", verifyToken, (req, res) => {
    upload.single("file")(req, res, (uploadErr) => {
        if (uploadErr) {
            console.error("Upload error:", uploadErr.message);
            return res.status(400).json({ 
                success: false, 
                error: uploadErr.message 
            });
        }

        const { database, mode = "overwrite", engine = "mysql" } = req.body;
        const file = req.file;

        if (!file || !database) {
            return res.status(400).json({ 
                success: false, 
                error: "Missing file or database parameter" 
            });
        }

        const restoreFile = file.path;
        const originalFilename = file.originalname;

        // Build command based on database engine
        let command;
        const dbUser = process.env.DB_USER || dbConfig.user;
        const dbPassword = process.env.DB_PASSWORD || dbConfig.password;
        const dbHost = process.env.DB_HOST || dbConfig.host || 'localhost';
        const dbPort = process.env.DB_PORT || dbConfig.port || 3306;

        switch (engine.toLowerCase()) {
            case "mysql":
                // Handle different file types
                if (originalFilename.endsWith('.gz')) {
                    command = `gunzip < "${restoreFile}" | mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} -p${dbPassword} ${database}`;
                } else {
                    command = `mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} -p${dbPassword} ${database} < "${restoreFile}"`;
                }
                break;
            case "postgres":
                command = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${database} -f "${restoreFile}"`;
                break;
            case "mongo":
                command = `mongorestore --host ${dbHost}:${dbPort} --db ${database} "${restoreFile}"`;
                break;
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: `Unsupported database engine: ${engine}` 
                });
        }

        // Execute the restore command
        runCommand(command, (err, output) => {
            const historyEntry = {
                filename: originalFilename,
                storedFilename: path.basename(restoreFile),
                database,
                engine,
                mode,
                status: err ? "Failed" : "Success",
                error: err ? err.message : null,
                output: output || null
            };

            // Add to history
            addToHistory(historyEntry);

            // Clean up uploaded file after processing
            setTimeout(() => {
                try {
                    if (fs.existsSync(restoreFile)) {
                        fs.unlinkSync(restoreFile);
                    }
                } catch (cleanupErr) {
                    console.error("Cleanup error:", cleanupErr.message);
                }
            }, 1000);

            if (err) {
                return res.status(500).json({ 
                    success: false, 
                    error: "Database restore failed", 
                    details: err.message 
                });
            }

            res.json({ 
                success: true, 
                message: "Database restore completed successfully", 
                entry: historyEntry 
            });
        });
    });
});

/**
 * GET /api/restore-db/history
 */
router.get("/history", verifyToken, (req, res) => {
    const history = loadHistory();
    res.json({ history });
});

/**
 * GET /api/restore-db/stats
 */
router.get("/stats", verifyToken, (req, res) => {
    const history = loadHistory();
    
    const successful = history.filter(h => h.status === "Success").length;
    const failed = history.filter(h => h.status === "Failed").length;
    const lastRestore = history.length > 0 
        ? history[history.length - 1].date 
        : null;

    res.json({ successful, failed, lastRestore });
});

/**
 * DELETE /api/restore-db/restore/:filename
 * Delete a restore entry from history
 */
router.delete('/restore/:filename', verifyToken, (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const history = loadHistory();
        
        // Find and remove the entry
        const entryIndex = history.findIndex(entry => entry.filename === filename);
        
        if (entryIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Restore entry not found' 
            });
        }

        // Remove the entry from history
        const removedEntry = history.splice(entryIndex, 1)[0];
        saveHistory(history);

        // Try to delete the associated file if it still exists
        if (removedEntry.storedFilename) {
            const filePath = path.join(RESTORE_DIR, removedEntry.storedFilename);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (fileErr) {
                console.warn('Could not delete associated file:', fileErr.message);
            }
        }

        res.json({ 
            success: true, 
            message: 'Restore entry deleted successfully' 
        });
        
    } catch (err) {
        console.error('Delete restore entry error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete restore entry' 
        });
    }
});

// Error handling middleware for multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 100MB.'
            });
        }
    }
    next(error);
});

module.exports = router;