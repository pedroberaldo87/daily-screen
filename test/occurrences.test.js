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

// ── Critério de "fora da regra" ──
test('dose feita sob a regra antiga não vira "fora da regra"; dia não marcado e dose avulsa fora da regra sim', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-01', weekdays: '[1]' }); // segunda
  gen(m, '2026-10-01', '2026-10-14');
  m.toggleTask(byDate(m.getOccurrences(id, {}), '2026-10-05').id);
  m.addOccurrence(id, '2026-10-07'); // quarta, à mão
  m.toggleTask(byDate(m.getOccurrences(id, {}), '2026-10-07').id);
  m.updateItem(id, { weekdays: '[5]', start_date: '2026-10-16' }, '2026-10-15');
  const occ = m.getOccurrences(id, {});
  assert.equal(byDate(occ, '2026-10-05').fits_rule, true, 'dose gerada pela regra da época');
  assert.equal(byDate(occ, '2026-10-12').fits_rule, false, 'não marcado e fora da regra atual');
  assert.equal(byDate(occ, '2026-10-07').fits_rule, false, 'avulsa fora da regra continua apontada');
});

test('a cada 2 semanas na sexta: só as sextas do ciclo cabem na regra (caso real do Mounjaro)', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]', repeat_every: 2, repeat_unit: 'week' });
  for (const [d, fits] of [['2026-10-16', true], ['2026-10-30', true], ['2026-11-13', true], ['2026-10-23', false], ['2026-11-06', false], ['2026-11-04', false]]) {
    assert.equal(m.addOccurrence(id, d).occurrence.fits_rule, fits, d);
  }
});

// ── Adicionar ──
test('adicionar logo depois de outro funciona; dia removido volta ao adicionar de novo, como manual', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  assert.equal(m.addOccurrence(id, '2026-11-13').ok, true);
  const r = m.addOccurrence(id, '2026-11-04');
  assert.equal(r.ok, true);
  m.removeOccurrence(r.occurrence.id, true);
  const again = m.addOccurrence(id, '2026-11-04');
  assert.equal(again.ok, true, 'não pode dar 409 por causa do dia removido');
  assert.equal(again.occurrence.id, r.occurrence.id);
  assert.equal(again.occurrence.removed_at, null);
  assert.equal(again.occurrence.origin, 'manual');
  assert.equal(m.addOccurrence(id, '2026-11-04').code, 'exists', 'dia ativo repetido é recusado com motivo');
});

test('item aceita dia avulso antes do início; protocolo fora das fases é recusado com motivo', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  const r = m.addOccurrence(id, '2026-09-25');
  assert.equal(r.ok, true);
  assert.equal(r.occurrence.fits_rule, false);
  const p = m.createProtocol({ name: 'P', start_date: '2026-10-01', phases: [{ title: 'F1', category: 'medication', duration_days: 5 }] });
  assert.equal(m.addOccurrence(p, '2026-12-25').code, 'no_series');
});

// ── Editar a data ──
test('editar a data move o lançamento, mantém marcação e contagem, e aparece no tablet no novo dia', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]', total_count: 4 });
  m.generateDailyTasks('2026-10-02');
  const o = byDate(m.getOccurrences(id, {}), '2026-10-02');
  m.toggleTask(o.id);
  const moved = m.moveOccurrence(o.id, '2026-10-03', '2026-11-04');
  assert.equal(moved.date, '2026-10-03');
  assert.equal(moved.completed, 1);
  assert.equal(moved.origin, 'manual');
  assert.equal(moved.fits_rule, false, 'sábado não cabe na regra de sexta');
  assert.equal(m.getItemView(id).completed_count, 1);
  assert.equal(m.getTasksView('2026-10-03').length, 1);
});

test('mover um dia da regra não faz o dia antigo renascer no tablet', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  m.generateDailyTasks('2026-10-09');
  const o = byDate(m.getOccurrences(id, {}), '2026-10-09');
  m.moveOccurrence(o.id, '2026-10-10', '2026-11-04');
  m.generateDailyTasks('2026-10-09');
  assert.equal(m.getTasksView('2026-10-09').length, 0);
  assert.ok(byDate(m.getOccurrences(id, {}), '2026-10-09').removed_at, 'fica como removido, restaurável');
});

test('mover sem efeito colateral: dia avulso fora da regra não deixa rastro; mesma data não muda nada', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  const o = m.addOccurrence(id, '2026-10-07').occurrence;
  assert.equal(m.moveOccurrence(o.id, '2026-10-07', '2026-11-04').date, '2026-10-07');
  m.moveOccurrence(o.id, '2026-10-08', '2026-11-04');
  assert.equal(byDate(m.getOccurrences(id, {}), '2026-10-07'), undefined);
});

test('mover é recusado: data já ocupada, dia removido, dose marcada para o futuro, dose removida no destino', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  const a = m.addOccurrence(id, '2026-10-06').occurrence;
  const b = m.addOccurrence(id, '2026-10-07').occurrence;
  assert.equal(m.moveOccurrence(a.id, '2026-10-07', '2026-11-04').code, 'exists');
  m.toggleTask(a.id);
  assert.equal(m.moveOccurrence(a.id, '2026-11-05', '2026-11-04').code, 'future_done');
  assert.equal(m.moveOccurrence(a.id, '2026-11-04', '2026-11-04').date, '2026-11-04', 'hoje pode');
  m.removeOccurrence(b.id, true);
  assert.equal(m.moveOccurrence(b.id, '2026-10-20', '2026-11-04').code, 'removed');
  m.removeOccurrence(a.id, true);
  const c = m.addOccurrence(id, '2026-10-21').occurrence;
  assert.equal(m.moveOccurrence(c.id, '2026-11-04', '2026-11-04').code, 'removed_dose', 'dose removida no destino não se perde');
});

test('mover para cima de um dia removido não marcado substitui esse dia', () => {
  const { m } = fresh();
  const id = m.createItem({ title: 'M', category: 'medication', start_date: '2026-10-02', weekdays: '[5]' });
  const a = m.addOccurrence(id, '2026-10-06').occurrence;
  const b = m.addOccurrence(id, '2026-10-07').occurrence;
  m.removeOccurrence(a.id, true);
  assert.equal(m.moveOccurrence(b.id, '2026-10-06', '2026-11-04').date, '2026-10-06');
  assert.equal(m.getOccurrences(id, {}).length, 1);
});
