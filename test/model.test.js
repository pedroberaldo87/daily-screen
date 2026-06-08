const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createModel } = require('../model');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('schema cria as tabelas do novo modelo', () => {
  const db = freshDb();
  createModel(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ['templates', 'phases', 'series', 'daily_tasks']) {
    assert.ok(tables.includes(t), `tabela ${t} deveria existir`);
  }
});

test('daily_tasks aponta para series_id (não routine_item_id)', () => {
  const db = freshDb();
  createModel(db);
  const cols = db
    .prepare('PRAGMA table_info(daily_tasks)')
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes('series_id'), 'daily_tasks deve ter series_id');
  assert.ok(!cols.includes('routine_item_id'), 'daily_tasks não deve ter routine_item_id');
});
