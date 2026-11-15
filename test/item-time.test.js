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
const THREE = '["09:00","15:00","23:00"]';
const day = (m, date) => { m.generateDailyTasks(date); return m.getTasksView(date); };

// ── Validation ──

test('times: normaliza H:MM, ordena, tira repetido e guarda como texto JSON', () => {
  const d = { times: ['23:00', '9:00', '15:00', '09:00'] };
  assert.deepEqual(validateItemData(d, false), []);
  assert.equal(d.times, THREE);
});

test('time (forma antiga, um horário) vira lista de um; null/"" vira lista vazia', () => {
  const a = { time: '8:05' };
  assert.deepEqual(validateItemData(a, false), []);
  assert.equal(a.times, '["08:05"]');
  assert.equal(a.time, undefined);
  for (const v of ['', null]) {
    const d = { time: v };
    assert.deepEqual(validateItemData(d, false), []);
    assert.equal(d.times, '[]');
  }
});

test('horário inválido, lista inválida ou time+times juntos são recusados', () => {
  for (const v of ['24:00', '12:60', '8h', '0800', '12:5', 800, {}, '<b>1</b>']) {
    assert.ok(validateItemData({ times: [v] }, false).some((e) => e.startsWith('time must be')), `aceitou ${JSON.stringify(v)}`);
    assert.ok(validateItemData({ time: v }, false).some((e) => e.startsWith('time must be')), `aceitou time ${JSON.stringify(v)}`);
  }
  assert.ok(validateItemData({ times: 'x' }, false).some((e) => e.startsWith('times must be')));
  assert.ok(validateItemData({ times: Array(13).fill('08:00') }, false).some((e) => e.startsWith('times must be')));
  assert.ok(validateItemData({ time: '08:00', times: ['09:00'] }, false).includes('send time or times, not both'));
});

test('horário inválido numa fase de protocolo é recusado com o índice da fase', () => {
  const errs = validateProtocolData({
    name: 'P', start_date: '2026-11-10',
    phases: [{ title: 'F1', category: 'medication', duration_days: 3, times: ['25:00'] }],
  }, true);
  assert.ok(errs.some((e) => e.startsWith('phases[0]: time must be')), errs.join(' | '));
});

// ── Model: one card per dose ──

test('item com 3 horários gera 3 doses no dia, cada uma com o seu horário', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Adorlan', category: 'medication', times: THREE });
  const view = m.getItemView(id);
  assert.deepEqual(view.times, ['09:00', '15:00', '23:00']);
  assert.equal(view.time, '09:00');
  assert.deepEqual(day(m, '2026-11-15').map((t) => [t.title, t.time]),
    [['Adorlan', '09:00'], ['Adorlan', '15:00'], ['Adorlan', '23:00']]);
});

test('item sem horário segue com uma dose por dia e time null', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Vitamina D', category: 'supplement' });
  assert.deepEqual(m.getItemView(id).times, []);
  const tasks = day(m, '2026-11-15');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].time, null);
});

test('o dia lista as doses com horário primeiro, em ordem de relógio; depois as sem horário', () => {
  const { m } = freshModel();
  m.createItem({ title: 'Sem hora A', category: 'medication', sort_order: 1 });
  m.createItem({ title: 'Adorlan', category: 'medication', times: THREE, sort_order: 9 });
  m.createItem({ title: 'Manhã', category: 'medication', times: '["07:30"]', sort_order: 5 });
  m.createItem({ title: 'Sem hora B', category: 'medication', sort_order: 0 });
  assert.deepEqual(day(m, '2026-11-15').map((t) => `${t.time || '-'} ${t.title}`),
    ['07:30 Manhã', '09:00 Adorlan', '15:00 Adorlan', '23:00 Adorlan', '- Sem hora B', '- Sem hora A']);
});

test('uma caixa só: cada dose marcada conta 1, e o cartão mostra a contagem até a sua dose', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Adorlan', category: 'medication', times: THREE, total_count: 30 });
  const [d9, d15] = day(m, '2026-11-15');
  m.toggleTask(d9.id);
  m.toggleTask(d15.id);
  assert.equal(m.getItemView(id).completed_count, 2);
  assert.deepEqual(m.getTasksView('2026-11-15').map((t) => `${t.time} ${t.completed_count}/${t.total_count}`),
    ['09:00 1/30', '15:00 2/30', '23:00 2/30']);
});

test('caixa acaba no meio do dia: a nova começa no mesmo dia, só com as doses que faltam', () => {
  const { db, m } = freshModel();
  const id = m.createItem({
    title: 'Adorlan', category: 'medication', times: THREE, total_count: 2,
    followup_title: 'Comprar Adorlan', followup_category: 'reminder', followup_recreate: 1,
  });
  const today = '2026-11-15';
  const [d9, d15] = day(m, today);
  m.toggleTask(d9.id, today);
  m.toggleTask(d15.id, today); // 2/2: box closes, 23:00 of the old box goes away
  const fu = day(m, today).find((t) => t.title === 'Comprar Adorlan');
  assert.equal(fu.time, null);
  m.toggleTask(fu.id, today);
  m.recreateFromFollowup(fu.id, today);
  const fresh = db.prepare("SELECT * FROM series WHERE template_id = ? AND status = 'active'").get(id);
  assert.equal(fresh.start_date, today);
  assert.equal(fresh.times, THREE);
  const adorlan = day(m, today).filter((t) => t.title === 'Adorlan');
  assert.deepEqual(adorlan.map((t) => `${t.time} ${t.series_id === fresh.id ? 'nova' : 'velha'} ${t.completed ? 'x' : 'o'}`),
    ['09:00 velha x', '15:00 velha x', '23:00 nova o']);
});

test('tirar horários: pendentes somem de hoje em diante; a dose já tomada ocupa o horário que sobrou', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Adorlan', category: 'medication', times: THREE });
  const [d9] = day(m, '2026-11-15');
  m.toggleTask(d9.id);
  m.updateItem(id, { times: '["15:00"]' }, '2026-11-15');
  // took today's dose at 09:00; the medicine is now once a day → today is done, no second dose
  assert.deepEqual(m.getTasksView('2026-11-15').map((t) => `${t.time} ${t.completed}`), ['15:00 1']);
  assert.deepEqual(day(m, '2026-11-16').map((t) => t.time), ['15:00']);
});

test('protocolo: cada fase guarda a própria lista, e a view devolve lista que pode voltar ao salvar', () => {
  const { m } = freshModel();
  const pid = m.createProtocol({
    name: 'Curso', start_date: '2026-11-15',
    phases: [
      { title: 'F1', category: 'medication', duration_days: 2, times: '["08:00","20:00"]' },
      { title: 'F2', category: 'medication', duration_days: 2 },
    ],
  });
  const view = m.getProtocolView(pid);
  assert.deepEqual(view.phases.map((p) => p.times), [['08:00', '20:00'], []]);
  assert.deepEqual(day(m, '2026-11-15').map((t) => t.time), ['08:00', '20:00']);
});

// ── Lançamentos per dose ──

test('lançamentos: cada dose tem o seu horário; adicionar escolhe a dose que falta; mover troca de horário', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Adorlan', category: 'medication', times: THREE, start_date: '2026-11-15' });
  day(m, '2026-11-15');
  const occ = m.getOccurrences(id);
  assert.deepEqual(occ.map((o) => o.time), ['23:00', '15:00', '09:00']);
  // the 15:00 dose removed: adding without a time brings that one back
  const o15 = occ.find((o) => o.time === '15:00');
  m.removeOccurrence(o15.id, true);
  const back = m.addOccurrence(id, '2026-11-15');
  assert.equal(back.ok, true);
  assert.equal(back.occurrence.time, '15:00');
  assert.equal(m.addOccurrence(id, '2026-11-15', '09:00').code, 'exists');
  // a dose on a day off the rule, then moved to another time of that day
  const extra = m.addOccurrence(id, '2026-11-10', '09:00');
  assert.equal(extra.occurrence.time, '09:00');
  const moved = m.moveOccurrence(extra.occurrence.id, '2026-11-10', '2026-11-15', '23:00');
  assert.equal(moved.time, '23:00');
});

test('histórico e adesão contam por dose', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Adorlan', category: 'medication', times: THREE, start_date: '2026-11-15' });
  const [d9] = day(m, '2026-11-15');
  m.toggleTask(d9.id);
  const rows = m.getHistoryView({ dateFrom: '2026-11-15', dateTo: '2026-11-15', itemId: id });
  assert.deepEqual(rows.map((r) => `${r.time} ${r.completed}`), ['09:00 1', '15:00 0', '23:00 0']);
  const adh = m.getItemAdherence({ itemId: id, dateFrom: '2026-11-15', dateTo: '2026-11-15' });
  assert.equal(adh.expected_count, 3);
  assert.equal(adh.completed_count, 1);
});

// ── Upgrade of an existing database ──

test('banco antigo: a tabela de marcações ganha a dose sem perder linha nem marcação; horário único vira lista', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // A database from before dose times: build it, then strip slot/times off.
  const m0 = createModel(db);
  const id = m0.createItem({ title: 'Losartana', category: 'medication', start_date: '2026-11-14' });
  const legacy = m0.createItem({ title: 'Antigo', category: 'medication', start_date: '2026-11-14' });
  m0.generateDailyTasks('2026-11-14');
  m0.generateDailyTasks('2026-11-15');
  m0.toggleTask(m0.getTasksView('2026-11-14')[0].id);
  db.exec(`
    CREATE TABLE dt_old (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date TEXT NOT NULL, completed INTEGER DEFAULT 0, completed_at TEXT, created_at TEXT, origin TEXT, removed_at TEXT,
      UNIQUE(series_id, date));
    INSERT INTO dt_old SELECT id, series_id, date, completed, completed_at, created_at, origin, removed_at FROM daily_tasks;
    DROP TABLE daily_tasks; ALTER TABLE dt_old RENAME TO daily_tasks;
    UPDATE phases SET times = '[]'; UPDATE series SET times = '[]';
    UPDATE phases SET time = '08:00' WHERE template_id = ${id}; UPDATE series SET time = '08:00' WHERE template_id = ${id};
  `);
  const before = db.prepare('SELECT id, completed FROM daily_tasks ORDER BY id').all();
  const m = createModel(db); // boot
  const after = db.prepare('SELECT id, completed, slot FROM daily_tasks ORDER BY id').all();
  assert.deepEqual(after.map((r) => [r.id, r.completed]), before.map((r) => [r.id, r.completed]));
  assert.deepEqual(m.getItemView(id).times, ['08:00']);
  assert.deepEqual(m.getItemView(legacy).times, []);
  // the single-time item's old rows moved into its 08:00 dose: no duplicate card
  assert.deepEqual(m.getTasksView('2026-11-15').map((t) => `${t.title} ${t.time}`), ['Losartana 08:00', 'Antigo null']);
  // two doses on the same day are now possible
  m.updateItem(id, { times: '["08:00","20:00"]' }, '2026-11-15');
  assert.deepEqual(day(m, '2026-11-15').filter((t) => t.title === 'Losartana').map((t) => t.time), ['08:00', '20:00']);
  createModel(db); // second boot: idempotent
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE completed = 1').get().c, 1);
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

test('Integration API: cria com 3 horários, o dia traz 3 doses, altera e limpa; time segue aceito', async () => {
  const created = await call('POST', '/integration/v1/items', { title: 'Remédio API', category: 'medication', times: ['23:00', '9:00', '15:00'] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.times, ['09:00', '15:00', '23:00']);

  const tasks = await call('GET', '/integration/v1/tasks');
  assert.deepEqual(tasks.body.filter((t) => t.title === 'Remédio API').map((t) => t.time), ['09:00', '15:00', '23:00']);

  const one = await call('PUT', `/integration/v1/items/${created.body.id}`, { time: '20:00' });
  assert.deepEqual(one.body.times, ['20:00']);
  assert.equal(one.body.time, '20:00');

  const cleared = await call('PUT', `/integration/v1/items/${created.body.id}`, { times: [] });
  assert.deepEqual(cleared.body.times, []);
  assert.equal(cleared.body.time, null);
});

test('Integration API: horário inválido volta 400; lançamento aceita o horário da dose', async () => {
  const bad = await call('POST', '/integration/v1/items', { title: 'X', category: 'medication', times: ['25:00'] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /time must be HH:MM/);

  const it = await call('POST', '/integration/v1/items', { title: 'Lanç', category: 'medication', times: ['08:00', '20:00'] });
  const add = await call('POST', `/integration/v1/items/${it.body.id}/occurrences`, { date: '2026-01-05', time: '20:00' });
  assert.equal(add.status, 201);
  assert.equal(add.body.time, '20:00');
  const moved = await call('PUT', `/integration/v1/occurrences/${add.body.id}`, { time: '08:00' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.time, '08:00');
  const badTime = await call('POST', `/integration/v1/items/${it.body.id}/occurrences`, { date: '2026-01-06', time: '8h' });
  assert.equal(badTime.status, 400);
});

// ── Review fixes (2026-11-15) ──

test('dose marcada sem horário + item ganha horários: a marcada vira a primeira dose, sem cartão a mais', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'A', category: 'medication', start_date: '2026-11-15' });
  const [only] = day(m, '2026-11-15');
  m.toggleTask(only.id);
  m.updateItem(id, { times: '["08:00","20:00"]' }, '2026-11-15');
  assert.deepEqual(day(m, '2026-11-15').map((t) => `${t.time} ${t.completed}`), ['08:00 1', '20:00 0']);
  // and back: times removed with the 08:00 dose taken → one untimed dose, taken
  m.updateItem(id, { times: '[]' }, '2026-11-15');
  assert.deepEqual(day(m, '2026-11-15').map((t) => `${t.time} ${t.completed}`), ['null 1']);
});

test('virar protocolo com horários não deixa o cartão sem horário de hoje sobrando', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-15' });
  day(m, '2026-11-15');
  m.convertItemToProtocol(id, { today: '2026-11-15', start_date: '2026-11-15', phases: [
    { title: 'C', category: 'medication', duration_days: 3, times: ['08:00', '20:00'] },
  ] });
  assert.deepEqual(day(m, '2026-11-15').map((t) => t.time), ['08:00', '20:00']);
});

test('conversão do banco no boot: marcação órfã (caixa apagada) não trava o boot e fica de fora', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const m0 = createModel(db);
  m0.createItem({ title: 'X', category: 'medication', start_date: '2026-11-14' });
  m0.generateDailyTasks('2026-11-14');
  m0.toggleTask(m0.getTasksView('2026-11-14')[0].id);
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE dt_old (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date TEXT NOT NULL, completed INTEGER DEFAULT 0, completed_at TEXT, created_at TEXT, origin TEXT, removed_at TEXT,
      UNIQUE(series_id, date));
    INSERT INTO dt_old SELECT id, series_id, date, completed, completed_at, created_at, origin, removed_at FROM daily_tasks;
    INSERT INTO dt_old (series_id, date, completed) VALUES (999, '2026-11-14', 1);
    DROP TABLE daily_tasks; ALTER TABLE dt_old RENAME TO daily_tasks;
  `);
  db.pragma('foreign_keys = ON');
  createModel(db); // boot: must not throw
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_tasks').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE completed = 1').get().c, 1);
});
