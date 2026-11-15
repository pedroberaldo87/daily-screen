const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-bar-position-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.DISPLAY_KEY = 'k'.repeat(48);

const { validateSettings } = require('../lib/validators');
const { createApiToken } = require('../db');
const { generateToken } = require('../middleware/token-auth');
const app = require('../server');

test('bar_position aceita top e bottom e recusa o resto', () => {
  assert.deepEqual(validateSettings({ bar_position: 'top' }), []);
  assert.deepEqual(validateSettings({ bar_position: 'bottom' }), []);
  for (const v of ['left', '', 'TOP', '<b>']) {
    assert.ok(validateSettings({ bar_position: v }).some((e) => e.startsWith('bar_position must be one of')), `aceitou ${v}`);
  }
});

test('tela do tablet: a barra é horizontal e leva o progresso dentro, sem a coluna lateral', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'display.html'), 'utf8');
  assert.ok(!html.includes('info-strip'), 'a coluna lateral antiga ainda está na página');
  const bar = html.slice(html.indexOf('<header class="info-bar"'), html.indexOf('</header>'));
  for (const id of ['clock', 'weather', 'progress-dock', 'period-nav', 'date-nav']) {
    assert.ok(bar.includes(`id="${id}"`), `${id} fora da barra`);
  }
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.js'), 'utf8');
  assert.match(js, /classList\.toggle\('bar-bottom', settings\.bar_position === 'bottom'\)/);
});

let server;
let base;
let headers;
test.before(async () => {
  const { plaintext, hash, prefix } = generateToken();
  createApiToken({ name: 'test', tokenPrefix: prefix, tokenHash: hash, expiresAt: null });
  headers = { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' };
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections(); server.close(); });

test('Integration API grava e devolve bar_position; valor inválido é 400', async () => {
  const put = await fetch(`${base}/integration/v1/settings`, { method: 'PUT', headers, body: JSON.stringify({ bar_position: 'bottom' }) });
  assert.equal(put.status, 200);
  const got = await (await fetch(`${base}/integration/v1/settings`, { headers })).json();
  assert.equal(got.bar_position, 'bottom');
  const bad = await fetch(`${base}/integration/v1/settings`, { method: 'PUT', headers, body: JSON.stringify({ bar_position: 'left' }) });
  assert.equal(bad.status, 400);
});
