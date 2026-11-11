// Boots the real Express app against a throwaway SQLite file for HTTP-level tests.
// Env must be set before ../../server (and so db.js) is first required, so every
// test file calls bootApp() before touching anything else from the app.
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DISPLAY_KEY = 'k'.repeat(48);

function bootApp(name, { adminEmails = 'admin@example.com' } = {}) {
  process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-${name}-test-${process.pid}.db`);
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.ADMIN_EMAILS = adminEmails;
  process.env.DISPLAY_KEY = DISPLAY_KEY;

  const signature = require('cookie-signature');
  const dbModule = require('../../db');
  const { generateToken } = require('../../middleware/token-auth');
  const app = require('../../server');

  function makeBearer() {
    const { plaintext, hash, prefix } = generateToken();
    dbModule.createApiToken({ name: 'test', tokenPrefix: prefix, tokenHash: hash, expiresAt: null });
    return { authorization: `Bearer ${plaintext}` };
  }

  // A signed session cookie backed by a row written the way the store writes it.
  function makeSessionCookie(sess = {}, ttlMs = 3600000) {
    const sid = crypto.randomBytes(16).toString('hex');
    const full = { cookie: { maxAge: ttlMs, httpOnly: true, path: '/' }, ...sess };
    dbModule.db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)')
      .run(sid, JSON.stringify(full), Date.now() + ttlMs);
    return {
      sid,
      cookie: `connect.sid=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`,
    };
  }

  async function listen() {
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (method, url, { headers = {}, body } = {}) => {
      const init = { method, headers: { ...headers }, redirect: 'manual' };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['content-type'] = 'application/json';
      }
      return fetch(base + url, init);
    };
    const close = () => { server.closeAllConnections(); server.close(); };
    return { call, close, base };
  }

  return { ...dbModule, app, makeBearer, makeSessionCookie, listen, DISPLAY_KEY };
}

module.exports = { bootApp };
