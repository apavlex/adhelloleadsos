/**
 * Shared lead-search run progress math and hang-recovery helpers.
 * The UI eases 1–99% while a job is running and only hits 100% on complete/stale.
 */

const EST_MS = 3.5 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;
const ENRICH_BUDGET_MS = 90 * 1000;
const DIRECTORY_BUDGET_MS = 45 * 1000;
const PER_LEAD_ENRICH_MS = 20 * 1000;

function parseStartedAtMs(startedAt) {
  if (startedAt == null || startedAt === '') return NaN;
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) return startedAt;
  const ms = Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Time-based target 1–99% (eased so it slows near the end). Never 100 while running.
 * @param {string|number|null|undefined} startedAt
 * @param {number} [now]
 */
function computeLeadRunTargetPct(startedAt, now = Date.now()) {
  const startedMs = parseStartedAtMs(startedAt);
  if (!Number.isFinite(startedMs)) return 1;
  const elapsed = now - startedMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 1;
  const linear = Math.min(1, elapsed / EST_MS);
  const eased = 1 - Math.pow(1 - linear, 1.4);
  return Math.min(99, Math.max(1, Math.round(eased * 99)));
}

function isLeadRunJobStale(startedAt, now = Date.now()) {
  const startedMs = parseStartedAtMs(startedAt);
  if (!Number.isFinite(startedMs)) return false;
  return now - startedMs >= STALE_MS;
}

/**
 * Banner should leave "running" when the server job is done, or when the job is stale.
 * @param {{ isProcessing?: boolean, startedAt?: string|number|null, now?: number }} opts
 */
function shouldFinishLeadRunBanner(opts = {}) {
  if (!opts.isProcessing) return true;
  return isLeadRunJobStale(opts.startedAt, opts.now != null ? opts.now : Date.now());
}

/**
 * Display percent: 1–99 while running, 100 once complete or stale.
 */
function resolveLeadRunDisplayPct(opts = {}) {
  if (opts.complete === true || shouldFinishLeadRunBanner(opts)) return 100;
  return computeLeadRunTargetPct(opts.startedAt, opts.now != null ? opts.now : Date.now());
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Math.max(1, Number(ms) || 1);
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label || 'step'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Run a trailing step; on timeout/failure return the original value so search can complete.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {T} fallback
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<{ value: T, timedOut: boolean, error: string|null }>}
 */
async function runBestEffort(fn, fallback, timeoutMs, label) {
  try {
    const value = await withTimeout(Promise.resolve().then(fn), timeoutMs, label);
    return { value, timedOut: false, error: null };
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err || 'failed');
    const timedOut = /timed out/i.test(message);
    return { value: fallback, timedOut, error: message };
  }
}

module.exports = {
  EST_MS,
  STALE_MS,
  ENRICH_BUDGET_MS,
  DIRECTORY_BUDGET_MS,
  PER_LEAD_ENRICH_MS,
  computeLeadRunTargetPct,
  isLeadRunJobStale,
  shouldFinishLeadRunBanner,
  resolveLeadRunDisplayPct,
  withTimeout,
  runBestEffort,
};
