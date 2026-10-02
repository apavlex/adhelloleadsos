const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-maint-'));
process.env.APP_DATA_DIR = dir;

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const storage = require('../services/storageMaintenance');

function fakeBackup(stamp, ageMs, withWal = true) {
  const base = path.join(dir, `app.db.backup-${stamp}`);
  const when = new Date(Date.now() - ageMs);
  for (const f of withWal ? [base, `${base}-wal`, `${base}-shm`] : [base]) {
    fs.writeFileSync(f, 'x'.repeat(1000));
    fs.utimesSync(f, when, when);
  }
}

test('pruneBackups keeps only the newest backup (and its -wal/-shm files)', () => {
  fakeBackup('2026-09-01T00-00-00-000Z', 30 * 86400000);
  fakeBackup('2026-09-20T00-00-00-000Z', 10 * 86400000);
  fakeBackup('2026-09-30T00-00-00-000Z', 1 * 86400000);
  const out = storage.pruneBackups({ keep: 1 });
  assert.equal(out.removed, 2);
  assert.equal(out.freedBytes, 6000);
  const left = fs.readdirSync(dir).filter((n) => n.includes('.backup-')).sort();
  assert.deepEqual(left, [
    'app.db.backup-2026-09-30T00-00-00-000Z',
    'app.db.backup-2026-09-30T00-00-00-000Z-shm',
    'app.db.backup-2026-09-30T00-00-00-000Z-wal',
  ]);
});

test('rollingBackup: skipped when a recent backup exists, otherwise replaces it with a readable copy', async () => {
  dbService.getSqlite().prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('workspace:w1', '{\"id\":\"w1\"}')").run();
  fakeBackup('recent', 60 * 60 * 1000, false);
  assert.equal(await storage.rollingBackup(), null);

  const dest = await storage.rollingBackup({ now: Date.now() + 2 * 86400000 });
  assert.ok(dest && fs.existsSync(dest));
  const Database = require('better-sqlite3');
  const copy = new Database(dest, { readonly: true });
  assert.equal(copy.prepare("SELECT value FROM kv WHERE key = 'workspace:w1'").get().value, '{"id":"w1"}');
  copy.close();
  assert.equal(storage.listBackups().length, 1, 'older backups removed');
});

test('pruneExpiredRows drops old visits / briefs / demo counters and keeps recent ones', () => {
  const db = dbService.getSqlite();
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const now = Date.now();
  const ymd = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString().slice(0, 10);
  put.run(`visit:${now - 400 * 86400000}`, '{}');
  put.run(`visit:${now - 5 * 86400000}`, '{}');
  put.run(`morningBrief:ws1:${ymd(90)}`, '{}');
  put.run(`morningBrief:ws1:${ymd(2)}`, '{}');
  put.run(`publicDemo:launches:${ymd(40)}`, '3');
  put.run(`publicDemo:ai:${ymd(1)}`, '3');
  put.run('morningBrief:ws1:not-a-date', '{}');

  const out = storage.pruneExpiredRows(now);
  assert.equal(out.visits, 1);
  assert.equal(out.morningBriefs, 1);
  assert.equal(out.publicDemoCounters, 1);
  const keys = db.prepare('SELECT key FROM kv').all().map((r) => r.key);
  assert.ok(keys.includes(`visit:${now - 5 * 86400000}`));
  assert.ok(keys.includes(`morningBrief:ws1:${ymd(2)}`));
  assert.ok(keys.includes('morningBrief:ws1:not-a-date'));
  assert.ok(keys.includes(`publicDemo:ai:${ymd(1)}`));
});

test('storageReport lists files, backups and the biggest key prefixes', () => {
  dbService.getSqlite().prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('search:big', 'y'.repeat(50000));
  const r = storage.storageReport();
  assert.equal(r.prefixes[0].prefix, 'search');
  assert.ok(r.prefixes[0].bytes >= 50000);
  assert.ok(r.files.some((f) => f.name === 'app.db'));
  assert.ok(r.db.bytes > 0);
  assert.ok(r.tables.some((t) => t.table === 'kv' && t.rows > 0));
});
