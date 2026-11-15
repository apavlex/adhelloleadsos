/**
 * express-session store on the app's SQLite file (Render persistent disk), so sign-ins
 * survive deploys and restarts. The default MemoryStore logged everyone out on every deploy.
 *
 * touch() is throttled: express-session UPDATEs expires on every unmodified hop, and those
 * writes share the same SQLite connection as workspace/lead KV — starving menu navigation.
 */
const session = require('express-session');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOUCH_AFTER_MS = 5 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor({
    db,
    ttlMs = 7 * DAY_MS,
    pruneEveryMs = 60 * 60 * 1000,
    touchAfterMs = DEFAULT_TOUCH_AFTER_MS,
  } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.touchAfterMs = Math.max(0, Number(touchAfterMs) || 0);
    this._lastTouchAt = new Map();
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

  _isBusy(err) {
    const msg = String((err && err.message) || err || '');
    const code = String((err && (err.code || err.name)) || '');
    return /SQLITE_BUSY|database is locked|busy|locked/i.test(`${code} ${msg}`);
  }

  /**
   * Sync SQLite writers (saveWorkspace / updateLead) block the event loop AND
   * return SQLITE_BUSY to other statements. Retry briefly so Reviews/Q&A HTML
   * hops do not 500 / strand the nav spinner when Directory just wrote.
   */
  _withBusyRetry(fn, cb, attempt = 0) {
    try {
      return fn();
    } catch (err) {
      if (this._isBusy(err) && attempt < 8) {
        setTimeout(() => {
          try {
            this._withBusyRetry(fn, cb, attempt + 1);
          } catch (e2) {
            cb(e2);
          }
        }, Math.min(200, 15 * (attempt + 1)));
        return undefined;
      }
      cb(err);
      return undefined;
    }
  }

  get(sid, cb) {
    this._withBusyRetry(() => {
      const row = this.stmt.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    }, cb);
  }

  set(sid, sess, cb = () => {}) {
    this._withBusyRetry(() => {
      this.stmt.set.run(sid, JSON.stringify(sess), this.expiresAt(sess));
      this._lastTouchAt.set(String(sid), Date.now());
      cb(null);
    }, cb);
  }

  touch(sid, sess, cb = () => {}) {
    const key = String(sid || '');
    const now = Date.now();
    if (this.touchAfterMs > 0 && key) {
      const last = this._lastTouchAt.get(key) || 0;
      if (now - last < this.touchAfterMs) {
        cb(null);
        return;
      }
    }
    this._withBusyRetry(() => {
      this.stmt.touch.run(this.expiresAt(sess), sid);
      if (key) this._lastTouchAt.set(key, now);
      cb(null);
    }, cb);
  }

  destroy(sid, cb = () => {}) {
    try {
      this.stmt.destroy.run(sid);
      this._lastTouchAt.delete(String(sid || ''));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  clear(cb = () => {}) {
    try {
      this.stmt.clear.run();
      this._lastTouchAt.clear();
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
