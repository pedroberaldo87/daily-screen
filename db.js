const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './daily-screen.db';
const db = new Database(path.resolve(dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ═══ Schema ═══

db.exec(`
  CREATE TABLE IF NOT EXISTS routine_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('medication', 'supplement', 'reminder')),
    icon TEXT DEFAULT '✅',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    weekdays TEXT DEFAULT '[0,1,2,3,4,5,6]',
    total_count INTEGER,
    completed_count INTEGER DEFAULT 0,
    alert_penultimate TEXT,
    alert_last TEXT,
    followup_title TEXT,
    followup_category TEXT,
    followup_icon TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_item_id INTEGER NOT NULL REFERENCES routine_items(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    UNIQUE(routine_item_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_tasks_date ON daily_tasks(date);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS protocols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    repeat_indefinitely INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ═══ Migrations (add columns to existing DBs) ═══

function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(col => col.name === column);
}

const migrations = [
  ['routine_items', 'weekdays', "TEXT DEFAULT '[0,1,2,3,4,5,6]'"],
  ['routine_items', 'total_count', 'INTEGER'],
  ['routine_items', 'completed_count', 'INTEGER DEFAULT 0'],
  ['routine_items', 'alert_penultimate', 'TEXT'],
  ['routine_items', 'alert_last', 'TEXT'],
  ['routine_items', 'followup_title', 'TEXT'],
  ['routine_items', 'followup_category', 'TEXT'],
  ['routine_items', 'followup_icon', 'TEXT'],
  ['routine_items', 'periods', "TEXT DEFAULT '[]'"],
  ['routine_items', 'protocol_id', 'INTEGER REFERENCES protocols(id) ON DELETE CASCADE'],
  ['routine_items', 'phase_order', 'INTEGER'],
  ['routine_items', 'start_date', 'TEXT'],
  ['routine_items', 'end_date', 'TEXT'],
];

for (const [table, column, type] of migrations) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// ═══ Settings ═══

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// ═══ Routine Items (admin CRUD) ═══

// Standalone items only (protocol_id IS NULL). Used by admin listing and public
// API so protocol phases don't leak into the generic "items" view — they are
// managed through the protocol modal.
function getRoutineItems() {
  return db.prepare('SELECT * FROM routine_items WHERE active = 1 AND protocol_id IS NULL ORDER BY sort_order, id').all();
}

function getAllRoutineItems() {
  return db.prepare('SELECT * FROM routine_items WHERE protocol_id IS NULL ORDER BY active DESC, sort_order, id').all();
}

// Every active item — standalone OR protocol phase. Used internally by
// generateDailyTasks to produce tasks for both sources uniformly.
function getActiveItemsForGeneration() {
  return db.prepare('SELECT * FROM routine_items WHERE active = 1 ORDER BY sort_order, id').all();
}

function createRoutineItem(data) {
  const stmt = db.prepare(`
    INSERT INTO routine_items (title, category, icon, sort_order, weekdays, periods, total_count,
      alert_penultimate, alert_last, followup_title, followup_category, followup_icon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.title,
    data.category,
    data.icon || '✅',
    data.sort_order || 0,
    data.weekdays || '[0,1,2,3,4,5,6]',
    data.periods || '[]',
    data.total_count || null,
    data.alert_penultimate || null,
    data.alert_last || null,
    data.followup_title || null,
    data.followup_category || null,
    data.followup_icon || null,
  );
  return result.lastInsertRowid;
}

function updateRoutineItem(id, data) {
  const item = db.prepare('SELECT * FROM routine_items WHERE id = ?').get(id);
  if (!item) return null;

  // Normalize "" to null for date fields so clearing the form clears the window.
  const normalizeDate = (v, fallback) => {
    if (v === undefined) return fallback;
    if (v === '' || v === null) return null;
    return v;
  };

  const stmt = db.prepare(`
    UPDATE routine_items
    SET title = ?, category = ?, icon = ?, sort_order = ?, active = ?,
        weekdays = ?, periods = ?, total_count = ?, completed_count = ?,
        alert_penultimate = ?, alert_last = ?,
        followup_title = ?, followup_category = ?, followup_icon = ?,
        start_date = ?, end_date = ?
    WHERE id = ?
  `);
  stmt.run(
    data.title ?? item.title,
    data.category ?? item.category,
    data.icon ?? item.icon,
    data.sort_order ?? item.sort_order,
    data.active ?? item.active,
    data.weekdays ?? item.weekdays,
    data.periods ?? item.periods,
    data.total_count !== undefined ? data.total_count : item.total_count,
    data.completed_count !== undefined ? data.completed_count : item.completed_count,
    data.alert_penultimate !== undefined ? data.alert_penultimate : item.alert_penultimate,
    data.alert_last !== undefined ? data.alert_last : item.alert_last,
    data.followup_title !== undefined ? data.followup_title : item.followup_title,
    data.followup_category !== undefined ? data.followup_category : item.followup_category,
    data.followup_icon !== undefined ? data.followup_icon : item.followup_icon,
    normalizeDate(data.start_date, item.start_date),
    normalizeDate(data.end_date, item.end_date),
    id,
  );
  return db.prepare('SELECT * FROM routine_items WHERE id = ?').get(id);
}

function deactivateRoutineItem(id) {
  db.prepare('UPDATE routine_items SET active = 0 WHERE id = ?').run(id);
}

function deleteRoutineItemPermanently(id) {
  db.prepare('DELETE FROM daily_tasks WHERE routine_item_id = ?').run(id);
  db.prepare('DELETE FROM routine_items WHERE id = ?').run(id);
}

// ═══ Protocols (sequences of dated phases) ═══

// Add N days to a YYYY-MM-DD date using UTC to avoid DST drift.
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Given a start date and an ordered list of phases with duration_days,
// produce each phase's inclusive [start_date, end_date] window. Last phase
// gets end_date = null when repeat_indefinitely is true.
function computePhaseDates(startDate, phases, repeatIndefinitely) {
  let cursor = startDate;
  return phases.map((phase, i) => {
    const isLast = i === phases.length - 1;
    const duration = Number(phase.duration_days) || 1;
    const start = cursor;
    const end = (isLast && repeatIndefinitely) ? null : addDays(start, duration - 1);
    cursor = addDays(start, duration);
    return { ...phase, start_date: start, end_date: end };
  });
}

function getProtocols() {
  const protocols = db.prepare('SELECT * FROM protocols ORDER BY active DESC, created_at DESC').all();
  const phaseStmt = db.prepare(
    'SELECT * FROM routine_items WHERE protocol_id = ? ORDER BY phase_order, id'
  );
  return protocols.map(p => ({ ...p, phases: phaseStmt.all(p.id) }));
}

function getProtocol(id) {
  const p = db.prepare('SELECT * FROM protocols WHERE id = ?').get(id);
  if (!p) return null;
  p.phases = db.prepare(
    'SELECT * FROM routine_items WHERE protocol_id = ? ORDER BY phase_order, id'
  ).all(p.id);
  return p;
}

function insertPhasesForProtocol(protocolId, startDate, phases, repeatIndefinitely, baseActive) {
  const withDates = computePhaseDates(startDate, phases, repeatIndefinitely);
  const stmt = db.prepare(`
    INSERT INTO routine_items (
      title, category, icon, sort_order, active, weekdays, periods,
      total_count, alert_penultimate, alert_last,
      followup_title, followup_category, followup_icon,
      protocol_id, phase_order, start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  withDates.forEach((phase, i) => {
    stmt.run(
      phase.title,
      phase.category,
      phase.icon || '💊',
      phase.sort_order || 0,
      baseActive,
      typeof phase.weekdays === 'string' ? phase.weekdays : JSON.stringify(phase.weekdays || [0,1,2,3,4,5,6]),
      typeof phase.periods === 'string' ? phase.periods : JSON.stringify(phase.periods || []),
      phase.total_count || null,
      phase.alert_penultimate || null,
      phase.alert_last || null,
      phase.followup_title || null,
      phase.followup_category || null,
      phase.followup_icon || null,
      protocolId,
      i,
      phase.start_date,
      phase.end_date,
    );
  });
}

function createProtocol({ name, start_date, repeat_indefinitely, phases }) {
  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO protocols (name, start_date, repeat_indefinitely, active)
      VALUES (?, ?, ?, 1)
    `).run(name, start_date, repeat_indefinitely ? 1 : 0);
    const id = result.lastInsertRowid;
    insertPhasesForProtocol(id, start_date, phases, !!repeat_indefinitely, 1);
    return id;
  });
  return tx();
}

// Update strategy: delete-and-recreate all phases when `phases` is provided.
// Simpler than diffing, and the price (losing past daily_tasks of edited
// phases via CASCADE) is acceptable for a routine-tracking app.
function updateProtocol(id, { name, start_date, repeat_indefinitely, phases, active }) {
  const existing = db.prepare('SELECT * FROM protocols WHERE id = ?').get(id);
  if (!existing) return null;

  const nextName = name ?? existing.name;
  const nextStart = start_date ?? existing.start_date;
  const nextRepeat = repeat_indefinitely !== undefined
    ? (repeat_indefinitely ? 1 : 0)
    : existing.repeat_indefinitely;
  const nextActive = active !== undefined ? (active ? 1 : 0) : existing.active;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE protocols SET name = ?, start_date = ?, repeat_indefinitely = ?, active = ?
      WHERE id = ?
    `).run(nextName, nextStart, nextRepeat, nextActive, id);

    if (Array.isArray(phases)) {
      db.prepare('DELETE FROM routine_items WHERE protocol_id = ?').run(id);
      insertPhasesForProtocol(id, nextStart, phases, !!nextRepeat, nextActive);
    } else if (active !== undefined) {
      db.prepare('UPDATE routine_items SET active = ? WHERE protocol_id = ?').run(nextActive, id);
    }
  });
  tx();

  return getProtocol(id);
}

function deleteProtocol(id) {
  db.prepare('DELETE FROM protocols WHERE id = ?').run(id);
}

// Convert a standalone routine_item into the first phase of a new protocol.
// Non-destructive: the routine_item keeps its id, so any daily_tasks already
// marked as completed continue pointing to the same row. A second blank phase
// (cloned from the first) is created so the user has something to edit.
function convertItemToProtocol(itemId, opts = {}) {
  const item = db.prepare('SELECT * FROM routine_items WHERE id = ?').get(itemId);
  if (!item) return null;
  if (item.protocol_id) {
    const err = new Error('Item is already a protocol phase');
    err.code = 'ALREADY_PHASE';
    throw err;
  }

  const name = (opts.name && opts.name.trim()) || item.title;
  const firstDur = Math.max(1, Math.min(3650, Number(opts.first_phase_duration) || 7));
  const secondDur = Math.max(1, Math.min(3650, Number(opts.second_phase_duration) || 7));
  const repeat = !!opts.repeat_indefinitely;
  const today = new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO protocols (name, start_date, repeat_indefinitely, active) VALUES (?, ?, ?, 1)'
    ).run(name, today, repeat ? 1 : 0);
    const protocolId = result.lastInsertRowid;

    // Phase 0: existing item becomes the first phase (id preserved → daily_tasks history kept)
    const firstEnd = addDays(today, firstDur - 1);
    db.prepare(
      'UPDATE routine_items SET protocol_id = ?, phase_order = 0, start_date = ?, end_date = ? WHERE id = ?'
    ).run(protocolId, today, firstEnd, itemId);

    // Phase 1: blank clone so the user has an editable row. If repeat=true this
    // is also the tail phase (end_date null). Otherwise closes after secondDur.
    const secondStart = addDays(today, firstDur);
    const secondEnd = repeat ? null : addDays(secondStart, secondDur - 1);
    db.prepare(`
      INSERT INTO routine_items (
        title, category, icon, sort_order, active, weekdays, periods,
        protocol_id, phase_order, start_date, end_date
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)
    `).run(
      item.title,
      item.category,
      item.icon,
      item.sort_order || 0,
      item.weekdays || '[0,1,2,3,4,5,6]',
      item.periods || '[]',
      protocolId,
      secondStart,
      secondEnd,
    );

    return protocolId;
  });

  const id = tx();
  return getProtocol(id);
}

// ═══ Daily Tasks ═══

function generateDailyTasks(date) {
  const items = getActiveItemsForGeneration();
  const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 0=Sun, 6=Sat

  const insert = db.prepare(
    'INSERT OR IGNORE INTO daily_tasks (routine_item_id, date) VALUES (?, ?)'
  );

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      // Check date window (protocol phases set start_date/end_date; standalone
      // items leave both NULL and are always in-window). Lexicographic compare
      // is correct because dates are YYYY-MM-DD.
      if (item.start_date && date < item.start_date) continue;
      if (item.end_date && date > item.end_date) continue;

      // Check weekday filter
      const weekdays = JSON.parse(item.weekdays || '[0,1,2,3,4,5,6]');
      if (!weekdays.includes(dayOfWeek)) continue;

      // Check if total count reached
      if (item.total_count && item.completed_count >= item.total_count) continue;

      insert.run(item.id, date);
    }
  });
  insertMany(items);
}

function getTasksForDate(date) {
  generateDailyTasks(date);

  return db.prepare(`
    SELECT
      dt.id,
      dt.routine_item_id,
      dt.date,
      dt.completed,
      dt.completed_at,
      ri.title,
      ri.category,
      ri.icon,
      ri.sort_order,
      ri.periods,
      ri.total_count,
      ri.completed_count,
      ri.alert_penultimate,
      ri.alert_last
    FROM daily_tasks dt
    JOIN routine_items ri ON ri.id = dt.routine_item_id
    WHERE dt.date = ? AND ri.active = 1
    ORDER BY ri.sort_order, ri.id
  `).all(date).map(task => {
    // Calculate alert status
    let alert = null;
    if (task.total_count) {
      const remaining = task.total_count - task.completed_count;
      if (remaining === 1 && task.alert_last) {
        alert = { type: 'last', message: task.alert_last };
      } else if (remaining === 2 && task.alert_penultimate) {
        alert = { type: 'penultimate', message: task.alert_penultimate };
      }
    }
    return { ...task, alert };
  });
}

function toggleTask(id) {
  const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
  if (!task) return null;

  const newCompleted = task.completed ? 0 : 1;
  const completedAt = newCompleted ? new Date().toISOString() : null;

  const toggle = db.transaction(() => {
    // Update daily task
    db.prepare('UPDATE daily_tasks SET completed = ?, completed_at = ? WHERE id = ?')
      .run(newCompleted, completedAt, id);

    // Update completed_count on routine item
    const delta = newCompleted ? 1 : -1;
    db.prepare('UPDATE routine_items SET completed_count = MAX(0, completed_count + ?) WHERE id = ?')
      .run(delta, task.routine_item_id);

    // Check if this completion triggers the follow-up
    if (newCompleted) {
      const item = db.prepare('SELECT * FROM routine_items WHERE id = ?').get(task.routine_item_id);
      if (item.total_count && item.completed_count >= item.total_count && item.followup_title) {
        // Create follow-up as a new one-time routine item
        db.prepare(`
          INSERT INTO routine_items (title, category, icon, sort_order, total_count)
          VALUES (?, ?, ?, ?, 1)
        `).run(
          item.followup_title,
          item.followup_category || item.category,
          item.followup_icon || '📌',
          item.sort_order + 0.5,
        );

        // Deactivate the completed routine item
        db.prepare('UPDATE routine_items SET active = 0 WHERE id = ?').run(item.id);
      }
    }
  });

  toggle();

  return db.prepare(`
    SELECT
      dt.id,
      dt.routine_item_id,
      dt.date,
      dt.completed,
      dt.completed_at,
      ri.title,
      ri.category,
      ri.icon,
      ri.sort_order,
      ri.periods,
      ri.total_count,
      ri.completed_count,
      ri.alert_penultimate,
      ri.alert_last
    FROM daily_tasks dt
    JOIN routine_items ri ON ri.id = dt.routine_item_id
    WHERE dt.id = ?
  `).get(id);
}

// ═══ Seed ═══

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as count FROM routine_items').get().count;
  if (count > 0) return;

  const items = [
    { title: 'Tomar Ritalina', category: 'medication', icon: '💊', sort_order: 1 },
    { title: 'Vitamina D', category: 'supplement', icon: '☀️', sort_order: 2 },
    { title: 'Ômega 3', category: 'supplement', icon: '🐟', sort_order: 3 },
    { title: 'Creatina', category: 'supplement', icon: '💪', sort_order: 4 },
    { title: 'Escovar os dentes', category: 'reminder', icon: '🪥', sort_order: 5 },
    { title: 'Beber água', category: 'reminder', icon: '💧', sort_order: 6 },
  ];

  for (const item of items) {
    createRoutineItem(item);
  }
}

module.exports = {
  db,
  getRoutineItems,
  getAllRoutineItems,
  createRoutineItem,
  updateRoutineItem,
  deactivateRoutineItem,
  deleteRoutineItemPermanently,
  getTasksForDate,
  toggleTask,
  seedIfEmpty,
  getSetting,
  setSetting,
  getAllSettings,
  getProtocols,
  getProtocol,
  createProtocol,
  updateProtocol,
  deleteProtocol,
  convertItemToProtocol,
};
