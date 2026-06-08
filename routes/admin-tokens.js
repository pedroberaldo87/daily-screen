const { Router } = require('express');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  deleteApiToken,
} = require('../db');
const { generateToken } = require('../middleware/token-auth');

const router = Router();

// Auth guard that returns JSON 401 (for API calls from the admin panel fetch())
function requireAuthJson(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// HTML page (redirects if not authed)
router.get('/tokens', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'admin-tokens.html'));
});

// JSON list of tokens
router.get('/api/tokens', requireAuthJson, (req, res) => {
  res.json(listApiTokens());
});

// Create a new token. Returns the plaintext value ONCE.
router.post('/api/tokens', requireAuthJson, (req, res) => {
  const { name, expires_at } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'name max 100 chars' });
  }
  if (expires_at !== undefined && expires_at !== null && expires_at !== '') {
    if (typeof expires_at !== 'string') {
      return res.status(400).json({ error: 'expires_at must be ISO string or null' });
    }
    if (isNaN(new Date(expires_at).getTime())) {
      return res.status(400).json({ error: 'expires_at must be a valid ISO date' });
    }
  }

  const { plaintext, hash, prefix } = generateToken();
  const row = createApiToken({
    name: name.trim(),
    tokenPrefix: prefix,
    tokenHash: hash,
    expiresAt: expires_at || null,
  });

  // Plaintext is returned here and NEVER again — UI must surface it prominently.
  res.status(201).json({ ...row, plaintext });
});

// Revoke (soft — keeps audit trail)
router.post('/api/tokens/:id/revoke', requireAuthJson, (req, res) => {
  const ok = revokeApiToken(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Token not found or already revoked' });
  res.json({ ok: true });
});

// Hard delete
router.delete('/api/tokens/:id', requireAuthJson, (req, res) => {
  const ok = deleteApiToken(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Token not found' });
  res.json({ ok: true });
});

module.exports = router;
