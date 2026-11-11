const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Environment must be set before the app (and db.js) is required.
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-api-auth-test-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
const DISPLAY_KEY = 'k'.repeat(48);
process.env.DISPLAY_KEY = DISPLAY_KEY;

const signature = require('cookie-signature');
const { db, createApiToken, setSetting } = require('../db');
const { generateToken } = require('../middleware/token-auth');
const app = require('../server');

let server;
let base;
let bearer;
let adminCookie;
let displayCookie;
let taskId;

function makeToken() {
  const { plaintext, hash, prefix } = generateToken();
  createApiToken({ name: 'test', tokenPrefix: prefix, tokenHash: hash, expiresAt: null });
  return plaintext;
}

// Builds a valid signed session cookie by writing the session row the way the store does.
function makeAdminCookie() {
  const sid = crypto.randomBytes(16).toString('hex');
  const sess = { cookie: { maxAge: 3600000, httpOnly: true, path: '/' }, authenticated: true, email: 'admin@example.com' };
  db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)')
    .run(sid, JSON.stringify(sess), Date.now() + 3600000);
  return `connect.sid=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`;
}

function call(method, url, { headers = {}, body } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  return fetch(base + url, init);
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  bearer = { authorization: `Bearer ${makeToken()}` };
  adminCookie = makeAdminCookie();
  setSetting('weather_lat', '-23.5505199');
  setSetting('weather_lon', '-46.6333094');
  setSetting('language', 'en');

  // Pair a display exactly as the tablet does: open /?key=...
  const pair = await call('GET', `/?key=${DISPLAY_KEY}`);
  displayCookie = pair.headers.get('set-cookie').split(';')[0];

  // Real task id to toggle/delete (admin creates an item, then reads today's tasks).
  await call('POST', '/api/items', { headers: { cookie: adminCookie }, body: { title: 'Vitamin D', category: 'supplement', period: 'morning' } });
  const tasks = await (await call('GET', '/api/tasks', { headers: bearer })).json();
  taskId = tasks[0].id;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

// ── No credentials: every previously-open endpoint answers 401 ──

const OPEN_BEFORE = [
  ['GET', '/api/items'],
  ['GET', '/api/tasks'],
  ['GET', '/api/tasks?date=2026-01-01'],
  ['GET', '/api/settings'],
  ['GET', '/api/completed'],
  ['GET', '/api/weather'],
  ['GET', '/api/geocoding?q=sao'],
  ['POST', '/api/tasks/1/toggle'],
  ['POST', '/api/tasks/1/recreate'],
  ['DELETE', '/api/tasks/1'],
];

for (const [method, url] of OPEN_BEFORE) {
  test(`no credentials: ${method} ${url} -> 401`, async () => {
    const res = await call(method, url);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Authentication required' });
  });
}

test('unknown /api path without credentials is also 401 (no route probing)', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 401);
});

test('invalid Bearer token -> 401', async () => {
  const res = await call('GET', '/api/tasks', { headers: { authorization: 'Bearer dsk_live_wrong' } });
  assert.equal(res.status, 401);
});

test('a wrong display cookie -> 401', async () => {
  const res = await call('GET', '/api/tasks', { headers: { cookie: 'ds_display=deadbeef' } });
  assert.equal(res.status, 401);
});

// ── Bearer integration token ──

test('Bearer token: GET /api/tasks?date= and /api/items work', async () => {
  const tasks = await call('GET', '/api/tasks?date=2026-11-10', { headers: bearer });
  assert.equal(tasks.status, 200);
  assert.ok(Array.isArray(await tasks.json()));
  const items = await call('GET', '/api/items', { headers: bearer });
  assert.equal(items.status, 200);
  assert.ok(Array.isArray(await items.json()));
});

test('Bearer token: completed, settings and toggle work', async () => {
  assert.equal((await call('GET', '/api/completed', { headers: bearer })).status, 200);
  assert.equal((await call('GET', '/api/settings', { headers: bearer })).status, 200);
  assert.equal((await call('POST', `/api/tasks/${taskId}/toggle`, { headers: bearer })).status, 200);
});

test('Bearer token: still works on /integration/v1 (unchanged)', async () => {
  const res = await call('GET', '/integration/v1/health', { headers: bearer });
  assert.equal(res.status, 200);
  assert.equal((await call('GET', '/integration/v1/health')).status, 401);
});

test('revoked Bearer token -> 401', async () => {
  const plaintext = makeToken();
  db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE token_hash = ?")
    .run(crypto.createHash('sha256').update(plaintext).digest('hex'));
  const res = await call('GET', '/api/tasks', { headers: { authorization: `Bearer ${plaintext}` } });
  assert.equal(res.status, 401);
});

// ── Admin session ──

test('admin session: reads, and management routes work', async () => {
  const h = { cookie: adminCookie };
  assert.equal((await call('GET', '/api/items', { headers: h })).status, 200);
  assert.equal((await call('GET', '/api/protocols', { headers: h })).status, 200);
});

test('admin session gets latitude/longitude in /api/settings', async () => {
  const s = await (await call('GET', '/api/settings', { headers: { cookie: adminCookie } })).json();
  assert.equal(s.weather_lat, '-23.5505199');
  assert.equal(s.weather_lon, '-46.6333094');
});

// ── Settings hide the location from everyone but the admin ──

test('settings hide lat/lon from Bearer and display callers, keep the rest', async () => {
  for (const headers of [bearer, { cookie: displayCookie }]) {
    const res = await call('GET', '/api/settings', { headers });
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.ok(!('weather_lat' in s));
    assert.ok(!('weather_lon' in s));
    assert.equal(s.language, 'en');
  }
});

test('PUT /api/settings response also hides lat/lon from a Bearer caller', async () => {
  const res = await call('PUT', '/api/settings', { headers: bearer, body: { language: 'en' } });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.ok(!('weather_lat' in s) && !('weather_lon' in s));
});

// ── Display credential ──

test('display page without pairing shows the "not paired" message (401, no data)', async () => {
  const res = await call('GET', '/', { headers: { 'accept-language': 'en-US' } });
  assert.equal(res.status, 401);
  const html = await res.text();
  assert.match(html, /This display is not paired/);
  assert.ok(!html.includes('/public/display.js'));
});

test('"not paired" message follows Accept-Language (pt-BR, es)', async () => {
  const pt = await (await call('GET', '/', { headers: { 'accept-language': 'pt-BR' } })).text();
  assert.match(pt, /Este painel não está pareado/);
  const es = await (await call('GET', '/', { headers: { 'accept-language': 'es-MX' } })).text();
  assert.match(es, /Esta pantalla no está emparejada/);
});

test('pairing: valid key sets a hardened cookie and redirects to the clean URL', async () => {
  const res = await call('GET', `/?key=${DISPLAY_KEY}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^ds_display=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Max-Age=34560000/); // 400 days
  assert.ok(!cookie.includes(DISPLAY_KEY), 'cookie must not contain the raw key');
});

test('pairing: cookie is Secure behind an HTTPS proxy', async () => {
  const saved = app.get('trust proxy');
  app.set('trust proxy', 1);
  try {
    const res = await call('GET', `/?key=${DISPLAY_KEY}`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(res.headers.get('set-cookie'), /; Secure/i);
  } finally {
    app.set('trust proxy', saved);
  }
});

test('pairing: wrong key does not set a cookie and shows "not paired"', async () => {
  for (const key of ['wrong', DISPLAY_KEY.slice(1), '']) {
    const res = await call('GET', `/?key=${encodeURIComponent(key)}`);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  }
  const arr = await call('GET', `/?key=${DISPLAY_KEY}&key=x`);
  assert.equal(arr.status, 401);
});

test('paired display: the page loads', async () => {
  const res = await call('GET', '/', { headers: { cookie: displayCookie } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /display\.js/);
});

test('paired display: reads tasks, settings, completed, weather', async () => {
  const h = { cookie: displayCookie };
  assert.equal((await call('GET', '/api/tasks?date=2026-11-10', { headers: h })).status, 200);
  assert.equal((await call('GET', '/api/settings', { headers: h })).status, 200);
  assert.equal((await call('GET', '/api/completed', { headers: h })).status, 200);
  const weather = await call('GET', '/api/weather', { headers: h });
  assert.ok([200, 503].includes(weather.status), `weather answered ${weather.status}`); // 503 = upstream unreachable
});

test('paired display: can toggle a task', async () => {
  const res = await call('POST', `/api/tasks/${taskId}/toggle`, { headers: { cookie: displayCookie } });
  assert.equal(res.status, 200);
});

test('paired display: cannot DELETE a task, and the task survives', async () => {
  const res = await call('DELETE', `/api/tasks/${taskId}`, { headers: { cookie: displayCookie } });
  assert.equal(res.status, 403);
  const tasks = await (await call('GET', '/api/tasks', { headers: bearer })).json();
  assert.ok(tasks.some((t) => t.id === taskId));
});

test('paired display: no access to management or other routes (403)', async () => {
  const h = { cookie: displayCookie };
  const attempts = [
    ['GET', '/api/items'],
    ['POST', '/api/items'],
    ['DELETE', '/api/items/1'],
    ['DELETE', '/api/items/1/permanent'],
    ['GET', '/api/protocols'],
    ['DELETE', '/api/protocols/1'],
    ['PUT', '/api/settings'],
    ['GET', '/api/geocoding?q=sao'],
    ['GET', '/api/items/1/occurrences'],
  ];
  for (const [method, url] of attempts) {
    const res = await call(method, url, { headers: h, body: method === 'GET' || method === 'DELETE' ? undefined : {} });
    assert.equal(res.status, 403, `${method} ${url}`);
  }
});

test('display cookie does not open /integration/v1 or the admin API', async () => {
  const h = { cookie: displayCookie };
  assert.equal((await call('GET', '/integration/v1/tasks', { headers: h })).status, 401);
  assert.equal((await call('GET', '/admin/api/tokens', { headers: h })).status, 401);
});

test('display cookie stops working when DISPLAY_KEY changes (rotation)', async () => {
  process.env.DISPLAY_KEY = 'z'.repeat(48);
  try {
    assert.equal((await call('GET', '/api/tasks', { headers: { cookie: displayCookie } })).status, 401);
  } finally {
    process.env.DISPLAY_KEY = DISPLAY_KEY;
  }
});

test('without DISPLAY_KEY configured, pairing is disabled (fails closed)', async () => {
  delete process.env.DISPLAY_KEY;
  try {
    assert.equal((await call('GET', `/?key=${DISPLAY_KEY}`)).status, 401);
    assert.equal((await call('GET', '/api/tasks', { headers: { cookie: displayCookie } })).status, 401);
  } finally {
    process.env.DISPLAY_KEY = DISPLAY_KEY;
  }
});

test('a DISPLAY_KEY that is too short is rejected (fails closed)', async () => {
  process.env.DISPLAY_KEY = 'short';
  try {
    assert.equal((await call('GET', '/?key=short')).status, 401);
  } finally {
    process.env.DISPLAY_KEY = DISPLAY_KEY;
  }
});

test('admin session can open the display page without pairing', async () => {
  const res = await call('GET', '/', { headers: { cookie: adminCookie } });
  assert.equal(res.status, 200);
});
