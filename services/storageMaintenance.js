/**
 * Keeps the SQLite volume (2 GB on Render) from filling up: one rolling backup instead of a
 * full copy per integrations save, WAL truncation, and retention for rows that only matter briefly.
 */

const fs = require('fs');
const path = require('path');
const dbService = require('./database');

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_RE = /^app\.db\.backup-(.+?)(-wal|-shm)?$/;
const BACKUP_MIN_INTERVAL_MS = DAY_MS;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function retentionDays(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dbDir() {
  return path.dirname(dbService.getDbPath());
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function diskSpace(dir = dbDir()) {
  try {
    const s = fs.statfsSync(dir);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { totalBytes: 0, freeBytes: Infinity };
  }
}

function dbBytes() {
  const p = dbService.getDbPath();
  return fileSize(p) + fileSize(`${p}-wal`);
}

/** Backups grouped by stamp, newest first: [{ stamp, files: [abs paths], bytes, mtimeMs }]. */
function listBackups(dir = dbDir()) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const groups = new Map();
  for (const name of names) {
    const m = BACKUP_RE.exec(name);
    if (!m) continue;
    const abs = path.join(dir, name);
    const g = groups.get(m[1]) || { stamp: m[1], files: [], bytes: 0, mtimeMs: 0 };
    g.files.push(abs);
    g.bytes += fileSize(abs);
    try {
      g.mtimeMs = Math.max(g.mtimeMs, fs.statSync(abs).mtimeMs);
    } catch {
      /* gone */
    }
    groups.set(m[1], g);
  }
  return [...groups.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Keep the newest `keep` backups; drop them all when the disk has less free space than the DB. */
function pruneBackups({ keep = 1, dir = dbDir() } = {}) {
  const backups = listBackups(dir);
  const tight = diskSpace(dir).freeBytes < dbBytes();
  const doomed = backups.slice(tight ? 0 : keep);
  let freed = 0;
  for (const g of doomed) {
    for (const f of g.files) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
    freed += g.bytes;
  }
  return { removed: doomed.length, freedBytes: freed, kept: backups.length - doomed.length };
}

/**
 * At most one consistent online backup per day, only when there is room for it, replacing the old one.
 * Resolves to the backup path, or null when skipped.
 */
async function rollingBackup({ now = Date.now(), dir = dbDir() } = {}) {
  const newest = listBackups(dir)[0];
  if (newest && now - newest.mtimeMs < BACKUP_MIN_INTERVAL_MS) return null;
  const need = dbBytes() * 2;
  if (diskSpace(dir).freeBytes < need) {
    pruneBackups({ keep: 0, dir });
    if (diskSpace(dir).freeBytes < need) return null;
  }
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `app.db.backup-${stamp}`);
  try {
    await dbService.getSqlite().backup(dest);
  } catch (e) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* nothing written */
    }
    throw e;
  }
  pruneBackups({ keep: 1, dir });
  return dest;
}

function checkpointWal() {
  try {
    const [row] = dbService.getSqlite().pragma('wal_checkpoint(TRUNCATE)');
    return row || null;
  } catch {
    return null;
  }
}

function ymdDaysAgo(days, now = Date.now()) {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

/** Delete rows that are only useful for a short time. Returns { [rule]: deletedCount }. */
function pruneExpiredRows(now = Date.now()) {
  const db = dbService.getSqlite();
  const out = {};
  const run = (name, sql, ...args) => {
    try {
      out[name] = db.prepare(sql).run(...args).changes;
    } catch (e) {
      out[name] = `error: ${e.message}`;
    }
  };
  run(
    'visits',
    "DELETE FROM kv WHERE key GLOB 'visit:[0-9]*' AND CAST(substr(key, 7) AS INTEGER) < ?",
    now - retentionDays('VISIT_RETENTION_DAYS', 180) * DAY_MS,
  );
  run(
    'morningBriefs',
    "DELETE FROM kv WHERE key LIKE 'morningBrief:%' AND key GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(key, -10) < ?",
    ymdDaysAgo(retentionDays('MORNING_BRIEF_RETENTION_DAYS', 30), now),
  );
  run(
    'publicDemoCounters',
    "DELETE FROM kv WHERE (key LIKE 'publicDemo:launches:%' OR key LIKE 'publicDemo:ai:%') AND substr(key, -10) < ?",
    ymdDaysAgo(14, now),
  );
  run('oauthCodes', "DELETE FROM kv WHERE key LIKE 'oauthcode:%' AND updated_at < datetime('now', '-1 day')");
  return out;
}

function sumDirBytes(dir, depth = 2) {
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) total += depth > 0 ? sumDirBytes(abs, depth - 1) : 0;
    else total += fileSize(abs);
  }
  return total;
}

/** What is using the volume: files, SQLite pages, and the biggest KV key prefixes and tables. */
function storageReport({ topPrefixes = 25 } = {}) {
  const db = dbService.getSqlite();
  const dir = dbDir();
  const dbPath = dbService.getDbPath();
  const pragma = (name) => {
    try {
      return db.pragma(name, { simple: true });
    } catch {
      return null;
    }
  };
  const pageSize = pragma('page_size') || 4096;
  const files = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      files.push({ name: e.name + (e.isDirectory() ? '/' : ''), bytes: e.isDirectory() ? sumDirBytes(abs) : fileSize(abs) });
    }
  } catch {
    /* unreadable */
  }
  files.sort((a, b) => b.bytes - a.bytes);

  let prefixes = [];
  try {
    prefixes = db
      .prepare(
        `SELECT CASE WHEN instr(key, ':') > 0 THEN substr(key, 1, instr(key, ':') - 1) ELSE key END AS prefix,
                COUNT(*) AS rows, SUM(length(value)) AS bytes
         FROM kv GROUP BY prefix ORDER BY bytes DESC LIMIT ?`,
      )
      .all(topPrefixes);
  } catch {
    /* empty db */
  }

  const tables = [];
  for (const t of ['kv', 'chat_messages', 'team_activity', 'lead_attribution', 'outbound_messages', 'outbound_campaigns']) {
    try {
      tables.push({ table: t, rows: db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c });
    } catch {
      /* table missing */
    }
  }
  try {
    const sizes = db.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE aggregate = TRUE GROUP BY name").all();
    const byName = new Map(sizes.map((r) => [r.name, r.bytes]));
    tables.forEach((t) => {
      if (byName.has(t.table)) t.bytes = byName.get(t.table);
    });
  } catch {
    /* dbstat not compiled in */
  }

  return {
    disk: diskSpace(dir),
    db: {
      path: dbPath,
      bytes: fileSize(dbPath),
      walBytes: fileSize(`${dbPath}-wal`),
      freePageBytes: (pragma('freelist_count') || 0) * pageSize,
    },
    backups: listBackups(dir).map((g) => ({ stamp: g.stamp, bytes: g.bytes })),
    files,
    prefixes,
    tables,
  };
}

function mb(n) {
  return `${Math.round((Number(n) || 0) / 1048576)}MB`;
}

async function runMaintenance({ reason = 'scheduled' } = {}) {
  const pruned = pruneBackups({ keep: 1 });
  const expired = pruneExpiredRows();
  const wal = checkpointWal();
  const space = diskSpace();
  console.log(
    `[storage] ${reason}: removed ${pruned.removed} backup(s) (${mb(pruned.freedBytes)}), expired rows ${JSON.stringify(expired)}, ` +
      `wal checkpoint ${wal ? `${wal.checkpointed}/${wal.log}` : 'n/a'}, db ${mb(dbBytes())}, free ${mb(space.freeBytes)} of ${mb(space.totalBytes)}`,
  );
  return { pruned, expired, wal, space };
}

let timer = null;
function startStorageMaintenance() {
  if (timer || process.env.NODE_ENV === 'test') return;
  const tick = (reason) => {
    runMaintenance({ reason }).catch((e) => console.warn('[storage] maintenance failed:', e.message));
  };
  setTimeout(() => {
    tick('startup');
    try {
      const r = storageReport({ topPrefixes: 8 });
      console.log(`[storage] biggest key prefixes: ${r.prefixes.map((p) => `${p.prefix} ${mb(p.bytes)} (${p.rows})`).join(', ')}`);
    } catch (e) {
      console.warn('[storage] report failed:', e.message);
    }
  }, 15000).unref();
  timer = setInterval(() => tick('scheduled'), MAINTENANCE_INTERVAL_MS);
  timer.unref();
}

module.exports = {
  listBackups,
  pruneBackups,
  rollingBackup,
  checkpointWal,
  pruneExpiredRows,
  storageReport,
  runMaintenance,
  startStorageMaintenance,
  diskSpace,
};
