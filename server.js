// ...existing code...
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const serveIndex = require('serve-index');
const poolPromise = require('./db'); // ensure ./db exports poolPromise or pool
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const app = express();
const adminRoutes = require('./routes/admin');
const PORT = process.env.PORT || 5500;

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
    process.env.FRONTEND_ORIGIN // optional
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
