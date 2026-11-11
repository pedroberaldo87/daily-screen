// Authentication for /api/* and for the wall-display page.
//
// Three kinds of caller are accepted on /api/*:
//   admin   — a logged-in admin session (Google OAuth cookie)
//   token   — "Authorization: Bearer dsk_live_..." (same tokens as /integration/v1)
//   display — the paired wall tablet, identified by an httpOnly cookie that
//             is set once by opening  /?key=<DISPLAY_KEY>
//
// The display credential is deliberately narrow: it can only reach the
// endpoints the display page itself calls (see DISPLAY_ALLOWED). Everything
// else answers 403 to it. Anything with no credential answers 401.

const crypto = require('crypto');
const { requireBearerToken } = require('./token-auth');
const { isAdminSession } = require('./auth');

const DISPLAY_COOKIE = 'ds_display';
const DISPLAY_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // 400 days (browser cap)
const DISPLAY_KEY_MIN_LENGTH = 32;

// Endpoints reachable with the display credential (path relative to /api).
const DISPLAY_ALLOWED = [
  ['GET', /^\/tasks\/?$/],
  ['POST', /^\/tasks\/\d+\/toggle\/?$/],
  ['POST', /^\/tasks\/\d+\/recreate\/?$/],
  ['GET', /^\/completed\/?$/],
  ['GET', /^\/weather\/?$/],
  ['GET', /^\/settings\/?$/],
];

let warnedAboutKey = false;

// The display key comes from the DISPLAY_KEY env var. Unset or too short means
// display pairing is disabled (fails closed); the admin and Bearer tokens keep working.
function getDisplayKey() {
  const key = process.env.DISPLAY_KEY || '';
  if (key.length >= DISPLAY_KEY_MIN_LENGTH) return key;
  if (!warnedAboutKey) {
    warnedAboutKey = true;
    console.warn(
      key
        ? `[display] DISPLAY_KEY is shorter than ${DISPLAY_KEY_MIN_LENGTH} characters; display pairing is disabled.`
        : '[display] DISPLAY_KEY is not set; display pairing is disabled.'
    );
  }
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Hash first so both buffers have the same length and nothing leaks via timing.
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// What the cookie holds: an HMAC derived from the key, never the key itself.
// Rotating DISPLAY_KEY (or SESSION_SECRET) invalidates every paired display.
function displayCookieValue(key) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET || '')
    .update(`daily-screen:display:v1:${key}`)
    .digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function hasDisplayCookie(req) {
  const key = getDisplayKey();
  if (!key) return false;
  return safeEqual(readCookie(req, DISPLAY_COOKIE), displayCookieValue(key));
}

function keyMatches(candidate) {
  const key = getDisplayKey();
  if (!key || typeof candidate !== 'string' || !candidate) return false;
  return safeEqual(candidate, key);
}

function setDisplayCookie(req, res) {
  res.cookie(DISPLAY_COOKIE, displayCookieValue(getDisplayKey()), {
    maxAge: DISPLAY_COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'strict',
    secure: Boolean(req.secure), // true behind the HTTPS proxy (trust proxy is on in production)
    path: '/',
  });
}

function displayMayCall(req) {
  return DISPLAY_ALLOWED.some(([method, re]) => req.method === method && re.test(req.path));
}

// Gate for everything under /api. Sets req.auth = { type: 'admin'|'token'|'display' }.
function requireApiCaller(req, res, next) {
  if (isAdminSession(req)) {
    req.auth = { type: 'admin' };
    return next();
  }

  if (req.get('authorization')) {
    // Bearer path: requireBearerToken answers 401 itself on any failure.
    return requireBearerToken(req, res, () => {
      req.auth = { type: 'token' };
      next();
    });
  }

  if (hasDisplayCookie(req)) {
    if (!displayMayCall(req)) return res.status(403).json({ error: 'Forbidden' });
    req.auth = { type: 'display' };
    return next();
  }

  res.status(401).json({ error: 'Authentication required' });
}

// Guard for management routes: admin session or integration token, never the display.
function requirePrivileged(req, res, next) {
  if (req.auth && req.auth.type !== 'display') return next();
  res.status(403).json({ error: 'Forbidden' });
}

module.exports = {
  DISPLAY_COOKIE,
  DISPLAY_KEY_MIN_LENGTH,
  requireApiCaller,
  requirePrivileged,
  isAdminSession,
  hasDisplayCookie,
  keyMatches,
  setDisplayCookie,
};
