const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildLegacy } = require('./legacy-fixture');
const { migrate } = require('../model');

function legacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  const ids = buildLegacy(db);
  return { db, ids };
}

const TODAY = '2026-06-08';

test('invariante: nenhum daily_task completado é perdido na migração', () => {
  const { db } = legacyDb();
  const before = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE completed = 1').get().c;
  assert.equal(before, 40); // 3 + 31 + 1 + 3 + 2

  migrate(db, TODAY);

  const after = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE completed = 1').get().c;
  assert.equal(after, before, 'histórico completo preservado');
});

test('Atentah: caixa cheia migra para 1 concluída, SEM caixa nova ativa vazia', () => {
  const { db } = legacyDb();
  migrate(db, TODAY);

  // template count "Atentah 80mg"
  const tmpl = db.prepare("SELECT * FROM templates WHERE name = 'Atentah 80mg' AND kind = 'count'").get();
  assert.ok(tmpl, 'template Atentah deve existir');

  const series = db.prepare('SELECT * FROM series WHERE template_id = ? ORDER BY seq').all(tmpl.id);
  const completed = series.filter((s) => s.status === 'completed');
  const active = series.filter((s) => s.status === 'active');

  assert.equal(completed.length, 1, 'uma caixa concluída');
  assert.equal(completed[0].completed_count, 31);
  const oldDays = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id = ? AND completed = 1').get(completed[0].id).c;
  assert.equal(oldDays, 31, 'os 31 dias ficam na caixa velha');

  // o bug era pré-criar uma caixa nova ativa vazia; a compra deve passar pelo "Comprar"
  assert.equal(active.length, 0, 'nenhuma caixa nova ativa vazia pré-criada');
});

test('item simples vira template(simple) + série perpétua com seu histórico', () => {
  const { db } = legacyDb();
  migrate(db, TODAY);

  const tmpl = db.prepare("SELECT * FROM templates WHERE name = 'Ritalina' AND kind = 'simple'").get();
  assert.ok(tmpl);
  const series = db.prepare('SELECT * FROM series WHERE template_id = ?').all(tmpl.id);
  assert.equal(series.length, 1);
  assert.equal(series[0].status, 'active');
  assert.equal(series[0].end_date, null);
  const days = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id = ?').get(series[0].id).c;
  assert.equal(days, 4, '3 marcados + 1 pendente preservados');
});

test('protocolo vira template(protocol) + séries de fase; fases vencidas concluídas', () => {
  const { db } = legacyDb();
  migrate(db, TODAY);

  const tmpl = db.prepare("SELECT * FROM templates WHERE name = 'Desmame' AND kind = 'protocol'").get();
  assert.ok(tmpl);
  const phases = db.prepare('SELECT * FROM phases WHERE template_id = ?').all(tmpl.id);
  assert.equal(phases.length, 2);
  const series = db.prepare('SELECT * FROM series WHERE template_id = ? ORDER BY sort_order').all(tmpl.id);
  assert.equal(series.length, 2);
  // ambas as fases venceram antes de 2026-06-08 → concluídas
  assert.ok(series.every((s) => s.status === 'completed'), 'fases vencidas concluídas');
  const d1 = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id = ? AND completed = 1').get(series[0].id).c;
  const d2 = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id = ? AND completed = 1').get(series[1].id).c;
  assert.equal(d1 + d2, 5, 'dias das fases preservados nas séries certas');
});

test('migração é idempotente (rodar de novo não duplica)', () => {
  const { db } = legacyDb();
  migrate(db, TODAY);
  const t1 = db.prepare('SELECT COUNT(*) c FROM templates').get().c;
  const s1 = db.prepare('SELECT COUNT(*) c FROM series').get().c;
  migrate(db, TODAY);
  const t2 = db.prepare('SELECT COUNT(*) c FROM templates').get().c;
  const s2 = db.prepare('SELECT COUNT(*) c FROM series').get().c;
  assert.equal(t2, t1);
  assert.equal(s2, s1);
});
