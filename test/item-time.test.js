const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

// Environment must be set before the app (and db.js) is required.
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-item-time-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.DISPLAY_KEY = 'k'.repeat(48);

const { createModel } = require('../model');
const { validateItemData, validateProtocolData } = require('../lib/validators');

function freshModel() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return { db, m: createModel(db) };
}

// ── Validation ──

test('time aceita HH:MM e normaliza H:MM para HH:MM', () => {
  const d = { time: '8:05' };
  assert.deepEqual(validateItemData(d, false), []);
  assert.equal(d.time, '08:05');
  const e = { time: '23:59' };
  assert.deepEqual(validateItemData(e, false), []);
  assert.equal(e.time, '23:59');
});

test('time vazio ou null vira null (limpa o horário)', () => {
  for (const v of ['', null]) {
    const d = { time: v };
    assert.deepEqual(validateItemData(d, false), []);
    assert.equal(d.time, null);
  }
});

test('time inválido é recusado', () => {
  for (const v of ['24:00', '12:60', '8h', '0800', '12:5', 800, {}, '<b>1</b>']) {
    const errs = validateItemData({ time: v }, false);
    assert.ok(errs.some((e) => e.startsWith('time must be')), `aceitou ${JSON.stringify(v)}`);
  }
});

test('time inválido numa fase de protocolo é recusado com o índice da fase', () => {
  const errs = validateProtocolData({
    name: 'P', start_date: '2026-11-10',
    phases: [{ title: 'F1', category: 'medication', duration_days: 3, time: '25:00' }],
  }, true);
  assert.ok(errs.some((e) => e.startsWith('phases[0]: time must be')), errs.join(' | '));
});

// ── Model ──

test('createItem grava o horário na fase e na série, e o dia o devolve', () => {
  const { db, m } = freshModel();
  const id = m.createItem({ title: 'Losartana', category: 'medication', time: '08:00' });
  assert.equal(db.prepare('SELECT time FROM phases WHERE template_id = ?').get(id).time, '08:00');
  assert.equal(db.prepare('SELECT time FROM series WHERE template_id = ?').get(id).time, '08:00');
  assert.equal(m.getItemView(id).time, '08:00');
  m.generateDailyTasks('2026-11-15');
  const [task] = m.getTasksView('2026-11-15');
  assert.equal(task.time, '08:00');
});

test('item sem horário devolve time null', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Vitamina D', category: 'supplement' });
  assert.equal(m.getItemView(id).time, null);
  m.generateDailyTasks('2026-11-15');
  assert.equal(m.getTasksView('2026-11-15')[0].time, null);
});

test('updateItem muda e limpa o horário, refletindo na série ativa', () => {
  const { db, m } = freshModel();
  const id = m.createItem({ title: 'Losartana', category: 'medication', time: '08:00' });
  m.updateItem(id, { time: '21:30' }, '2026-11-15');
  assert.equal(m.getItemView(id).time, '21:30');
  assert.equal(db.prepare("SELECT time FROM series WHERE template_id = ? AND status='active'").get(id).time, '21:30');
  // Edit that does not mention time keeps it.
  m.updateItem(id, { title: 'Losartana 50mg' }, '2026-11-15');
  assert.equal(m.getItemView(id).time, '21:30');
  m.updateItem(id, { time: null }, '2026-11-15');
  assert.equal(m.getItemView(id).time, null);
});

test('o dia lista primeiro quem tem horário, em ordem de relógio; depois o resto pela ordem manual', () => {
  const { m } = freshModel();
  m.createItem({ title: 'Sem hora A', category: 'medication', sort_order: 1 });
  m.createItem({ title: 'Noite', category: 'medication', time: '21:00', sort_order: 0 });
  m.createItem({ title: 'Manhã', category: 'medication', time: '07:30', sort_order: 5 });
  m.createItem({ title: 'Sem hora B', category: 'medication', sort_order: 0 });
  m.generateDailyTasks('2026-11-15');
  assert.deepEqual(m.getTasksView('2026-11-15').map((t) => t.title),
    ['Manhã', 'Noite', 'Sem hora B', 'Sem hora A']);
});

test('cartela nova ("comprei") herda o horário; o "Comprar" nasce sem horário', () => {
  const { db, m } = freshModel();
  const id = m.createItem({
    title: 'Caixa', category: 'medication', total_count: 1, time: '09:15',
    followup_title: 'Comprar Caixa', followup_category: 'reminder', followup_recreate: 1,
  });
  m.generateDailyTasks('2026-11-15');
  m.toggleTask(m.getTasksView('2026-11-15')[0].id, '2026-11-15'); // closes the 1-dose box
  m.generateDailyTasks('2026-11-16');
  const fu = m.getTasksView('2026-11-16').find((t) => t.title === 'Comprar Caixa');
  assert.equal(fu.time, null);
  m.toggleTask(fu.id, '2026-11-16');
  m.recreateFromFollowup(fu.id, '2026-11-16');
  const fresh = db.prepare("SELECT * FROM series WHERE template_id = ? AND status = 'active'").get(id);
  assert.equal(fresh.seq, 2);
  assert.equal(fresh.time, '09:15');
});

test('protocolo: cada fase guarda o próprio horário', () => {
  const { m } = freshModel();
  const pid = m.createProtocol({
    name: 'Curso', start_date: '2026-11-15',
    phases: [
      { title: 'F1', category: 'medication', duration_days: 2, time: '08:00' },
      { title: 'F2', category: 'medication', duration_days: 2 },
    ],
  });
  const view = m.getProtocolView(pid);
  assert.deepEqual(view.phases.map((p) => p.time), ['08:00', null]);
  m.generateDailyTasks('2026-11-15');
  assert.equal(m.getTasksView('2026-11-15')[0].time, '08:00');
});

// ── Integration API (/integration/v1) ──

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

test('Integration API: cria com horário, lê no item e na tarefa do dia, altera e limpa', async () => {
  const created = await call('POST', '/integration/v1/items', { title: 'Remédio API', category: 'medication', time: '7:45' });
  assert.equal(created.status, 201);
  assert.equal(created.body.time, '07:45');

  const tasks = await call('GET', '/integration/v1/tasks');
  assert.equal(tasks.status, 200);
  const mine = tasks.body.find((t) => t.title === 'Remédio API');
  assert.equal(mine.time, '07:45');

  const changed = await call('PUT', `/integration/v1/items/${created.body.id}`, { time: '20:00' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.time, '20:00');

  const cleared = await call('PUT', `/integration/v1/items/${created.body.id}`, { time: null });
  assert.equal(cleared.body.time, null);
});

test('Integration API: horário inválido volta 400 com a mensagem', async () => {
  const res = await call('POST', '/integration/v1/items', { title: 'X', category: 'medication', time: '25:00' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /time must be HH:MM/);
});
