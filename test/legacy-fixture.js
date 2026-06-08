// Builds the LEGACY schema (routine_items + daily_tasks.routine_item_id +
// protocols) and seeds representative real-world cases, so the migration is
// tested against real-shaped data, not a biased toy. Mirrors db.js pre-redesign.

function buildLegacy(db) {
  db.exec(`
    CREATE TABLE routine_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      icon TEXT DEFAULT '✅',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      weekdays TEXT DEFAULT '[0,1,2,3,4,5,6]',
      periods TEXT DEFAULT '[]',
      total_count INTEGER,
      completed_count INTEGER DEFAULT 0,
      alert_penultimate TEXT,
      alert_last TEXT,
      followup_title TEXT,
      followup_category TEXT,
      followup_icon TEXT,
      followup_recreate INTEGER DEFAULT 0,
      followup_created INTEGER DEFAULT 0,
      cycle_start_date TEXT,
      recreate_item_id INTEGER,
      recreate_protocol_id INTEGER,
      protocol_id INTEGER,
      phase_order INTEGER,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_item_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(routine_item_id, date)
    );
    CREATE TABLE protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      repeat_indefinitely INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      followup_title TEXT,
      followup_category TEXT,
      followup_icon TEXT,
      followup_recreate INTEGER DEFAULT 0,
      followup_created INTEGER DEFAULT 0
    );
  `);

  const item = db.prepare(`INSERT INTO routine_items
    (title,category,icon,sort_order,active,weekdays,periods,total_count,completed_count,
     followup_title,followup_category,followup_icon,followup_recreate,cycle_start_date,
     recreate_item_id,protocol_id,phase_order,start_date,end_date,created_at)
    VALUES (@title,@category,@icon,@sort_order,@active,@weekdays,@periods,@total_count,@completed_count,
     @followup_title,@followup_category,@followup_icon,@followup_recreate,@cycle_start_date,
     @recreate_item_id,@protocol_id,@phase_order,@start_date,@end_date,@created_at)`);
  const dt = db.prepare('INSERT INTO daily_tasks (routine_item_id,date,completed,completed_at) VALUES (?,?,?,?)');
  const base = {
    icon: '✅', sort_order: 0, active: 1, weekdays: '[0,1,2,3,4,5,6]', periods: '[]',
    total_count: null, completed_count: 0, followup_title: null, followup_category: null,
    followup_icon: null, followup_recreate: 0, cycle_start_date: null, recreate_item_id: null,
    protocol_id: null, phase_order: null, start_date: null, end_date: null, created_at: '2026-01-01 00:00:00',
  };

  // 1) Item simples (Ritalina) com 3 dias marcados
  const ritalinaId = item.run({ ...base, title: 'Ritalina', category: 'medication', icon: '💊' }).lastInsertRowid;
  for (const d of ['2026-06-05', '2026-06-06', '2026-06-07']) dt.run(ritalinaId, d, 1, d + 'T08:00:00Z');
  dt.run(ritalinaId, '2026-06-08', 0, null); // dia pendente

  // 2) Caixa Atentah 80mg: 31 doses marcadas + cycle_start hoje (comprou de novo) → bagunça real
  const atentahId = item.run({
    ...base, title: 'Atentah 80mg', category: 'medication', icon: '💊',
    total_count: 31, completed_count: 0, cycle_start_date: '2026-06-08',
    followup_title: 'Comprar Atentah', followup_category: 'reminder', followup_icon: '🛒', followup_recreate: 1,
  }).lastInsertRowid;
  const atentahDays = [];
  for (let i = 0; i < 31; i++) atentahDays.push(addDays('2026-05-05', i));
  for (const d of atentahDays) dt.run(atentahId, d, 1, d + 'T08:00:00Z');

  // 2b) Follow-up legado "Comprar Atentah" (já completado)
  const fuId = item.run({
    ...base, title: 'Comprar Atentah', category: 'reminder', icon: '🛒',
    total_count: 1, completed_count: 1, active: 0, recreate_item_id: atentahId, created_at: '2026-06-08 00:00:00',
  }).lastInsertRowid;
  dt.run(fuId, '2026-06-08', 1, '2026-06-08T09:00:00Z');

  // 3) Protocolo de 2 fases (10mg / 5mg), 7 dias cada, a partir de 2026-05-20
  const protoId = db.prepare('INSERT INTO protocols (name,start_date,repeat_indefinitely,active) VALUES (?,?,0,1)')
    .run('Desmame', '2026-05-20').lastInsertRowid;
  const p1 = item.run({
    ...base, title: '10mg', category: 'medication', icon: '💊',
    protocol_id: protoId, phase_order: 0, start_date: '2026-05-20', end_date: '2026-05-26',
  }).lastInsertRowid;
  const p2 = item.run({
    ...base, title: '5mg', category: 'medication', icon: '💊',
    protocol_id: protoId, phase_order: 1, start_date: '2026-05-27', end_date: '2026-06-02',
  }).lastInsertRowid;
  for (const d of ['2026-05-20', '2026-05-21', '2026-05-22']) dt.run(p1, d, 1, d + 'T08:00:00Z');
  for (const d of ['2026-05-27', '2026-05-28']) dt.run(p2, d, 1, d + 'T08:00:00Z');

  return { ritalinaId, atentahId, fuId, protoId, p1, p2 };
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

module.exports = { buildLegacy };
