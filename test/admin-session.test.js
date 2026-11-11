const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/app-harness');

const h = bootApp('admin-session');
const google = require('../lib/google-oauth');

let http;
test.before(async () => { http = await h.listen(); });
test.after(() => http.close());

const sessionRows = () => h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
const sessionExists = (sid) => Boolean(h.db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get(sid));

// ── Pre-login OAuth sessions are short-lived and rate limited ──

test('starting Google sign-in stores a session that expires in about 10 minutes, not 30 days', async () => {
  const before = Date.now();
  const res = await http.call('GET', '/admin/auth/google');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^https:\/\/accounts\.google\.com\//);

  const rows = h.db.prepare('SELECT sess, expired FROM sessions').all();
  const row = rows.find((r) => JSON.parse(r.sess).oauth);
  assert.ok(row, 'the pre-login session should be stored');
  const lifetime = row.expired - before;
  assert.ok(lifetime > 0 && lifetime <= 11 * 60 * 1000, `lifetime ${lifetime}ms`);
  assert.match(res.headers.get('set-cookie'), /Max-Age=\d+|Expires=/i);
  const maxAge = /Max-Age=(\d+)/i.exec(res.headers.get('set-cookie'));
  if (maxAge) assert.ok(Number(maxAge[1]) <= 11 * 60);
});

test('an authenticated login still gets the 30-day session', async () => {
  const realExchange = google.exchangeCode;
  google.exchangeCode = async () => ({
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    exp: Date.now() / 1000 + 3600,
    nonce: nonceOfLastAttempt,
    email: 'admin@example.com',
    email_verified: true,
  });
  let nonceOfLastAttempt;
  try {
    const start = await http.call('GET', '/admin/auth/google');
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const url = new URL(start.headers.get('location'));
    nonceOfLastAttempt = url.searchParams.get('nonce');
    const state = url.searchParams.get('state');
    const cb = await http.call('GET', `/admin/auth/google/callback?state=${state}&code=x`, { headers: { cookie } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/admin');
    const newCookie = cb.headers.get('set-cookie');
    assert.match(newCookie, /connect\.sid=/);
    const sid = decodeURIComponent(newCookie.split(';')[0].split('=')[1]).slice(2).split('.')[0];
    const row = h.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
    assert.equal(JSON.parse(row.sess).authenticated, true);
    const lifetimeDays = (row.expired - Date.now()) / 86400000;
    assert.ok(lifetimeDays > 29 && lifetimeDays <= 30, `lifetime ${lifetimeDays} days`);
  } finally {
    google.exchangeCode = realExchange;
  }
});

test('/admin/auth/google is rate limited per IP and a refused request adds no session row', async () => {
  let limited;
  for (let i = 0; i < 60 && !limited; i++) {
    const res = await http.call('GET', '/admin/auth/google');
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, 'expected a 429 after repeated sign-in starts');
  const before = sessionRows();
  const again = await http.call('GET', '/admin/auth/google');
  assert.equal(again.status, 429);
  assert.equal(sessionRows(), before);
  assert.equal(again.headers.get('set-cookie'), null);
});

// ── Removing an admin from ADMIN_EMAILS ends their existing sessions ──

const ADMIN_URLS = [
  ['GET', '/admin', 'redirect'],
  ['GET', '/admin/tokens', 'redirect'],
  ['GET', '/admin/api/tokens', 401],
  ['GET', '/api/items', 401],
  ['GET', '/api/settings', 401],
];

async function expectLockedOut(cookie) {
  for (const [method, url, expected] of ADMIN_URLS) {
    const res = await http.call(method, url, { headers: { cookie } });
    if (expected === 'redirect') {
      assert.equal(res.status, 302, url);
      assert.equal(res.headers.get('location'), '/admin/login', url);
    } else {
      assert.equal(res.status, expected, url);
    }
  }
}

test('a session for an email that is still allowed keeps working', async () => {
  const { cookie } = h.makeSessionCookie({ authenticated: true, email: 'admin@example.com' });
  assert.equal((await http.call('GET', '/admin', { headers: { cookie } })).status, 200);
  assert.equal((await http.call('GET', '/admin/tokens', { headers: { cookie } })).status, 200);
  assert.equal((await http.call('GET', '/admin/api/tokens', { headers: { cookie } })).status, 200);
  assert.equal((await http.call('GET', '/api/items', { headers: { cookie } })).status, 200);
});

test('the allowlist match is case-insensitive, like the sign-in check', async () => {
  const { cookie } = h.makeSessionCookie({ authenticated: true, email: 'Admin@Example.com' });
  assert.equal((await http.call('GET', '/api/items', { headers: { cookie } })).status, 200);
});

test('a session whose email was removed from ADMIN_EMAILS is refused everywhere and destroyed', async () => {
  const { cookie, sid } = h.makeSessionCookie({ authenticated: true, email: 'former@example.com' });
  await expectLockedOut(cookie);
  assert.equal(sessionExists(sid), false);
});

test('an allowlist change takes effect on a session that was valid a moment ago', async () => {
  const { cookie, sid } = h.makeSessionCookie({ authenticated: true, email: 'admin@example.com' });
  assert.equal((await http.call('GET', '/api/items', { headers: { cookie } })).status, 200);
  const original = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'someone-else@example.com';
  try {
    await expectLockedOut(cookie);
    assert.equal(sessionExists(sid), false);
  } finally {
    process.env.ADMIN_EMAILS = original;
  }
});

test('an authenticated session that carries no email is refused', async () => {
  const { cookie } = h.makeSessionCookie({ authenticated: true });
  await expectLockedOut(cookie);
});

test('the paired display still works for the wall page when an admin session is revoked', async () => {
  const pair = await http.call('GET', `/?key=${h.DISPLAY_KEY}`);
  const displayCookie = pair.headers.get('set-cookie').split(';')[0];
  const { cookie } = h.makeSessionCookie({ authenticated: true, email: 'former@example.com' });
  const res = await http.call('GET', '/api/tasks', { headers: { cookie: `${cookie}; ${displayCookie}` } });
  assert.equal(res.status, 200);
});
