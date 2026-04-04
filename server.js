require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const { db, seedIfEmpty } = require('./db');
const SQLiteStore = require('./session-store');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Security headers
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Trust proxy in production (behind Caddy)
if (isProduction) app.set('trust proxy', 1);

// Session with SQLite persistence
app.use(session({
  store: new SQLiteStore(db),
  secret: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET env var must be set'); })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
  },
}));

// Routes
app.use('/', require('./routes/display'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Seed development data
seedIfEmpty();

app.listen(PORT, () => {
  console.log(`Daily Screen running on http://localhost:${PORT}`);
});
