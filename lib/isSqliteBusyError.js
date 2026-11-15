/**
 * True only for real SQLite writer contention — not "blocked", "ENOTLOCKED", etc.
 * 1.0.775 matched any message containing "busy" or "locked", which falsely 503/stubbed
 * Engagement, Reviews, Q&A (and other light hops).
 */
function isSqliteBusyError(err) {
  if (!err) return false;
  const code = String(err.code || err.name || '');
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true;
  const msg = String(err.message || err || '');
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(`${code} ${msg}`);
}

module.exports = { isSqliteBusyError };
