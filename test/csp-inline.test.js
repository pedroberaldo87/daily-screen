const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Environment must be set before the app (and db.js) is required.
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-csp-inline-test-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
const DISPLAY_KEY = 'k'.repeat(48);
process.env.DISPLAY_KEY = DISPLAY_KEY;

const signature = require('cookie-signature');
const { db } = require('../db');
const app = require('../server');

const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const PUBLIC = path.join(ROOT, 'public');

let server;
let base;
let adminCookie;

function makeAdminCookie() {
  const sid = crypto.randomBytes(16).toString('hex');
  const sess = { cookie: { maxAge: 3600000, httpOnly: true, path: '/' }, authenticated: true };
  db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)')
    .run(sid, JSON.stringify(sess), Date.now() + 3600000);
  return `connect.sid=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`;
}

let displayCookie;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = makeAdminCookie();
  // Pair a display exactly as the tablet does: open /?key=...
  const pair = await fetch(`${base}/?key=${DISPLAY_KEY}`, { redirect: 'manual' });
  displayCookie = pair.headers.get('set-cookie').split(';')[0];
});

test.after(() => {
  server.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DATABASE_PATH + suffix); } catch { /* already gone */ }
  }
});

// An HTML attribute named on<something>, preceded by whitespace/quote/slash so
// that "content=" or "version=" never match.
const INLINE_HANDLER = /[\s"'`/]on[a-z]+\s*=/i;
// Same, but only inside a <tag ...> so prose such as "button onclick=" in a
// comment is still caught while "one = 1" in script text is not.
const TAG_WITH_HANDLER = /<[a-z][^>]*[\s"'`/]on[a-z]+\s*=/i;

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs, body]) => !/\bsrc\s*=/.test(attrs) && body.trim() !== '');
}

function viewFiles() {
  return fs.readdirSync(VIEWS).filter((f) => f.endsWith('.html'));
}

test('CSP header has no unsafe-inline in script-src-attr or script-src', async () => {
  const res = await fetch(`${base}/admin/login`);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'CSP header is present');
  const directives = Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    })
  );
  assert.ok(directives['script-src-attr'], 'script-src-attr directive is present');
  assert.ok(!directives['script-src-attr'].includes("'unsafe-inline'"), csp);
  assert.deepEqual(directives['script-src-attr'], ["'none'"]);
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"), csp);
});

test('view templates contain no inline on*= handler attributes', () => {
  const offenders = [];
  for (const file of viewFiles()) {
    const html = fs.readFileSync(path.join(VIEWS, file), 'utf8');
    html.split('\n').forEach((line, i) => {
      if (INLINE_HANDLER.test(line)) offenders.push(`views/${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('view templates contain no inline <script> blocks', () => {
  const offenders = [];
  for (const file of viewFiles()) {
    const html = fs.readFileSync(path.join(VIEWS, file), 'utf8');
    for (const [, , body] of inlineScripts(html)) {
      offenders.push(`views/${file}: ${body.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('front-end scripts do not generate HTML with inline on*= handlers', () => {
  const offenders = [];
  for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (TAG_WITH_HANDLER.test(line) || /\bsetAttribute\(\s*['"]on/i.test(line)) {
        offenders.push(`public/${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('served pages (display, admin, tokens, login) carry no inline handlers or scripts', async () => {
  const pages = [
    ['/admin/login', {}],
    ['/admin', { cookie: adminCookie }],
    ['/admin/tokens', { cookie: adminCookie }],
    ['/', { cookie: displayCookie }],
  ];
  for (const [url, headers] of pages) {
    const res = await fetch(base + url, { headers });
    assert.equal(res.status, 200, url);
    const html = await res.text();
    assert.ok(!INLINE_HANDLER.test(html.replace(/<style[\s\S]*?<\/style>/gi, '')), `${url} has an inline handler`);
    assert.deepEqual(inlineScripts(html).map(([, , b]) => b.trim().slice(0, 60)), [], `${url} has an inline script`);
  }
});

test('display page registers the service worker from an external script', async () => {
  const res = await fetch(`${base}/`, { headers: { cookie: displayCookie } });
  const html = await res.text();
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const swRegistrar = srcs.find((s) => {
    const file = path.join(ROOT, s.replace(/^\//, ''));
    return fs.existsSync(file) && /serviceWorker\.register\(/.test(fs.readFileSync(file, 'utf8'));
  });
  assert.ok(swRegistrar, `no <script src> registers the service worker (found: ${srcs.join(', ')})`);
  const asset = await fetch(base + swRegistrar);
  assert.equal(asset.status, 200);
});
