/**
 * In-memory contact-hunt jobs (per lead key). Used so POST /enhance can return immediately
 * while BetterContact + Firecrawl run in the background (avoids proxy timeouts).
 */

const jobs = new Map();

function start(leadKey) {
  const key = String(leadKey || '').trim();
  if (!key) return false;
  const existing = jobs.get(key);
  if (existing && existing.status === 'processing') return false;
  jobs.set(key, { status: 'processing', startedAt: Date.now(), result: null, error: null });
  return true;
}

function finish(leadKey, result) {
  const key = String(leadKey || '').trim();
  if (!key) return;
  jobs.set(key, {
    status: 'done',
    startedAt: jobs.get(key)?.startedAt || Date.now(),
    finishedAt: Date.now(),
    result: result || { success: false, error: 'Contact hunt finished with no result.' },
  });
}

function fail(leadKey, error) {
  const key = String(leadKey || '').trim();
  if (!key) return;
  jobs.set(key, {
    status: 'error',
    startedAt: jobs.get(key)?.startedAt || Date.now(),
    finishedAt: Date.now(),
    error: String(error || 'Contact hunt failed.'),
  });
}

function get(leadKey) {
  const key = String(leadKey || '').trim();
  if (!key) return null;
  return jobs.get(key) || null;
}

function clear(leadKey) {
  const key = String(leadKey || '').trim();
  if (!key) return;
  jobs.delete(key);
}

module.exports = { start, finish, fail, get, clear };
