/**
 * Readonly SQLite connection for lead-list scans.
 * Keeps the main thread free so menu HTML can render while a scan runs.
 */
const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const db = new Database(workerData.dbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 8000');
db.pragma('query_only = ON');

parentPort.on('message', (msg) => {
  const id = msg && msg.id;
  try {
    const params = Array.isArray(msg.params) ? msg.params : [];
    const rows = db.prepare(String(msg.sql || '')).all(...params);
    parentPort.postMessage({ id, ok: true, rows });
  } catch (e) {
    parentPort.postMessage({
      id,
      ok: false,
      error: (e && e.message) || String(e),
    });
  }
});
