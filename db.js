// Thin wrapper around the new data model (model.js). Opens the real DB, runs
// the one-time legacy→template/phase/series migration, builds the model, and
// re-exports functions under the names the routes expect — acting as the
// anti-corruption layer that keeps the external API/JSON contracts frozen while
// the schema underneath was redesigned. See .claude/plans/magical-waddling-wand.md.

const Database = require('better-sqlite3');
const path = require('path');
const { createModel, migrate } = require('./model');

const dbPath = process.env.DATABASE_PATH || './daily-screen.db';
const db = new Database(path.resolve(dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tables outside the task model (unchanged by the redesign).
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT,
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
`);

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

// Local clock (avoids circular require on lib/validators, which needs getSetting).
function todayDate() {
  const tz = getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo');
  const parts = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

// Run the legacy migration (idempotent) BEFORE building the model.
migrate(db, todayDate());
const model = createModel(db);

// ═══ Adapters: old names → new model (frozen shapes) ═══

function getTasksForDate(date) {
  model.concludeElapsedPhases(todayDate());
  model.generateDailyTasks(date);
  return model.getTasksView(date);
}
function toggleTask(id) {
  return model.toggleTask(id);
}
function recreateFromFollowup(dailyTaskId, today) {
  return model.recreateFromFollowup(dailyTaskId, today || todayDate());
}

function getAllRoutineItems() {
  return model.getItemsView();
}
function getRoutineItems() {
  return model.getItemsView().filter((i) => i.active);
}
function createRoutineItem(data) {
  return model.createItem({ ...data, start_date: data.start_date || todayDate() });
}
function updateRoutineItem(id, data) {
  return model.updateItem(id, data);
}
function deactivateRoutineItem(id) {
  model.deactivateItem(id);
}
function deleteRoutineItemPermanently(id) {
  model.deleteItemPermanently(id);
}
function convertItemToProtocol(id, opts = {}) {
  return model.convertItemToProtocol(id, { ...opts, today: todayDate() });
}

function getProtocols() {
  return model.getProtocolsView();
}
function getProtocol(id) {
  return model.getProtocolView(id);
}
function createProtocol(data) {
  return model.createProtocol(data);
}
function updateProtocol(id, data) {
  return model.updateProtocol(id, data);
}
function deleteProtocol(id) {
  model.deleteProtocol(id);
}

function getCompletedSeries() {
  return model.getCompletedView();
}

// ═══ Seed (default items on a fresh install) ═══

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as count FROM templates').get().count;
  if (count > 0) return;
  const items = [
    { title: 'Tomar Ritalina', category: 'medication', icon: '💊', sort_order: 1 },
    { title: 'Vitamina D', category: 'supplement', icon: '☀️', sort_order: 2 },
    { title: 'Ômega 3', category: 'supplement', icon: '🐟', sort_order: 3 },
    { title: 'Creatina', category: 'supplement', icon: '💪', sort_order: 4 },
    { title: 'Escovar os dentes', category: 'reminder', icon: '🪥', sort_order: 5 },
    { title: 'Beber água', category: 'reminder', icon: '💧', sort_order: 6 },
  ];
  for (const item of items) createRoutineItem(item);
}

// ═══ API Tokens (bearer auth for external integrations) ═══

function createApiToken({ name, tokenPrefix, tokenHash, expiresAt }) {
  const result = db.prepare(`
    INSERT INTO api_tokens (name, token_prefix, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(name, tokenPrefix, tokenHash, expiresAt || null);
  return db.prepare('SELECT id, name, token_prefix, created_at, last_used_at, revoked_at, expires_at FROM api_tokens WHERE id = ?').get(result.lastInsertRowid);
}
function getApiTokenByHash(tokenHash) {
  return db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(tokenHash);
}
function listApiTokens() {
  return db.prepare(`
    SELECT id, name, token_prefix, created_at, last_used_at, revoked_at, expires_at
    FROM api_tokens
    ORDER BY (revoked_at IS NOT NULL), id DESC
  `).all();
}
function touchApiToken(id) {
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
}
function revokeApiToken(id) {
  const result = db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
  return result.changes > 0;
}
function deleteApiToken(id) {
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
  return result.changes > 0;
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
  recreateFromFollowup,
  getCompletedSeries,
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
  createApiToken,
  getApiTokenByHash,
  listApiTokens,
  touchApiToken,
  revokeApiToken,
  deleteApiToken,
};
