// Review round 1 for the input / session hardening change.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bootApp } = require('./helpers/app-harness');
const { loadScripts } = require('./helpers/browser-sandbox');

const h = bootApp('review-round1');
const { validateSettings } = require('../lib/validators');

const DAY = 24 * 60 * 60 * 1000;
let http;
let bearer;
test.before(async () => { http = await h.listen(); bearer = h.makeBearer(); });
test.after(() => http.close());

const rowOf = (sid) => h.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);

// ── #1: the sign-in start URL must not shorten a logged-in admin's session ────

test('GET /admin/auth/google with a logged-in admin cookie leaves the session untouched', async () => {
  const { cookie, sid } = h.makeSessionCookie({ authenticated: true, email: 'admin@example.com' }, 30 * DAY);
  const before = rowOf(sid);
  const res = await http.call('GET', '/admin/auth/google', { headers: { cookie } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin');
  const after = rowOf(sid);
  assert.ok(after, 'the admin session must still exist');
  assert.ok(after.expired - Date.now() > 29 * DAY, `lifetime now ${(after.expired - Date.now()) / 1000}s`);
  assert.equal(JSON.parse(after.sess).oauth, undefined, 'no oauth attempt stored on an admin session');
  assert.equal(JSON.parse(after.sess).authenticated, true);
  assert.equal(after.expired, before.expired);
  assert.equal(res.headers.get('set-cookie'), null, 'the admin cookie must not be re-issued with a short life');
});

test('GET /admin/auth/google with a revoked admin session redirects to the login page, not a 500', async () => {
  const { cookie } = h.makeSessionCookie({ authenticated: true, email: 'former@example.com' }, 30 * DAY);
  const res = await http.call('GET', '/admin/auth/google', { headers: { cookie } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('an anonymous sign-in start still gets the short-lived attempt session', async () => {
  const res = await http.call('GET', '/admin/auth/google');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
  const expires = /Expires=([^;]+)/i.exec(res.headers.get('set-cookie') || '');
  assert.ok(expires, res.headers.get('set-cookie'));
  assert.ok(Date.parse(expires[1]) - Date.now() <= 11 * 60 * 1000, expires[1]);
});

// ── #3, #4: the timezone shape check and the raw weather_tz reads ─────────────

test('weather_tz: real IANA zones with digits, plus and hyphen are accepted', () => {
  for (const tz of ['America/Port-au-Prince', 'America/Blanc-Sablon', 'Asia/Ust-Nera', 'Etc/GMT+3', 'Etc/GMT-14', 'UTC']) {
    assert.deepEqual(validateSettings({ weather_tz: tz }), [], tz);
  }
});

test('weather_tz: junk is still refused', () => {
  for (const tz of ['Foo/Bar', '../etc/passwd', 'America/Sao_Paulo;x', 'a'.repeat(100), 'America/Sao Paulo', '', '<b>']) {
    const errors = validateSettings({ weather_tz: tz });
    assert.ok(errors.some((e) => e.includes('weather_tz')), `accepted ${JSON.stringify(tz)}`);
  }
});

test('an invalid stored weather_tz never reaches Open-Meteo or /health', async () => {
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, init);
    seen.push(u);
    return Promise.resolve({ ok: false, status: 500 }); // not cached by weather.js
  };
  h.setSetting('weather_tz', 'Foo/Bar');
  try {
    await http.call('GET', '/integration/v1/weather', { headers: bearer });
    const health = await (await http.call('GET', '/integration/v1/health', { headers: bearer })).json();
    const { cookie } = h.makeSessionCookie({ authenticated: true, email: 'admin@example.com' });
    await http.call('GET', '/api/weather', { headers: { cookie } });
    assert.equal(seen.length, 2, seen.join('\n'));
    for (const u of seen) {
      assert.ok(u.includes('timezone=America%2FSao_Paulo'), u);
      assert.ok(!u.includes('Foo'), u);
    }
    assert.equal(health.tz, 'America/Sao_Paulo');
  } finally {
    global.fetch = realFetch;
    h.setSetting('weather_tz', 'America/Sao_Paulo');
  }
});

// ── #2: display day arrows stay inside the server's +/-31 day window ──────────

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('display: day arrows stop at +/-31 days instead of walking into a 400', () => {
  const { sandbox } = loadScripts(['utils.js', 'display.js'], { getDateFormat: () => 'dmy' });
  const get = () => vm.runInContext('currentDate', sandbox);
  const shifted = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
  for (let i = 0; i < 40; i++) sandbox.navigateDate(1);
  assert.equal(get(), shifted(31));
  sandbox.goToday();
  for (let i = 0; i < 40; i++) sandbox.navigateDate(-1);
  assert.equal(get(), shifted(-31));
  sandbox.navigateDate(1);
  assert.equal(get(), shifted(-30));
});

test('display: day arrows still step one day at a time inside the window', () => {
  const { sandbox } = loadScripts(['utils.js', 'display.js'], { getDateFormat: () => 'dmy' });
  const today = sandbox.todayStr();
  sandbox.navigateDate(1);
  assert.notEqual(vm.runInContext('currentDate', sandbox), today);
  sandbox.navigateDate(-1);
  assert.equal(vm.runInContext('currentDate', sandbox), today);
});
