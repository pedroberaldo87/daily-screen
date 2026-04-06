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

function getRoutineItems() {
  return db.prepare('SELECT * FROM routine_items WHERE active = 1 ORDER BY sort_order, id').all();
}

function getAllRoutineItems() {
  return db.prepare('SELECT * FROM routine_items ORDER BY active DESC, sort_order, id').all();
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

  const stmt = db.prepare(`
    UPDATE routine_items
    SET title = ?, category = ?, icon = ?, sort_order = ?, active = ?,
        weekdays = ?, periods = ?, total_count = ?, completed_count = ?,
        alert_penultimate = ?, alert_last = ?,
        followup_title = ?, followup_category = ?, followup_icon = ?
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

// ═══ Daily Tasks ═══

function generateDailyTasks(date) {
  const items = getRoutineItems();
  const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 0=Sun, 6=Sat

  const insert = db.prepare(
    'INSERT OR IGNORE INTO daily_tasks (routine_item_id, date) VALUES (?, ?)'
  );

  const insertMany = db.transaction((items) => {
    for (const item of items) {
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
};
