const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const google = require('../lib/google-oauth');

google.assertConfigured();

const router = Router();

const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

// Every call creates and stores a session row, so it is throttled per client IP.
// Behind the reverse proxy (`trust proxy` is 1 in production, see server.js) req.ip
// is the real client address taken from X-Forwarded-For; otherwise it is the socket
// address. The counter is in memory, so it resets when the process restarts.
const signInStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many sign-in attempts',
});

function callbackUrl(req) {
  return `${req.protocol}://${req.get('host')}/admin/auth/google/callback`;
}

// Login page
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'login.html'));
});

// Start Google sign-in: remember state + nonce for this attempt, then hand off to Google
router.get('/auth/google', signInStartLimiter, (req, res, next) => {
  const state = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  const redirectUri = callbackUrl(req);
  req.session.oauth = { state, nonce, redirectUri, startedAt: Date.now() };
  // Nothing here is authenticated yet: keep the row (and cookie) only as long as the
  // attempt itself is valid. A successful login regenerates the session with the
  // normal 30-day lifetime.
  req.session.cookie.maxAge = LOGIN_ATTEMPT_TTL_MS;
  req.session.save((err) => {
    if (err) return next(err);
    res.redirect(google.buildAuthUrl({ redirectUri, state, nonce }));
  });
});

// Google sends the user back here
router.get('/auth/google/callback', async (req, res, next) => {
  const attempt = req.session.oauth;
  delete req.session.oauth;

  if (req.query.error) return res.redirect('/admin/login?error=cancelled');
  if (!attempt || !req.query.state || req.query.state !== attempt.state
      || Date.now() - attempt.startedAt > LOGIN_ATTEMPT_TTL_MS) {
    return res.redirect('/admin/login?error=expired');
  }

  let claims;
  try {
    claims = await google.exchangeCode({ code: String(req.query.code || ''), redirectUri: attempt.redirectUri });
  } catch (err) {
    console.error('[admin:oauth] token exchange failed:', err.message);
    return res.redirect('/admin/login?error=failed');
  }

  const result = google.checkClaims(claims, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    nonce: attempt.nonce,
    allowed: google.allowedEmails(),
  });
  if (!result.ok) {
    console.warn(`[admin:oauth] login refused (${result.reason})`);
    return res.redirect(`/admin/login?error=${result.reason === 'denied' ? 'denied' : 'failed'}`);
  }

  // New session id on login (no fixation)
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.authenticated = true;
    req.session.email = result.email;
    req.session.save((err2) => (err2 ? next(err2) : res.redirect('/admin')));
  });
});

// Logout
router.get('/logout', (req, res, next) => {
  req.session.destroy((err) => (err ? next(err) : res.redirect('/admin/login?out=1')));
});

// Admin panel (protected)
router.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'admin.html'));
});

module.exports = router;
