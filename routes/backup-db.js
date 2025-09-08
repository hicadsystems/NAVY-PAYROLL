const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { spawn } = require("child_process");
const zlib = require("zlib");
const cron = require("node-cron");
require('dotenv').config();
const dbConfig = require("../db-config");
const mysql = require('mysql2');
const scheduledJobs = {}; // to track scheduled cron jobs

// Middleware to check admin authentication
/*const requireAdmin = (req, res, next) => {
  // Add your admin authentication logic here
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};*/

// Create backup directory if it doesn't exist
const backupDir = path.join(__dirname, '../backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Get DB name
router.get('/database', (req, res) => {
  res.json({ database: process.env.DB_NAME });
});


// MySQL/MariaDB backup
router.post("/backup/mysql", async (req, res) => {
  try {
    const { backupType, compression, storage } = req.body;
    const dbName = process.env.DB_NAME;

    // filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let filename = `${dbName}_${backupType}_${timestamp}.sql`;
    if (compression) filename += ".gz";

    // choose storage folder
    const backupDir =
      storage === "cloud"
        ? path.join(__dirname, "..", "cloud_backups")
        : path.join(__dirname, "..", "backups");

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, filename);

    // use spawn instead of exec (avoids shell quoting issues, safer on all OS)
    let args = [
      "-u",
      process.env.DB_USER,
      `-p${process.env.DB_PASSWORD}`,
      process.env.DB_NAME,
    ];

    if (backupType === "incremental") {
      // ⚠️ placeholder only — real incremental uses binlogs
      args.push("--where=1=1");
    }

    const mysqldump = spawn("mysqldump", args);

    const outStream = fs.createWriteStream(backupPath);
    if (compression) {
      mysqldump.stdout.pipe(zlib.createGzip()).pipe(outStream);
    } else {
      mysqldump.stdout.pipe(outStream);
    }

    mysqldump.on("error", (err) => {
      console.error("Backup process error:", err);
      return res.status(500).json({ success: false, error: err.message });
    });

    mysqldump.on("close", (code) => {
      if (code === 0) {
        res.json({ success: true, filename, path: backupPath });
      } else {
        res.status(500).json({ success: false, error: "mysqldump failed" });
      }
    });
  } catch (err) {
    console.error("Backup failed:", err);
    res.status(500).json({ success: false, error: "Backup process failed" });
  }
});

// schedule backup route
router.post("/backup/schedule", (req, res) => {
  try {
    const { schedule, backupType, compression, storage } = req.body;
    const dbName = process.env.DB_NAME;

    // map schedule options from frontend → cron expressions
    const scheduleMap = {
      hourly: "0 * * * *",     // top of every hour
      daily: "0 0 * * *",      // midnight
      weekly: "0 0 * * 0",     // Sunday midnight
    };

    const cronExp = scheduleMap[schedule];
    if (!cronExp) {
      return res.status(400).json({ success: false, error: "Invalid schedule option" });
    }

    // clear old job if same name
    if (scheduledJobs[schedule]) {
      scheduledJobs[schedule].stop();
    }

    // create new cron job
    const job = cron.schedule(cronExp, () => {
      console.log(`Running scheduled backup for ${dbName} (${schedule})`);

      // 🔁 reuse your backup logic here
      runBackup({ dbName, backupType, compression, storage });
    });

    scheduledJobs[schedule] = job;

    res.json({
      success: true,
      message: `Backup scheduled (${schedule}) for database ${dbName}`,
    });
  } catch (err) {
    console.error("Schedule error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// helper function that runs mysqldump
function runBackup({ dbName, backupType, compression, storage }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let filename = `${dbName}_${backupType}_${timestamp}.sql`;
  if (compression) filename += ".gz";

  const backupDir =
    storage === "cloud"
      ? path.join(__dirname, "..", "cloud_backups")
      : path.join(__dirname, "..", "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, filename);

  const args = [
    "-u",
    process.env.DB_USER,
    `-p${process.env.DB_PASS}`,
    process.env.DB_NAME,
  ];

  if (backupType === "incremental") {
    args.push("--where=1=1"); // placeholder
  }

  const mysqldump = spawn("mysqldump", args);

  const outStream = fs.createWriteStream(backupPath);
  if (compression) {
    mysqldump.stdout.pipe(zlib.createGzip()).pipe(outStream);
  } else {
    mysqldump.stdout.pipe(outStream);
  }

  mysqldump.on("close", (code) => {
    if (code === 0) {
      console.log(`✅ Backup complete: ${backupPath}`);
    } else {
      console.error("❌ Backup failed");
    }
  });
}

// PostgreSQL backup
/*router.post('/backup/postgresql',  async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `payroll_backup_${timestamp}.sql`;
    const filepath = path.join(backupDir, filename);
    
    const pgdump = spawn('pg_dump', [
      '-h', process.env.DB_HOST || 'localhost',
      '-U', process.env.DB_USER,
      '-d', process.env.DB_NAME,
      '-f', filepath
    ], {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }
    });
    
    pgdump.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          message: 'Backup created successfully',
          filename: filename,
          filepath: filepath,
          size: fs.statSync(filepath).size
        });
      } else {
        res.status(500).json({ error: 'Backup failed' });
      }
    });
    
    pgdump.on('error', (err) => {
      res.status(500).json({ error: 'Backup process failed: ' + err.message });
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MongoDB backup
router.post('/backup/mongodb',  async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `mongodb_backup_${timestamp}`);
    
    const mongodump = spawn('mongodump', [
      '--host', process.env.DB_HOST || 'localhost',
      '--db', process.env.DB_NAME,
      '--out', backupPath
    ]);
    
    mongodump.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          message: 'MongoDB backup created successfully',
          backupPath: backupPath
        });
      } else {
        res.status(500).json({ error: 'MongoDB backup failed' });
      }
    });
    
    mongodump.on('error', (err) => {
      res.status(500).json({ error: 'Backup process failed: ' + err.message });
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});*/

// Get list of existing backups
router.get('/backups', (req, res) => {
    const backupDir = path.join(__dirname, '..', 'backups');

    if (!fs.existsSync(backupDir)) {
        return res.json({ backups: [] });
    }

    const files = fs.readdirSync(backupDir);
    const backups = files.map(file => {
        const stats = fs.statSync(path.join(backupDir, file));
        return {
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
        };
    });

    res.json({ backups });
});

// Download backup file
router.get('/backup/download/:filename', (req, res) => {
    const { filename } = req.params;

    // Check both local and cloud directories
    const localPath = path.join(__dirname, '..', 'backups', filename);
    const cloudPath = path.join(__dirname, '..', 'cloud_backups', filename);

    let filePath = null;
    if (fs.existsSync(localPath)) filePath = localPath;
    if (fs.existsSync(cloudPath)) filePath = cloudPath;

    if (!filePath) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }

    res.download(filePath, filename, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(500).json({ success: false, error: 'Download failed' });
        }
    });
});


// Delete a backup file
router.delete('/backup/:filename', (req, res) => {
    const { filename } = req.params;

    // Check both local and cloud directories
    const localPath = path.join(__dirname, '..', 'backups', filename);
    const cloudPath = path.join(__dirname, '..', 'cloud_backups', filename);

    let filePath = null;
    if (fs.existsSync(localPath)) filePath = localPath;
    if (fs.existsSync(cloudPath)) filePath = cloudPath;

    if (!filePath) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }

    try {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'Backup deleted successfully' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// Get backup statistics
router.get('/backup/stats', async (req, res) => {
    try {
        const backupDir = path.join(__dirname, '..', 'backups');

        if (!fs.existsSync(backupDir)) {
            return res.json({
                successfulBackups: 0,
                totalStorage: 0,
                lastBackup: null
            });
        }

        const files = fs.readdirSync(backupDir);

        let totalStorage = 0;
        let lastBackup = null;

        files.forEach(file => {
            const filePath = path.join(backupDir, file);
            const stats = fs.statSync(filePath);
            totalStorage += stats.size;

            if (!lastBackup || stats.mtime > lastBackup) {
                lastBackup = stats.mtime;
            }
        });

        res.json({
            successfulBackups: files.length,
            totalStorage,
            lastBackup
        });

    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to calculate stats' });
    }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.ping(); // 🔥 real check
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
      await connection.end();
    }
  }
});

module.exports = router;