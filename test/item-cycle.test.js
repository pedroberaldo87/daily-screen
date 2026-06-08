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
