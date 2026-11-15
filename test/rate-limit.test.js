const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-rate-limit-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.DISPLAY_KEY = 'k'.repeat(48);

const app = require('../server');
let server; let base; let cookie;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const pair = await fetch(`${base}/?key=${'k'.repeat(48)}`, { redirect: 'manual' });
  cookie = pair.headers.get('set-cookie').split(';')[0];
});
test.after(() => { server.closeAllConnections(); server.close(); });

test('tablet pareado: 100 pedidos bons seguidos à API e à tela nunca levam 429', async () => {
  for (let i = 0; i < 100; i++) {
    const api = await fetch(`${base}/api/settings`, { headers: { cookie } });
    assert.equal(api.status, 200, `pedido ${i + 1} à /api deu ${api.status}`);
  }
  for (let i = 0; i < 30; i++) {
    const page = await fetch(`${base}/`, { headers: { cookie } });
    assert.equal(page.status, 200, `abertura ${i + 1} da tela deu ${page.status}`);
  }
});

test('sem credencial, a API ainda trava depois de 60 falhas', async () => {
  let last;
  for (let i = 0; i < 61; i++) last = await fetch(`${base}/api/settings`);
  assert.equal(last.status, 429);
});
