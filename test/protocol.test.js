const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel } = require('../model');

function freshModel() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return { db, m: createModel(db) };
}

const PHASES = [
  { title: '25mg', category: 'medication', icon: '💊', duration_days: 7 },
  { title: '20mg', category: 'medication', icon: '💊', duration_days: 7 },
  { title: '15mg', category: 'medication', icon: '💊', duration_days: 7 },
];

test('createProtocol cria template(protocol) + N phases + N séries datadas em sequência', () => {
  const { db, m } = freshModel();
  const id = m.createProtocol({ name: 'Desmame', start_date: '2026-06-01', repeat_indefinitely: 0, phases: PHASES });

  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  assert.equal(tmpl.kind, 'protocol');

  const phases = db.prepare('SELECT * FROM phases WHERE template_id = ? ORDER BY phase_order').all(id);
  assert.equal(phases.length, 3);

  const series = db.prepare('SELECT * FROM series WHERE template_id = ? ORDER BY sort_order').all(id);
  assert.equal(series.length, 3);
  // janelas sequenciais de 7 dias
  assert.equal(series[0].start_date, '2026-06-01');
  assert.equal(series[0].end_date, '2026-06-07');
  assert.equal(series[1].start_date, '2026-06-08');
  assert.equal(series[1].end_date, '2026-06-14');
  assert.equal(series[2].start_date, '2026-06-15');
  assert.equal(series[2].end_date, '2026-06-21');
  assert.equal(series[0].title, '25mg');
});

test('repeat_indefinitely deixa a última fase com end_date aberto (null)', () => {
  const { db, m } = freshModel();
  const id = m.createProtocol({ name: 'Manutenção', start_date: '2026-06-01', repeat_indefinitely: 1, phases: PHASES });
  const series = db.prepare('SELECT * FROM series WHERE template_id = ? ORDER BY sort_order').all(id);
  assert.equal(series[2].end_date, null);
});

test('só a fase vigente gera daily_task na data', () => {
  const { db, m } = freshModel();
  m.createProtocol({ name: 'Desmame', start_date: '2026-06-01', repeat_indefinitely: 0, phases: PHASES });

  m.generateDailyTasks('2026-06-10'); // dentro da fase 2 (08–14)
  const tasks = db.prepare(`
    SELECT s.title FROM daily_tasks dt JOIN series s ON s.id = dt.series_id WHERE dt.date = '2026-06-10'
  `).all();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, '20mg');
});

test('concludeElapsedPhases marca fases vencidas como completed', () => {
  const { db, m } = freshModel();
  const id = m.createProtocol({ name: 'Desmame', start_date: '2026-06-01', repeat_indefinitely: 0, phases: PHASES });

  m.concludeElapsedPhases('2026-06-10'); // fase 1 (até 07) já venceu
  const series = db.prepare('SELECT status FROM series WHERE template_id = ? ORDER BY sort_order').all(id);
  assert.equal(series[0].status, 'completed');
  assert.equal(series[1].status, 'active');
  assert.equal(series[2].status, 'active');
});

test('protocolo finito concluído spawna follow-up uma vez', () => {
  const { db, m } = freshModel();
  const id = m.createProtocol({
    name: 'Desmame', start_date: '2026-06-01', repeat_indefinitely: 0, phases: PHASES,
    followup_title: 'Refazer exame', followup_category: 'reminder', followup_icon: '📋',
  });

  m.concludeElapsedPhases('2026-06-25'); // todas as fases venceram (última até 21)
  const all = db.prepare('SELECT status FROM series WHERE template_id = ?').all(id);
  assert.ok(all.every((s) => s.status === 'completed'), 'todas as fases concluídas');

  const fu = db.prepare("SELECT * FROM series WHERE title = 'Refazer exame' AND status='active'").all();
  assert.equal(fu.length, 1, 'follow-up criado exatamente uma vez');

  // idempotente: rodar de novo não duplica
  m.concludeElapsedPhases('2026-06-26');
  const fu2 = db.prepare("SELECT * FROM series WHERE title = 'Refazer exame' AND status='active'").all();
  assert.equal(fu2.length, 1);
});

test('editar template não reescreve séries passadas (snapshot)', () => {
  const { db, m } = freshModel();
  const id = m.createProtocol({ name: 'Desmame', start_date: '2026-06-01', repeat_indefinitely: 0, phases: PHASES });
  // alterar a definição da fase 0
  db.prepare("UPDATE phases SET title = 'DOSE NOVA' WHERE template_id = ? AND phase_order = 0").run(id);
  const serie = db.prepare('SELECT title FROM series WHERE template_id = ? AND sort_order = 0').get(id);
  assert.equal(serie.title, '25mg', 'série mantém o snapshot original');
});
