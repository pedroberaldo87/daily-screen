const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel, addDays } = require('../model');
const { validateItemData } = require('../lib/validators');

function fresh() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return createModel(db);
}

// Dias (entre from e to) em que o item gera tarefa no tablet.
function daysWithTask(m, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    m.generateDailyTasks(d);
    if (m.getTasksView(d).length) out.push(d);
  }
  return out;
}

test('a cada 3 dias conta a partir da data de início e ignora dias da semana', () => {
  const m = fresh();
  m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01', weekdays: '[1]', repeat_every: 3, repeat_unit: 'day' });
  assert.deepEqual(daysWithTask(m, '2026-11-01', '2026-11-10'), ['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
});

test('a cada 2 semanas respeita os dias da semana marcados', () => {
  const m = fresh();
  // 2026-11-01 é domingo; segundas: 02 (semana 0), 09 (pula), 16 (semana 2)
  m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01', weekdays: '[1]', repeat_every: 2, repeat_unit: 'week' });
  assert.deepEqual(daysWithTask(m, '2026-11-01', '2026-11-22'), ['2026-11-02', '2026-11-16']);
});

test('todo mês no dia 31 cai no último dia de meses menores', () => {
  const m = fresh();
  m.createItem({ title: 'X', category: 'reminder', start_date: '2026-01-31', repeat_every: 1, repeat_unit: 'month' });
  assert.deepEqual(daysWithTask(m, '2026-01-31', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('a cada 2 meses pula o mês do meio', () => {
  const m = fresh();
  m.createItem({ title: 'X', category: 'reminder', start_date: '2026-01-15', repeat_every: 2, repeat_unit: 'month' });
  assert.deepEqual(daysWithTask(m, '2026-01-01', '2026-05-31'), ['2026-01-15', '2026-03-15', '2026-05-15']);
});

test('sem frequência informada, continua toda semana (comportamento antigo)', () => {
  const m = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01' });
  assert.equal(daysWithTask(m, '2026-11-01', '2026-11-07').length, 7);
  const item = m.getItemView(id);
  assert.equal(item.repeat_every, 1);
  assert.equal(item.repeat_unit, 'week');
});

test('editar a frequência vale para a série ativa', () => {
  const m = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01' });
  const item = m.updateItem(id, { repeat_every: 2, repeat_unit: 'day' });
  assert.equal(item.repeat_every, 2);
  assert.equal(item.repeat_unit, 'day');
  assert.deepEqual(daysWithTask(m, '2026-11-01', '2026-11-05'), ['2026-11-01', '2026-11-03', '2026-11-05']);
});

test('mudar a frequência apaga as tarefas pendentes de hoje em diante que não cabem mais', () => {
  const m = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-10-30' });
  for (const d of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']) m.generateDailyTasks(d);
  m.updateItem(id, { repeat_every: 3, repeat_unit: 'day' }, '2026-11-01');
  const shown = (d) => m.getTasksView(d).length > 0;
  // passado (antes de hoje) fica como histórico; de hoje em diante vale a regra nova
  assert.deepEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map(shown), [true, true, false, true, false]);
});

test('histórico (materialização por intervalo) usa a mesma regra', () => {
  const m = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01', repeat_every: 3, repeat_unit: 'day' });
  const h = m.getHistoryView({ dateFrom: '2026-11-01', dateTo: '2026-11-07', itemId: id });
  const dates = JSON.stringify(h);
  for (const d of ['2026-11-01', '2026-11-04', '2026-11-07']) assert.ok(dates.includes(d), d);
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-05']) assert.ok(!dates.includes(`"${d}"`), d);
});

test('validação recusa unidade e intervalo inválidos', () => {
  assert.ok(validateItemData({ repeat_unit: 'year' }, false).length);
  assert.ok(validateItemData({ repeat_every: 0 }, false).length);
  assert.ok(validateItemData({ repeat_every: 1.5 }, false).length);
  assert.deepEqual(validateItemData({ repeat_every: 3, repeat_unit: 'month' }, false), []);
});

test('criar item com data de fim guarda a data de fim', () => {
  const m = fresh();
  const id = m.createItem({ title: 'X', category: 'reminder', start_date: '2026-11-01', end_date: '2026-11-10' });
  assert.equal(m.getItemView(id).end_date, '2026-11-10');
});

test('protocolo arquivado aparece só quando a listagem pede os inativos', () => {
  const m = fresh();
  const pid = m.createProtocol({ name: 'P', start_date: '2026-11-01', phases: [{ title: 'a', category: 'reminder', duration_days: 3 }] });
  m.updateProtocol(pid, { active: 0 });
  assert.equal(m.getProtocolsView().length, 0);
  assert.equal(m.getProtocolsView({ includeInactive: true }).length, 1);
});

test('alertas do protocolo são guardados e aparecem nos 2 últimos dias da última fase', () => {
  const m = fresh();
  const pid = m.createProtocol({
    name: 'Desmame', start_date: '2026-11-01', alert_penultimate: 'Penúltimo dia!', alert_last: 'Último dia!',
    phases: [
      { title: 'F1', category: 'medication', duration_days: 3, alert_last: 'Fim da fase 1' },
      { title: 'F2', category: 'medication', duration_days: 3 },
    ],
  });
  assert.equal(m.getProtocolView(pid).alert_last, 'Último dia!');
  const alertOn = (d) => { m.generateDailyTasks(d); const t = m.getTasksView(d)[0]; return t.alert && t.alert.message; };
  assert.equal(alertOn('2026-11-03'), 'Fim da fase 1'); // fim da fase 1 usa o alerta da fase
  assert.equal(alertOn('2026-11-05'), 'Penúltimo dia!');
  assert.equal(alertOn('2026-11-06'), 'Último dia!');
  m.updateProtocol(pid, { alert_last: 'Acabou!' });
  assert.equal(m.getProtocolView(pid).alert_last, 'Acabou!');
  assert.equal(m.getProtocolView(pid).alert_penultimate, 'Penúltimo dia!');
});

test('fase de protocolo guarda a frequência e item convertido em protocolo mantém a regra', () => {
  const m = fresh();
  const pid = m.createProtocol({ name: 'P', start_date: '2026-11-01', phases: [{ title: 'a', category: 'reminder', duration_days: 9, repeat_every: 3, repeat_unit: 'day' }] });
  assert.equal(m.getProtocolView(pid).phases[0].repeat_unit, 'day');
  assert.deepEqual(daysWithTask(m, '2026-11-01', '2026-11-09'), ['2026-11-01', '2026-11-04', '2026-11-07']);
  // salvar de novo com o que o painel devolve (fase com os campos preservados) não perde a regra
  const ph = m.getProtocolView(pid).phases[0];
  m.updateProtocol(pid, { start_date: '2026-11-01', phases: [{ ...ph, duration_days: 9 }] });
  assert.equal(m.getProtocolView(pid).phases[0].repeat_every, 3);
});

test('weekdays enviado como lista (formato da doc da API) é normalizado e não derruba as tarefas', () => {
  const m = fresh();
  const data = { title: 'X', category: 'reminder', start_date: '2026-11-01', weekdays: [1] };
  assert.deepEqual(validateItemData(data, true), []);
  const id = m.createItem(data);
  assert.equal(m.getItemView(id).weekdays, '[1]');
  assert.deepEqual(daysWithTask(m, '2026-11-01', '2026-11-07'), ['2026-11-02']);
  const upd = { weekdays: [1, 3] };
  validateItemData(upd, false);
  m.updateItem(id, upd, '2026-11-01');
  assert.equal(m.getItemView(id).weekdays, '[1,3]');
});
