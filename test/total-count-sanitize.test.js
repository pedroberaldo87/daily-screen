const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initSchema, sanitizeTotalCounts, createModel } = require('../model');

// Rows written before total_count was validated can hold markup or fractions
// (SQLite columns are loosely typed). The sanitiser nulls anything that is not
// an integer in 1..100000 and leaves valid values alone.

function seed() {
  const db = new Database(':memory:');
  initSchema(db);
  db.prepare("INSERT INTO templates (id, name, kind) VALUES (1, 'T', 'count')").run();
  const insPhase = db.prepare(
    "INSERT INTO phases (id, template_id, title, category, total_count) VALUES (?, 1, 'P', 'medication', ?)");
  const insSeries = db.prepare(
    "INSERT INTO series (id, template_id, phase_id, title, category, total_count) VALUES (?, 1, ?, 'S', 'medication', ?)");
  const values = [
    [1, '<img src=x onerror=alert(1)>'], // markup
    [2, 1.5],                            // fraction
    [3, 100001],                         // above range
    [4, -3],                             // negative
    [5, 0],                              // zero
    [6, 30],                             // valid
    [7, 100000],                         // valid, upper bound
    [8, null],                           // no count
  ];
  for (const [id, v] of values) {
    insPhase.run(id, v);
    insSeries.run(id, id, v);
  }
  return db;
}

const column = (db, table) => db.prepare(`SELECT id, total_count FROM ${table} ORDER BY id`).all().map((r) => r.total_count);

test('sanitizeTotalCounts nulls non-integer and out-of-range counts in phases and series', () => {
  const db = seed();
  sanitizeTotalCounts(db);
  const expected = [null, null, null, null, null, 30, 100000, null];
  assert.deepEqual(column(db, 'phases'), expected);
  assert.deepEqual(column(db, 'series'), expected);
});

test('sanitizeTotalCounts is idempotent and keeps valid counts', () => {
  const db = seed();
  sanitizeTotalCounts(db);
  const once = column(db, 'phases');
  sanitizeTotalCounts(db);
  assert.deepEqual(column(db, 'phases'), once);
});

test('createModel runs the sanitiser on startup', () => {
  const db = seed();
  createModel(db);
  assert.equal(db.prepare('SELECT total_count FROM phases WHERE id = 1').get().total_count, null);
  assert.equal(db.prepare('SELECT total_count FROM series WHERE id = 2').get().total_count, null);
});
