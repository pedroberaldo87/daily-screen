const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel, addDays } = require('../model');

function fresh() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return { db, m: createModel(db) };
}
function gen(m, from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) m.generateDailyTasks(d);
}
const byDate = (list, date) => list.find((o) => o.date === date);

test('cada ocorrência registra quando nasceu e a origem', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01' });
  m.generateDailyTasks('2026-11-01');
  const [o] = m.getOccurrences(id, {});
  assert.ok(o.created_at, 'created_at preenchido');
  assert.equal(o.origin, 'auto');
  assert.equal(o.fits_rule, true);
  assert.equal(o.removed_at, null);
});

test('mudar o dia deixa as antigas marcadas como fora da regra', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-01', weekdays: '[1]' }); // segunda
  gen(m, '2026-10-01', '2026-10-14');
  m.updateItem(id, { weekdays: '[5]' }, '2026-10-15'); // sexta, a partir de 15/10
  const occ = m.getOccurrences(id, {});
  assert.equal(byDate(occ, '2026-10-05').fits_rule, false);
  assert.equal(byDate(occ, '2026-10-12').fits_rule, false);
});

test('limpar fora da regra: prévia não escreve; depois remove só as não marcadas do passado', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-01', weekdays: '[1]' });
  gen(m, '2026-10-01', '2026-10-14');
  m.toggleTask(byDate(m.getOccurrences(id, {}), '2026-10-05').id); // 05/10 foi tomada
  m.updateItem(id, { weekdays: '[5]' }, '2026-10-15');
  const preview = m.pruneOffRule(id, { before: '2026-10-15', dryRun: true });
  assert.deepEqual(preview.map((o) => o.date), ['2026-10-12']);
  assert.equal(byDate(m.getOccurrences(id, {}), '2026-10-12').removed_at, null); // prévia não escreveu
  m.pruneOffRule(id, { before: '2026-10-15' });
  const occ = m.getOccurrences(id, {});
  assert.ok(byDate(occ, '2026-10-12').removed_at, '12/10 removida');
  assert.equal(byDate(occ, '2026-10-05').removed_at, null, 'marcada nunca sai em lote');
});

test('remover um dia da regra continua removido mesmo quando o tablet olha aquele dia de novo', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01' });
  m.generateDailyTasks('2026-11-02');
  const o = byDate(m.getOccurrences(id, {}), '2026-11-02');
  m.removeOccurrence(o.id, true);
  m.generateDailyTasks('2026-11-02');
  assert.equal(m.getTasksView('2026-11-02').length, 0, 'some da tela do tablet');
  m.removeOccurrence(o.id, false);
  assert.equal(m.getTasksView('2026-11-02').length, 1, 'restaurar devolve');
});

test('remover dose marcada baixa o contador e reabre a cartela; restaurar fecha de novo', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-01', total_count: 2, followup_title: 'Comprar C' });
  for (const d of ['2026-11-01', '2026-11-02']) { m.generateDailyTasks(d); m.toggleTask(m.getTasksView(d).find((t) => t.title === 'C').id); }
  assert.equal(m.getItemView(id).series[0].status, 'completed');
  const o = byDate(m.getOccurrences(id, {}), '2026-11-02');
  m.removeOccurrence(o.id, true);
  let item = m.getItemView(id);
  assert.equal(item.completed_count, 1);
  assert.equal(item.series[0].status, 'active');
  m.removeOccurrence(o.id, false);
  item = m.getItemView(id);
  assert.equal(item.completed_count, 2);
  assert.equal(item.series[0].status, 'completed');
});

test('removida não pode ser marcada e não entra na adesão', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01' });
  gen(m, '2026-11-01', '2026-11-02');
  const o = byDate(m.getOccurrences(id, {}), '2026-11-01');
  m.removeOccurrence(o.id, true);
  m.toggleTask(o.id);
  assert.equal(byDate(m.getOccurrences(id, {}), '2026-11-01').completed, 0);
  const hist = m.getHistoryView({ dateFrom: '2026-11-01', dateTo: '2026-11-02', itemId: id });
  assert.deepEqual(hist.map((r) => r.date), ['2026-11-02']);
});

test('adicionar um dia à mão cria ocorrência manual; repetir a data é recusado', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01', weekdays: '[1]' });
  const r = m.addOccurrence(id, '2026-11-04'); // quarta, fora da regra
  assert.equal(r.ok, true);
  const o = byDate(m.getOccurrences(id, {}), '2026-11-04');
  assert.equal(o.origin, 'manual');
  assert.equal(o.fits_rule, false);
  assert.equal(m.getTasksView('2026-11-04').length, 1, 'aparece no tablet');
  assert.equal(m.addOccurrence(id, '2026-11-04').ok, false);
});

// ── Achados da revisão independente (2026-10-31) ──
function closedBox(m, total = 2) {
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-01', total_count: total, followup_title: 'Comprar C', followup_recreate: 1 });
  for (let i = 0; i < total; i++) {
    const d = addDays('2026-11-01', i);
    m.generateDailyTasks(d);
    m.toggleTask(m.getTasksView(d).find((t) => t.title === 'C').id);
  }
  return id;
}

test('mexer em dose de cartela antiga não reabre quando já existe cartela mais nova', () => {
  const { db, m } = fresh();
  const id = closedBox(m);
  m.generateDailyTasks('2026-11-03');
  const buy = m.getTasksView('2026-11-03').find((t) => t.title === 'Comprar C');
  m.toggleTask(buy.id);
  m.recreateFromFollowup(buy.id, '2026-11-03'); // cartela 2 ativa
  const old = byDate(m.getOccurrences(id, {}), '2026-11-01');
  m.removeOccurrence(old.id, true);
  const series = db.prepare('SELECT seq, status, completed_count FROM series WHERE template_id = ? ORDER BY seq').all(id);
  assert.deepEqual(series.map((s) => [s.seq, s.status]), [[1, 'completed'], [2, 'active']]);
  assert.equal(series[0].completed_count, 1); // contagem da antiga corrigida
});

test('remover e restaurar dose não cria um segundo "Comprar" para a mesma cartela', () => {
  const { m } = fresh();
  const id = closedBox(m);
  m.generateDailyTasks('2026-11-03');
  m.toggleTask(m.getTasksView('2026-11-03').find((t) => t.title === 'Comprar C').id); // comprou, não recriou
  const o = byDate(m.getOccurrences(id, {}), '2026-11-02');
  m.removeOccurrence(o.id, true);
  m.removeOccurrence(o.id, false);
  m.generateDailyTasks('2026-11-04');
  assert.equal(m.getTasksView('2026-11-04').filter((t) => t.title === 'Comprar C').length, 0);
});

test('restaurar dose marcada além do total é recusado', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-01', total_count: 2 });
  m.generateDailyTasks('2026-11-01'); m.generateDailyTasks('2026-11-02'); m.generateDailyTasks('2026-11-03');
  const occ = () => m.getOccurrences(id, {});
  m.toggleTask(byDate(occ(), '2026-11-01').id);
  m.toggleTask(byDate(occ(), '2026-11-02').id); // fecha 2/2
  const o2 = byDate(occ(), '2026-11-02');
  m.removeOccurrence(o2.id, true); // reabre 1/2
  m.generateDailyTasks('2026-11-03');
  m.toggleTask(byDate(occ(), '2026-11-03').id); // fecha 2/2 de novo
  const r = m.removeOccurrence(o2.id, false);
  assert.ok(r.error, 'recusa');
  assert.equal(m.getItemView(id).completed_count, 2);
});

test('restaurar dia NÃO marcado de cartela fechada é recusado (viraria tarefa morta)', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-01', total_count: 2 });
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) m.generateDailyTasks(d);
  const o1 = byDate(m.getOccurrences(id, {}), '2026-11-01');
  m.removeOccurrence(o1.id, true);
  m.toggleTask(byDate(m.getOccurrences(id, {}), '2026-11-02').id);
  m.toggleTask(byDate(m.getOccurrences(id, {}), '2026-11-03').id); // fecha
  assert.ok(m.removeOccurrence(o1.id, false).error);
  assert.ok(byDate(m.getOccurrences(id, {}), '2026-11-01').removed_at);
});

test('dia removido não estica o histórico de cartela fechada', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'C', category: 'medication', start_date: '2026-11-01', total_count: 2 });
  const add = m.addOccurrence(id, '2026-11-20');
  m.removeOccurrence(add.occurrence.id, true);
  for (const d of ['2026-11-01', '2026-11-02']) { m.generateDailyTasks(d); m.toggleTask(m.getTasksView(d)[0].id); }
  const hist = m.getHistoryView({ dateFrom: '2026-11-01', dateTo: '2026-11-25', itemId: id });
  assert.deepEqual(hist.map((r) => r.date), ['2026-11-01', '2026-11-02']);
});

test('limpar fora da regra não remove dia adicionado à mão', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-10-01', weekdays: '[1]' });
  m.addOccurrence(id, '2026-10-07'); // quarta, manual
  assert.deepEqual(m.pruneOffRule(id, { before: '2026-10-15', dryRun: true }), []);
});
