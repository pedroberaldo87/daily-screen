const crypto = require('crypto');
const { getApiTokenByHash, touchApiToken } = require('../db');

const TOKEN_PREFIX = 'dsk_live_';
const TOKEN_RANDOM_BYTES = 32; // 256 bits entropy
const PREFIX_VISIBLE_CHARS = 12; // first 12 chars of full token stored in DB for admin UI

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// Generate a new API token. Returns { plaintext, hash, prefix }.
// plaintext is the only place the raw token exists — it must be returned to
// the caller once and then forgotten. DB stores hash + visible prefix only.
function generateToken() {
  const random = crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  const plaintext = `${TOKEN_PREFIX}${random}`;
  const hash = hashToken(plaintext);
  const prefix = plaintext.slice(0, PREFIX_VISIBLE_CHARS);
  return { plaintext, hash, prefix };
}

function logFail(reason, req) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  console.error(`[integration:auth-fail] reason=${reason} ip=${ip} path=${req.method} ${req.originalUrl}`);
}

// Middleware: requires a valid, non-revoked, non-expired bearer token.
// Attaches { id, name, prefix } to req.apiToken on success.
function requireBearerToken(req, res, next) {
  const header = req.get('authorization') || req.get('Authorization');
  if (!header) {
    logFail('missing-header', req);
    return res.status(401).json({ error: 'Token required' });
  }

  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    logFail('malformed-header', req);
    return res.status(401).json({ error: 'Token required' });
  }

  const plaintext = match[1].trim();
  if (!plaintext.startsWith(TOKEN_PREFIX)) {
    logFail('bad-prefix', req);
    return res.status(401).json({ error: 'Invalid token' });
  }

  const hash = hashToken(plaintext);
  const row = getApiTokenByHash(hash);

  if (!row) {
    logFail('unknown-token', req);
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (row.revoked_at) {
    logFail(`revoked token=${row.token_prefix}`, req);
    return res.status(401).json({ error: 'Token revoked' });
  }

  if (row.expires_at) {
    const now = new Date();
    const expires = new Date(row.expires_at.replace(' ', 'T') + 'Z');
    if (!isNaN(expires.getTime()) && expires <= now) {
      logFail(`expired token=${row.token_prefix}`, req);
      return res.status(401).json({ error: 'Token expired' });
    }
  }

  // Update last_used_at. Best-effort — failure here shouldn't block the request.
  try {
    touchApiToken(row.id);
  } catch (err) {
    console.error('[integration] failed to update last_used_at:', err.message);
  }

  req.apiToken = {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
  };

  next();
}

module.exports = {
  requireBearerToken,
  generateToken,
  hashToken,
  TOKEN_PREFIX,
};
