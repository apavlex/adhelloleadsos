/**
 * One-shot readonly worker for a heavy KV scan.
 * Terminated when the rows come back so it does not pin the process open.
 */
const path = require('path');
const { Worker } = require('worker_threads');

function queryRows(dbPath, sql, params) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'sqliteReadWorker.js'), {
      workerData: { dbPath },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('sqlite read timed out'));
    }, 45000);
    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(resolve, Array.isArray(msg.rows) ? msg.rows : []);
      else finish(reject, new Error((msg && msg.error) || 'sqlite read failed'));
    });
    worker.once('error', (err) => finish(reject, err));
    worker.postMessage({ id: 1, sql, params: params || [] });
  });
}

module.exports = { queryRows };
