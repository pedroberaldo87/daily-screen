const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel } = require('../model');

function freshModel() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return { db, m: createModel(db) };
}

// ── Item simples (sem contagem): 1 template + 1 phase + 1 série perpétua ──

test('createItem simples cria template(simple) + phase + 1 série perpétua ativa', () => {
  const { db, m } = freshModel();
  const id = m.createItem({ title: 'Ritalina', category: 'medication', icon: '💊' });

  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  assert.equal(tmpl.kind, 'simple');

  const phases = db.prepare('SELECT * FROM phases WHERE template_id = ?').all(id);
  assert.equal(phases.length, 1);

  const series = db.prepare('SELECT * FROM series WHERE template_id = ?').all(id);
  assert.equal(series.length, 1);
  assert.equal(series[0].status, 'active');
  assert.equal(series[0].title, 'Ritalina');
  assert.equal(series[0].total_count, null);
  assert.equal(series[0].end_date, null); // perpétua
});

test('item simples gera daily_task no dia e nunca conclui', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Ritalina', category: 'medication' });

  m.generateDailyTasks('2026-06-08');
  const tasks = db.prepare("SELECT * FROM daily_tasks WHERE date = '2026-06-08'").all();
  assert.equal(tasks.length, 1);

  m.toggleTask(tasks[0].id);
  const series = db.prepare('SELECT * FROM series').get();
  assert.equal(series.status, 'active'); // simples nunca conclui
});

// ── Item contável (caixa): conclui ao atingir o total, spawn follow-up ──

test('createItem com total_count cria template(count) + série corrente', () => {
  const { db, m } = freshModel();
  const id = m.createItem({
    title: 'Atentah', category: 'medication', total_count: 3,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
  });
  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  assert.equal(tmpl.kind, 'count');

  const series = db.prepare('SELECT * FROM series WHERE template_id = ?').all(id);
  assert.equal(series.length, 1);
  assert.equal(series[0].seq, 1);
  assert.equal(series[0].total_count, 3);
  assert.equal(series[0].status, 'active');
});

test('caixa conclui a série ao atingir o total e gera follow-up', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 3,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
  });

  // marcar 3 dias
  for (const date of ['2026-06-06', '2026-06-07', '2026-06-08']) {
    m.generateDailyTasks(date);
    const t = db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date);
    m.toggleTask(t.id);
  }

  const serie = db.prepare("SELECT * FROM series WHERE total_count = 3").get();
  assert.equal(serie.completed_count, 3);
  assert.equal(serie.status, 'completed');
  assert.ok(serie.completed_at, 'completed_at deve estar setado');

  // follow-up "Comprar Atentah" deve existir como item/série ativa
  const fu = db.prepare("SELECT * FROM series WHERE title = 'Comprar Atentah' AND status='active'").get();
  assert.ok(fu, 'follow-up de compra deve existir e estar ativo');
});

test('desmarcar uma dose abaixo do total reabre a série (reconcile reversível)', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 3,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
  });
  const dates = ['2026-06-06', '2026-06-07', '2026-06-08'];
  const ids = [];
  for (const date of dates) {
    m.generateDailyTasks(date);
    ids.push(db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date).id);
  }
  for (const id of ids) m.toggleTask(id);

  // série concluída + follow-up criado; agora desmarca a última dose
  m.toggleTask(ids[2]);

  const serie = db.prepare('SELECT * FROM series WHERE total_count = 3').get();
  assert.equal(serie.status, 'active', 'série deve reabrir');
  assert.equal(serie.completed_count, 2);
  const fu = db.prepare("SELECT * FROM series WHERE title = 'Comprar Atentah' AND status='active'").get();
  assert.equal(fu, undefined, 'follow-up pendente deve ser desfeito');
});

// ── Recreate ("comprei"): nova série distinta, velha fica concluída ──

test('recreate cria NOVA série seq+1 zerada; a velha continua concluída com histórico', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 3,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
    followup_recreate: 1,
  });
  const dates = ['2026-06-06', '2026-06-07', '2026-06-08'];
  for (const date of dates) {
    m.generateDailyTasks(date);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date).id);
  }

  // completar o follow-up de compra e dizer "sim, comprei"
  m.generateDailyTasks('2026-06-09');
  const fuTask = db.prepare(`
    SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id = dt.series_id
    WHERE s.title = 'Comprar Atentah' AND dt.date = '2026-06-09'
  `).get();
  m.toggleTask(fuTask.id);
  const res = m.recreateFromFollowup(fuTask.id, '2026-06-09');
  assert.equal(res.ok, true);

  const old = db.prepare("SELECT * FROM series WHERE total_count = 3 AND seq = 1").get();
  assert.equal(old.status, 'completed');
  assert.equal(old.completed_count, 3, 'caixa velha mantém suas 3 doses');

  const fresh = db.prepare("SELECT * FROM series WHERE total_count = 3 AND seq = 2").get();
  assert.ok(fresh, 'caixa nova (seq=2) deve existir');
  assert.equal(fresh.status, 'active');
  assert.equal(fresh.completed_count, 0, 'caixa nova começa zerada');
  assert.notEqual(old.id, fresh.id, 'são entidades distintas (ids diferentes)');
});

test('setTaskCompleted é idempotente e não alterna indevidamente o estado', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Ritalina', category: 'medication', icon: '💊' });

  m.generateDailyTasks('2026-06-08');
  const taskId = db.prepare("SELECT id FROM daily_tasks WHERE date = '2026-06-08'").get().id;

  const first = m.setTaskCompleted(taskId, true);
  assert.equal(first.completed, 1);

  const second = m.setTaskCompleted(taskId, true);
  assert.equal(second.completed, 1, 'segunda chamada com mesmo estado mantém completed=1');

  const third = m.setTaskCompleted(taskId, false);
  assert.equal(third.completed, 0);
});

test('getItemView retorna item standalone por id', () => {
  const { m } = freshModel();
  const id = m.createItem({ title: 'Vitamina D', category: 'supplement', icon: '☀️' });
  const item = m.getItemView(id);
  assert.equal(item.id, id);
  assert.equal(item.title, 'Vitamina D');
  assert.equal(m.getItemView(999999), null);
});

test('getHistoryView materializa faixa e expõe histórico filtrável', () => {
  const { db, m } = freshModel();
  const itemId = m.createItem({ title: 'Ritalina', category: 'medication', periods: ['morning'] });
  const protocolId = m.createProtocol({
    name: 'Desmame',
    start_date: '2026-06-01',
    repeat_indefinitely: 0,
    phases: [
      { title: '10mg', category: 'medication', icon: '💊', duration_days: 2 },
      { title: '5mg', category: 'medication', icon: '💊', duration_days: 2 },
    ],
  });

  m.generateDailyTasks('2026-06-01');
  const standaloneTask = db.prepare("SELECT id FROM daily_tasks WHERE date = '2026-06-01' ORDER BY id LIMIT 1").get().id;
  m.toggleTask(standaloneTask);

  const history = m.getHistoryView({ dateFrom: '2026-06-01', dateTo: '2026-06-03' });
  assert.ok(history.length >= 4, 'deve materializar tarefas do item e do protocolo na faixa');
  assert.ok(history.some((row) => row.item_id === itemId));
  assert.ok(history.some((row) => row.protocol_id === protocolId));

  const onlyItem = m.getHistoryView({ dateFrom: '2026-06-01', dateTo: '2026-06-03', itemId });
  assert.ok(onlyItem.every((row) => row.item_id === itemId));
});

test('getItemAdherence calcula concluídas, faltas e streaks por item', () => {
  const { db, m } = freshModel();
  const itemId = m.createItem({ title: 'Atentah', category: 'medication' });

  for (const date of ['2026-06-01', '2026-06-02', '2026-06-03']) m.generateDailyTasks(date);
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date = '2026-06-01'").get().id);
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date = '2026-06-03'").get().id);

  const stats = m.getItemAdherence({ itemId, dateFrom: '2026-06-01', dateTo: '2026-06-03' });
  assert.equal(stats.expected_count, 3);
  assert.equal(stats.completed_count, 2);
  assert.equal(stats.missed_count, 1);
  assert.deepEqual(stats.missed_dates, ['2026-06-02']);
  assert.equal(stats.streak_completed, 1);
  assert.equal(stats.streak_missed, 0);
  assert.equal(stats.completion_rate, 0.667);
});

test('getAdherenceSummary agrega por categoria e devolve quebra por entidade', () => {
  const { db, m } = freshModel();
  const itemId = m.createItem({ title: 'Atentah', category: 'medication' });
  m.createItem({ title: 'Creatina', category: 'supplement' });

  for (const date of ['2026-06-01', '2026-06-02']) m.generateDailyTasks(date);
  m.toggleTask(db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id = dt.series_id WHERE s.title = 'Atentah' AND dt.date = '2026-06-01'").get().id);

  const summary = m.getAdherenceSummary({ dateFrom: '2026-06-01', dateTo: '2026-06-02', category: 'medication' });
  assert.equal(summary.category, 'medication');
  assert.equal(summary.expected_count, 2);
  assert.equal(summary.completed_count, 1);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].entity_type, 'item');
  assert.equal(summary.items[0].entity_id, itemId);
});
