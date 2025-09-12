const dotenv = require('dotenv');
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';
const express = require('express');
const session = require('express-session');
const serveIndex = require('serve-index');
const pool = require('./config/db'); // ensure ./db exports poolPromise or pool
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
//const multer = require("multer");
const app = express();
const adminRoutes = require('./routes/admin');
const usersRoutes = require('./routes/administration/users');
const backupRoutes = require('./routes/utilities/backup-db');
const restoreRoutes = require("./routes/utilities/restore-db");
const statesRoutes  = require("./routes/refrence-tables/states");
const payelementsRoutes  = require("./routes/refrence-tables/states");



//const {SetupManager, DatabaseUtils} = require('./routes/db-backup');
const PORT = process.env.PORT || 5500;
// Load env variables
dotenv.config({ path: path.resolve(__dirname, envFile) });
console.log('Running in', process.env.NODE_ENV);
console.log('Database:', process.env.DB_NAME);


// security headers & logging
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdn.tailwindcss.com",
        "'unsafe-eval'",   
      ],
      scriptSrcAttr: ["'unsafe-inline'"], 
    },
  })
);
app.use(morgan('dev'));

// CORS - should appear before session middleware if cookies are used cross-origin
const corsOptions = {
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://hicad.ng',// production
  ].filter(Boolean),
  methods: ['GET','POST','PUT','DELETE'],
  credentials: true
};
app.use(cors(corsOptions));

// trust proxy when behind load balancer (set in env when needed)
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// built-in body parsers (remove body-parser dependency)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/admin', adminRoutes);

// session config (use env values in production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'super-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true on HTTPS
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// mount routes
app.use('/admin', adminRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/backup-db', backupRoutes);
app.use("/api/restore-db", restoreRoutes);
app.use("/", statesRoutes);
app.use("/", payelementsRoutes);


//middleware
// static files and directory listing
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', serveIndex(path.join(__dirname, 'public'), { icons: true }));

// simple route example
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});



// small helper to expose credentials header for some clients
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// centralized error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: 'Internal Server Error' });
});


// ✅ Show all users
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching users:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});








// graceful shutdown
function shutdown(err) {
  if (err) console.error('Shutdown due to error:', err);
  console.log('Shutting down server...');
  // close DB pool if available
  if (pool && pool.close) {
    pool.close().catch(()=>{});
  }
  process.exit(err ? 1 : 0);
}
process.on('uncaughtException', shutdown);
process.on('unhandledRejection', shutdown);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
