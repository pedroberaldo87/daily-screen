const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

// Environment must be set before the app (and db.js) is required.
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-int-total-count-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.DISPLAY_KEY = 'k'.repeat(48);

const { createApiToken } = require('../db');
const { generateToken } = require('../middleware/token-auth');
const app = require('../server');

let server;
let base;
let headers;

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.before(async () => {
  const { plaintext, hash, prefix } = generateToken();
  createApiToken({ name: 'test', tokenPrefix: prefix, tokenHash: hash, expiresAt: null });
  headers = { authorization: `Bearer ${plaintext}` };
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

const BAD = [
  ['markup', '<img src=x onerror=alert(1)>'],
  ['numeric string', '30'],
  ['empty string', ''],
  ['zero', 0],
  ['fraction', 1.5],
  ['above range', 100001],
  ['object', {}],
];

const item = (total_count) => ({ title: 'Vitamin D', category: 'supplement', total_count });
const protocol = (total_count) => ({
  name: 'Course', start_date: '2026-11-10',
  phases: [{ title: 'Phase 1', category: 'medication', duration_days: 7, total_count }],
});

for (const [label, bad] of BAD) {
  test(`POST /integration/v1/items rejects total_count ${label} with 400`, async () => {
    const r = await call('POST', '/integration/v1/items', item(bad));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /total_count/);
  });

  test(`POST /integration/v1/protocols rejects phase total_count ${label} with 400`, async () => {
    const r = await call('POST', '/integration/v1/protocols', protocol(bad));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /total_count/);
  });
}

test('PUT /integration/v1/items/:id rejects markup total_count with 400 and keeps the stored value', async () => {
  const created = await call('POST', '/integration/v1/items', item(30));
  assert.equal(created.status, 201);
  const id = created.body.id;
  const r = await call('PUT', `/integration/v1/items/${id}`, { total_count: '<script>x</script>' });
  assert.equal(r.status, 400);
  assert.equal((await call('GET', `/integration/v1/items/${id}`)).body.total_count, 30);
});

test('PUT /integration/v1/protocols/:id rejects markup phase total_count with 400', async () => {
  const created = await call('POST', '/integration/v1/protocols', protocol(10));
  assert.equal(created.status, 201);
  const r = await call('PUT', `/integration/v1/protocols/${created.body.id}`, protocol('<b>x</b>'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /total_count/);
});

test('valid total_count (1, 100000) and null are accepted', async () => {
  for (const ok of [1, 100000, null]) {
    const r = await call('POST', '/integration/v1/items', item(ok));
    assert.equal(r.status, 201, `total_count ${ok}`);
    assert.equal(r.body.total_count, ok);
  }
});
