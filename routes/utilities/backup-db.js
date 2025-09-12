const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const express = require('express');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const verifyToken = require('../../middware/authentication'); 

const router = express.Router();

// CONFIG: adjust if your config path differs
const dbConfig = require('../../config/db-config');

// ROOT dirs (always point to project root)
const ROOT_BACKUP_DIR = path.resolve(process.cwd(), 'backups');
const ROOT_CLOUD_BACKUP_DIR = path.resolve(process.cwd(), 'cloud_backups');

// ensure folders exist
if (!fs.existsSync(ROOT_BACKUP_DIR)) fs.mkdirSync(ROOT_BACKUP_DIR, { recursive: true });
if (!fs.existsSync(ROOT_CLOUD_BACKUP_DIR)) fs.mkdirSync(ROOT_CLOUD_BACKUP_DIR, { recursive: true });

console.log('Local backups dir:', ROOT_BACKUP_DIR);
console.log('Cloud backups dir:', ROOT_CLOUD_BACKUP_DIR);

const scheduledJobs = {}; // keep track of cron jobs

//Helper Functions
function listFilesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .map((file) => {
      const stats = fs.statSync(path.join(dir, file));
      return {
        filename: file,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    })
    .sort((a, b) => b.modified - a.modified); // newest first
}

function getLatestStats(dir) {
  const files = listFilesInDir(dir);
  if (files.length === 0) {
    return {
      successfulBackups: 0,
      totalStorage: 0,
      lastBackup: null,
      lastFile: null
    };
  }

  const latest = files[0];
  // totalStorage = size of latest (since you want latest stats), but we can keep aggregate if needed
  return {
    successfulBackups: 1,
    totalStorage: latest.size,
    lastBackup: latest.modified,
    lastFile: latest.filename
  };
}

/* Runs the actual mysqldump, returns a Promise that resolves with { path, filename } or rejects */
function runBackup({ dbName, backupType = 'full', compression = false, storage = 'local' }) {
  return new Promise((resolve, reject) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename = `${dbName}_${backupType}_${timestamp}.sql`;
      if (compression) filename += '.gz';

      const backupDir = storage === 'cloud' ? ROOT_CLOUD_BACKUP_DIR : ROOT_BACKUP_DIR;
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const backupPath = path.join(backupDir, filename);

      // build args for mysqldump
      const args = [
        '-u', process.env.DB_USER || dbConfig.user,
        `-p${process.env.DB_PASSWORD || dbConfig.password}`,
        dbName
      ];

      if (backupType === 'incremental') {
        // placeholder: real incremental requires binlogs; keeping placeholder as in original
        args.push('--where=1=1');
      }

      const dump = spawn('mysqldump', args);

      const outStream = fs.createWriteStream(backupPath);
      const gzip = compression ? zlib.createGzip() : null;

      let childExitCode = null;
      let responded = false;

      dump.on('error', (err) => {
        if (!responded) {
          responded = true;
          reject(new Error('Backup process error: ' + err.message));
        }
      });

      dump.on('close', (code) => {
        childExitCode = code;
        // only decide after file stream finishes
        // if no compression, the outStream will end when dump stdout ends
      });

      outStream.on('error', (err) => {
        if (!responded) {
          responded = true;
          reject(new Error('File write error: ' + err.message));
        }
      });

      outStream.on('finish', () => {
        if (responded) return;
        if (childExitCode === 0 || childExitCode === null) {
          responded = true;
          resolve({ path: backupPath, filename });
        } else {
          responded = true;
          reject(new Error('mysqldump failed with exit code ' + childExitCode));
        }
      });

      // pipe streams
      if (compression) {
        dump.stdout.pipe(gzip).pipe(outStream);
      } else {
        dump.stdout.pipe(outStream);
      }

      // safety: if dump already closed and outStream already finished, ensure we resolve
      // (handled via 'finish' and childExitCode)
    } catch (err) {
      return reject(err);
    }
  });
}

//Routes

// GET DB name (keeps existing)
router.get('/database', verifyToken, (req, res) => {
  res.json({ database: process.env.DB_NAME || dbConfig.database });
});

/*
  POST /backup/mysql
  Body: { backupType, compression (bool), storage: 'local'|'cloud' }
*/
router.post('/backup/mysql', verifyToken, async (req, res) => {
  try {
    const { backupType = 'full', compression = false, storage = 'local' } = req.body || {};
    const dbName = process.env.DB_NAME || dbConfig.database;

    const result = await runBackup({ dbName, backupType, compression, storage });
    return res.json({ success: true, filename: result.filename, path: result.path });
  } catch (err) {
    console.error('Backup failed:', err);
    return res.status(500).json({ success: false, error: err.message || 'Backup process failed' });
  }
});

/*
  POST /backup/schedule
  Body: { schedule: 'hourly'|'daily'|'weekly', backupType, compression, storage }
*/
router.post('/backup/schedule', verifyToken, (req, res) => {
  try {
    const { schedule, backupType = 'full', compression = false, storage = 'local' } = req.body || {};
    const dbName = process.env.DB_NAME || dbConfig.database;

    const scheduleMap = {
      hourly: '0 * * * *',
      daily: '0 0 * * *',
      weekly: '0 0 * * 0'
    };

    const cronExp = scheduleMap[schedule];
    if (!cronExp) return res.status(400).json({ success: false, error: 'Invalid schedule option' });

    // stop old job if exists
    if (scheduledJobs[schedule]) {
      try { scheduledJobs[schedule].stop(); } catch (e) { /* ignore */ }
    }

    const job = cron.schedule(cronExp, async () => {
      console.log(`Running scheduled backup for ${dbName} (${schedule})`);
      try {
        await runBackup({ dbName, backupType, compression, storage });
        console.log('Scheduled backup finished');
      } catch (err) {
        console.error('Scheduled backup failed:', err);
      }
    });

    scheduledJobs[schedule] = job;

    res.json({ success: true, message: `Backup scheduled (${schedule}) for database ${dbName}` });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Get list of all backups (local + cloud)
router.get('/backups', verifyToken, (req, res) => {
  const dirs = [
    { type: 'local', dir: ROOT_BACKUP_DIR },
    { type: 'cloud', dir: ROOT_CLOUD_BACKUP_DIR }
  ];

  let backups = [];

  dirs.forEach(({ type, dir }) => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      backups.push({
        filename: file,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        source: type
      });
    });
  });

  // sort newest → oldest
  backups.sort((a, b) => b.modified - a.modified);

  res.json({ backups });
});


// Get backup statistics
router.get('/backup/stats', verifyToken, (req, res) => {
  const dirs = [ROOT_BACKUP_DIR, ROOT_CLOUD_BACKUP_DIR];

  let totalStorage = 0;
  let lastBackup = null;
  let successfulBackups = 0;

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      successfulBackups++;
      totalStorage += stats.size;

      if (!lastBackup || stats.mtime > lastBackup) {
        lastBackup = stats.mtime;
      }
    });
  });

  res.json({
    successfulBackups,
    totalStorage,
    lastBackup
  });
});


/*
  Download and Delete routes (use ROOT dirs)
*/
router.get('/backup/download/:filename', verifyToken, (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(ROOT_BACKUP_DIR, filename);
  const cloudPath = path.join(ROOT_CLOUD_BACKUP_DIR, filename);

  let filePath = null;
  if (fs.existsSync(localPath)) filePath = localPath;
  if (fs.existsSync(cloudPath)) filePath = cloudPath;

  if (!filePath) return res.status(404).json({ success: false, error: 'File not found' });

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Download error:', err);
      res.status(500).json({ success: false, error: 'Download failed' });
    }
  });
});

router.delete('/backup/:filename', verifyToken, (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(ROOT_BACKUP_DIR, filename);
  const cloudPath = path.join(ROOT_CLOUD_BACKUP_DIR, filename);

  let filePath = null;
  if (fs.existsSync(localPath)) filePath = localPath;
  if (fs.existsSync(cloudPath)) filePath = cloudPath;

  if (!filePath) return res.status(404).json({ success: false, error: 'File not found' });

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

/*
  Health check - verify DB connection
*/
router.get('/health', verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    await connection.ping();
    res.json({ status: 'connected', engine: 'mysql' });
  } catch (err) {
    console.error('DB connection failed:', err.message);
    res.json({ status: 'disconnected', engine: 'mysql', error: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;
