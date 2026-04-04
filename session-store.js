const session = require('express-session');
const Store = session.Store;

class SQLiteStore extends Store {
  constructor(db, options = {}) {
    super(options);
    this.db = db;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days default

    // Create sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
    `);

    // Prepared statements
    this._get = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
    this._set = this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)');
    this._destroy = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._cleanup = this.db.prepare('DELETE FROM sessions WHERE expired <= ?');

    // Cleanup expired sessions every hour
    this._cleanupInterval = setInterval(() => this._cleanup.run(Date.now()), 60 * 60 * 1000);
  }

  get(sid, callback) {
    try {
      const row = this._get.get(sid, Date.now());
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || this.ttl * 1000;
      const expired = Date.now() + maxAge;
      this._set.run(sid, JSON.stringify(sess), expired);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this._destroy.run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = SQLiteStore;
