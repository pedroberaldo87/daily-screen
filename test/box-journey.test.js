const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel } = require('../model');

function freshModel() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return { db, m: createModel(db) };
}

function makeBox(m, total = 2) {
  return m.createItem({
    title: 'Atentah', category: 'medication', total_count: total,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
    followup_recreate: 1,
  });
}

// ── Teto: a rede que faltava (reproduz o "32 de 31") ──

test('jornada do 32/31: remarcar após reabrir conclui no total, NUNCA acima', () => {
  const { db, m } = freshModel();
  makeBox(m, 2);
  const ids = [];
  for (const date of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(date);
    const id = db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date).id;
    ids.push(id);
    m.toggleTask(id);
  }
  // caixa concluída em 2; desmarca a última → reabre (active)
  m.toggleTask(ids[1]);
  let serie = db.prepare('SELECT * FROM series WHERE total_count = 2').get();
  assert.equal(serie.status, 'active', 'reabriu');
  assert.equal(serie.completed_count, 1);

  // a geração é livre; marcar de novo conclui em 2
  m.generateDailyTasks('2026-06-08');
  const t8 = db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-08'").get();
  m.toggleTask(t8.id);
  serie = db.prepare('SELECT * FROM series WHERE total_count = 2').get();
  assert.equal(serie.completed_count, 2);
  assert.equal(serie.status, 'completed');

  // ao fechar, NÃO sobra tarefa órfã desmarcada (a dose de 07 que reabriu).
  // Era o bug do "31/31 clicável": geração livre deixava lixo ao refechar.
  const pendentes = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id=? AND completed=0').get(serie.id).c;
  assert.equal(pendentes, 0, 'cartela completa não deixa daily_task clicável órfã');
  const totalTasks = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id=?').get(serie.id).c;
  assert.equal(totalTasks, 2, 'exatamente N tasks, todas marcadas');
});

test('caixa com dia PULADO ainda completa as N doses (teto não trava a geração)', () => {
  const { db, m } = freshModel();
  makeBox(m, 3);
  const sid = db.prepare('SELECT id FROM series WHERE total_count = 3').get().id;
  // dia 1: marca
  m.generateDailyTasks('2026-06-06');
  m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=? AND series_id=?').get('2026-06-06', sid).id);
  // dia 2: gera mas PULA (esqueceu de tomar)
  m.generateDailyTasks('2026-06-07');
  // dia 3: marca
  m.generateDailyTasks('2026-06-08');
  m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=? AND series_id=?').get('2026-06-08', sid).id);
  // 2/3 marcadas; precisa de mais 1 dia. dia 4 DEVE ser gerado (faltam doses)
  m.generateDailyTasks('2026-06-09');
  const t4 = db.prepare('SELECT id FROM daily_tasks WHERE date=? AND series_id=?').get('2026-06-09', sid);
  assert.ok(t4, 'dia extra é gerado quando ainda faltam doses — a caixa não pode travar');
  m.toggleTask(t4.id);
  const serie = db.prepare('SELECT * FROM series WHERE id=?').get(sid);
  assert.equal(serie.completed_count, 3, 'completa as 3 doses mesmo tendo pulado um dia');
  assert.equal(serie.status, 'completed');
  // ao fechar, o dia pulado (desmarcado) é descartado — cartela = N doses, não calendário
  const pend = db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id=? AND completed=0').get(sid).c;
  assert.equal(pend, 0, 'dia pulado é limpo ao fechar a cartela');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE series_id=?').get(sid).c, 3, 'só as 3 doses marcadas restam');
});

test('toggleTask recusa marcar daily_task excedente (defense in depth p/ legado)', () => {
  const { db, m } = freshModel();
  makeBox(m, 2);
  for (const date of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(date);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date).id);
  }
  const serie = db.prepare('SELECT * FROM series WHERE total_count = 2').get();
  assert.equal(serie.completed_count, 2);

  // simula um daily_task excedente que já exista no banco (estado legado tipo o 32/31)
  const extraId = db.prepare('INSERT INTO daily_tasks (series_id, date) VALUES (?, ?)')
    .run(serie.id, '2026-06-08').lastInsertRowid;
  m.toggleTask(extraId);

  const after = db.prepare('SELECT * FROM series WHERE id = ?').get(serie.id);
  assert.equal(after.completed_count, 2, 'não passa do total mesmo com task excedente');
  const extra = db.prepare('SELECT completed FROM daily_tasks WHERE id = ?').get(extraId);
  assert.equal(extra.completed, 0, 'toggle de marcação recusado no teto');
});

// ── Invariante: no máximo 1 série count ativa por template ──

test('ciclo completo (comprar → comprei) deixa só 1 série ativa do template', () => {
  const { db, m } = freshModel();
  const tmplId = makeBox(m, 2);
  for (const date of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(date);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date = ?').get(date).id);
  }
  // "Comprar" aparece, caixa concluída — comprar de novo
  m.generateDailyTasks('2026-06-08');
  const fuTask = db.prepare(`
    SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id = dt.series_id
    WHERE s.title = 'Comprar Atentah' AND dt.date = '2026-06-08'
  `).get();
  m.toggleTask(fuTask.id);
  m.recreateFromFollowup(fuTask.id, '2026-06-08');

  const activeOfTemplate = db.prepare(
    "SELECT COUNT(*) c FROM series WHERE template_id = ? AND status = 'active'"
  ).get(tmplId).c;
  assert.equal(activeOfTemplate, 1, 'só uma caixa ativa do template (a nova zerada)');
  const fresh = db.prepare("SELECT * FROM series WHERE template_id = ? AND status = 'active'").get(tmplId);
  assert.equal(fresh.completed_count, 0, 'caixa nova zerada');
});

test('comprei duas vezes (clique duplo) não cria duas cartelas ativas', () => {
  const { db, m } = freshModel();
  const tmplId = makeBox(m, 1);
  m.generateDailyTasks('2026-06-07');
  m.toggleTask(db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Atentah' AND dt.date='2026-06-07'").get().id);
  m.generateDailyTasks('2026-06-08');
  const fu = db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Comprar Atentah' AND dt.date='2026-06-08'").get();
  m.toggleTask(fu.id);
  m.recreateFromFollowup(fu.id, '2026-06-08');
  m.recreateFromFollowup(fu.id, '2026-06-08'); // segundo clique
  const active = db.prepare("SELECT COUNT(*) c FROM series WHERE template_id=? AND status='active'").get(tmplId).c;
  assert.equal(active, 1, 'apenas uma cartela ativa mesmo com duplo comprei');
});

// ── Configurabilidade do follow-up (o motor respeita, não decide) ──

test('followup_recreate=0: marcar "Comprar" encerra o ciclo, sem nova cartela', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 2,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒',
  }); // followup_recreate ausente = 0
  for (const d of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(d);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  m.generateDailyTasks('2026-06-08');
  const fu = db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Comprar Atentah' AND dt.date='2026-06-08'").get();
  const res = m.toggleTask(fu.id);
  assert.equal(res.recreate_prompt, undefined, 'sem recreate: não oferece recriar');
  const active = db.prepare("SELECT COUNT(*) c FROM series WHERE total_count=2 AND status='active'").get().c;
  assert.equal(active, 0, 'nenhuma cartela nova nasce');
});

test('sem followup_title: cartela conclui sem spawnar nada', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Vitamina', category: 'supplement', total_count: 2 });
  for (const d of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(d);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  assert.equal(db.prepare('SELECT status FROM series WHERE total_count=2').get().status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM series').get().c, 1, 'nenhuma série follow-up criada');
});

test('recreateFromFollowup numa tarefa que não é follow-up de recreate → erro', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Atentah', category: 'medication', total_count: 1 });
  m.generateDailyTasks('2026-06-08');
  const t = db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-08'").get();
  assert.equal(m.recreateFromFollowup(t.id, '2026-06-08').ok, false);
});

test('follow-up reusa 1 template por origem entre ciclos (não duplica "Comprar")', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 1,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒', followup_recreate: 1,
  });
  // ciclo 1: marca dose → Comprar → comprei
  m.generateDailyTasks('2026-06-06');
  m.toggleTask(db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Atentah' AND dt.date='2026-06-06'").get().id);
  m.generateDailyTasks('2026-06-07');
  let fu = db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Comprar Atentah' AND dt.date='2026-06-07'").get();
  m.toggleTask(fu.id);
  m.recreateFromFollowup(fu.id, '2026-06-07');
  // ciclo 2: marca dose da cartela nova → Comprar de novo
  m.generateDailyTasks('2026-06-08');
  m.toggleTask(db.prepare("SELECT dt.id FROM daily_tasks dt JOIN series s ON s.id=dt.series_id WHERE s.title='Atentah' AND dt.date='2026-06-08'").get().id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM templates WHERE name='Comprar Atentah'").get().c, 1, 'um só template de follow-up');
});

// ── Edge cases de marcação e edição ──

test('marcar doses fora de ordem conta certo e conclui', () => {
  const { db, m } = freshModel();
  makeBox(m, 3);
  for (const d of ['2026-06-06', '2026-06-07', '2026-06-08']) m.generateDailyTasks(d);
  for (const d of ['2026-06-08', '2026-06-06', '2026-06-07']) {
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  const serie = db.prepare('SELECT * FROM series WHERE total_count=3').get();
  assert.equal(serie.completed_count, 3);
  assert.equal(serie.status, 'completed');
});

test('reduzir total_count abaixo do já marcado conclui a cartela', () => {
  const { db, m } = freshModel();
  const tid = makeBox(m, 5);
  for (const d of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(d);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  m.updateItem(tid, { total_count: 2 }); // 2/5 marcadas, reduz teto pra 2
  const s = db.prepare("SELECT * FROM series WHERE template_id=? AND seq=1").get(tid);
  assert.equal(s.status, 'completed', 'atingiu o novo teto → conclui');
});

// ── Geração: janela e weekdays ──

test('weekdays restritos: gera só nos dias permitidos', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'SóSegunda', category: 'medication', total_count: 5, weekdays: JSON.stringify([1]) });
  m.generateDailyTasks('2026-06-08'); // segunda-feira
  m.generateDailyTasks('2026-06-09'); // terça-feira
  assert.ok(db.prepare("SELECT 1 FROM daily_tasks WHERE date='2026-06-08'").get(), 'segunda gera');
  assert.equal(db.prepare("SELECT 1 FROM daily_tasks WHERE date='2026-06-09'").get(), undefined, 'terça não gera');
});

test('start_date futura: não gera antes do início', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Futuro', category: 'medication', total_count: 3, start_date: '2026-06-10' });
  m.generateDailyTasks('2026-06-08');
  assert.equal(db.prepare("SELECT 1 FROM daily_tasks WHERE date='2026-06-08'").get(), undefined, 'antes do início não gera');
  m.generateDailyTasks('2026-06-10');
  assert.ok(db.prepare("SELECT 1 FROM daily_tasks WHERE date='2026-06-10'").get(), 'no início gera');
});

// ── Alertas de penúltima/última dose ──

test('alerta penúltima e última dose calculados na view', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 3,
    alert_penultimate: 'penúltima!', alert_last: 'última!',
  });
  m.generateDailyTasks('2026-06-06');
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-06'").get().id); // 1/3
  m.generateDailyTasks('2026-06-07');
  let v = m.getTasksView('2026-06-07').find((t) => t.title === 'Atentah');
  assert.equal(v.alert?.type, 'penultimate', 'faltam 2 → penúltima');
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-07'").get().id); // 2/3
  m.generateDailyTasks('2026-06-08');
  v = m.getTasksView('2026-06-08').find((t) => t.title === 'Atentah');
  assert.equal(v.alert?.type, 'last', 'falta 1 → última');
});

// ── Deletar da tela principal (long-press → remover item inteiro) ──

test('deleteByDailyTask sem histórico: apaga o item do banco e some da tela', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Lixo', category: 'reminder' });
  m.generateDailyTasks('2026-06-08');
  const t = db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-08'").get();
  assert.equal(m.deleteByDailyTask(t.id).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM templates').get().c, 0, 'template removido');
  assert.equal(m.getTasksView('2026-06-08').length, 0, 'some da tela');
});

test('deleteByDailyTask com histórico: arquiva (preserva), some da tela', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'ComHist', category: 'reminder' });
  m.generateDailyTasks('2026-06-08');
  const t = db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-08'").get();
  m.toggleTask(t.id); // marca → vira histórico
  assert.equal(m.deleteByDailyTask(t.id).ok, true);
  assert.equal(db.prepare('SELECT active FROM templates').get().active, 0, 'arquivado (active=0)');
  assert.equal(m.getTasksView('2026-06-08').length, 0, 'some da tela');
});

test('deleteByDailyTask em tarefa inexistente → erro', () => {
  const { m } = freshModel();
  assert.equal(m.deleteByDailyTask(999).ok, false);
});

// ── Admin: template expõe suas cartelas (séries) e oculta follow-ups ──

test('getItemsView: template count traz suas cartelas; follow-up não vira item', () => {
  const { db, m } = freshModel();
  m.createItem({
    title: 'Atentah', category: 'medication', total_count: 2,
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒', followup_recreate: 1,
  });
  for (const d of ['2026-06-06', '2026-06-07']) {
    m.generateDailyTasks(d);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  const items = m.getItemsView();
  assert.equal(items.some((i) => i.title === 'Comprar Atentah'), false, 'follow-up oculto da lista de itens');
  const atentah = items.find((i) => i.title === 'Atentah');
  assert.ok(Array.isArray(atentah.series), 'count expõe series');
  assert.equal(atentah.series.length, 1, 'uma cartela (a concluída)');
  assert.equal(atentah.series[0].status, 'completed');
  assert.equal(atentah.series[0].completed_count, 2);
});

test('getItemsView: item simples não traz cartelas', () => {
  const { m } = freshModel();
  m.createItem({ title: 'Ritalina', category: 'medication' });
  const it = m.getItemsView().find((i) => i.title === 'Ritalina');
  assert.deepEqual(it.series, [], 'simples sem bloco de cartelas');
});

// ── Contador progressivo por dia (não o total global repetido) ──

test('contador mostra doses até o dia, progressivo (não repete o total)', () => {
  const { db, m } = freshModel();
  m.createItem({ title: 'Atentah', category: 'medication', total_count: 5 });
  const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
  for (const d of days) {
    m.generateDailyTasks(d);
    m.toggleTask(db.prepare('SELECT id FROM daily_tasks WHERE date=?').get(d).id);
  }
  const cc = (d) => m.getTasksView(d).find((t) => t.title === 'Atentah').completed_count;
  assert.equal(cc('2026-06-01'), 1, 'dia 1 → 1/5');
  assert.equal(cc('2026-06-03'), 3, 'dia 3 → 3/5');
  assert.equal(cc('2026-06-05'), 5, 'dia 5 → 5/5');

  // desmarca 05 e 04 → cada dia reflete as doses até ali
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-05'").get().id);
  m.toggleTask(db.prepare("SELECT id FROM daily_tasks WHERE date='2026-06-04'").get().id);
  assert.equal(cc('2026-06-03'), 3, 'dia 3 segue 3');
  assert.equal(cc('2026-06-04'), 3, 'dia 4 = doses até ali (1,2,3)');
  assert.equal(cc('2026-06-05'), 3, 'dia 5 = doses até ali (1,2,3)');
});
