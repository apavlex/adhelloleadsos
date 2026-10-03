/**
 * express-session store on the app's SQLite file (Render persistent disk), so sign-ins
 * survive deploys and restarts. The default MemoryStore logged everyone out on every deploy.
 */
const session = require('express-session');

const DAY_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor({ db, ttlMs = 7 * DAY_MS, pruneEveryMs = 60 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    db.exec(`
      CREATE TABLE IF NOT EXISTS http_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS http_sessions_expires ON http_sessions (expires);
    `);
    this.stmt = {
      get: db.prepare('SELECT sess FROM http_sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare('INSERT INTO http_sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'),
      touch: db.prepare('UPDATE http_sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM http_sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM http_sessions WHERE expires <= ?'),
      clear: db.prepare('DELETE FROM http_sessions'),
      count: db.prepare('SELECT COUNT(*) AS c FROM http_sessions WHERE expires > ?'),
    };
    this.prune();
    if (pruneEveryMs > 0) {
      this.pruneTimer = setInterval(() => this.prune(), pruneEveryMs);
      if (this.pruneTimer.unref) this.pruneTimer.unref();
    }
  }

  expiresAt(sess) {
    const at = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(at) ? at : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.stmt.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.stmt.set.run(sid, JSON.stringify(sess), this.expiresAt(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this.stmt.touch.run(this.expiresAt(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.stmt.destroy.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  clear(cb = () => {}) {
    try {
      this.stmt.clear.run();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  length(cb) {
    try {
      cb(null, this.stmt.count.get(Date.now()).c);
    } catch (err) {
      cb(err);
    }
  }

  prune() {
    try {
      this.stmt.prune.run(Date.now());
    } catch (_) {
      /* pruning is best-effort */
    }
  }
}

module.exports = { SqliteSessionStore };
