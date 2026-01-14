const dotenv = require('dotenv');
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
const { notificationMiddleware } = require('./middware/notifications');
const seamlessWrapper = require('./services/helpers/historicalReportWrapper');
const express = require('express');
const app = express();
const session = require('express-session');
const serveIndex = require('serve-index');
const pool = require('./config/db'); 
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const PORT = process.env.PORT || 5500;



// Load env variables
dotenv.config({ path: path.resolve(__dirname, envFile) });
console.log('Running in', process.env.NODE_ENV);



// security headers & logging
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdn.tailwindcss.com",
        "https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js",
        "'unsafe-eval'",   
      ],
      scriptSrcAttr: ["'unsafe-inline'"], 
    },
  })
);
app.use(morgan('dev'));



// CORS appears before session middleware if cookies are used cross-origin
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// session config (use env values in production)
app.use(session({
  secret: process.env.JWT_SECRET || 'super-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true on HTTPS
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(notificationMiddleware);

async function startServer() {
  await seamlessWrapper.initialize();

  // mount routes
  require('./routes')(app);

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});


// static files and directory listing
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', serveIndex(path.join(__dirname, 'public'), { icons: true }));

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
