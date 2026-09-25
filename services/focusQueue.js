/**
 * Ordering leads for Money Mode (single-lead outreach flow).
 */

const { scoreLeadRecord } = require('./opportunityScore');
const { scoreLocalProspect, prospectTierSortRank } = require('./localProspectScore');
const { isLeadDeferredForRetry } = require('./dialRetryPrefs');

function isOverdueCadence(l) {
  const st = l.sequenceState;
  if (!st || st.status !== 'active' || !st.nextDueAt) return false;
  return Date.parse(st.nextDueAt) < Date.now();
}

function lastActivityMs(l) {
  let max = 0;
  (l.updates || []).forEach((u) => {
    const t = Date.parse(u.timestamp || '');
    if (!Number.isNaN(t) && t > max) max = t;
  });
  (l.logs || []).forEach((log) => {
    const t = Date.parse(log.timestamp || '');
    if (!Number.isNaN(t) && t > max) max = t;
  });
  const fallback = Date.parse(l.savedAt || l.createdAt || '') || 0;
  return Math.max(max, fallback);
}

function stage2AgingOver3Days(l) {
  const ps = parseInt(l.pipelineStage, 10);
  if (ps !== 2) return false;
  const last = lastActivityMs(l);
  if (!last) return false;
  return Date.now() - last > 3 * 86400000;
}

/**
 * Precomputed sort tuple — scored once per lead (not once per comparator call).
 * @returns {{ bucket: number, a: number, b: number, c: number }}
 */
function sortKey(l, opts = {}) {
  const queueMode = opts.queueMode || 'continue_list';
  const last = lastActivityMs(l);
  const due = l.sequenceState && l.sequenceState.nextDueAt ? Date.parse(l.sequenceState.nextDueAt) : 0;
  const retryAt = l.nextActionAt ? Date.parse(l.nextActionAt) : Infinity;

  if (isLeadDeferredForRetry(l, queueMode)) {
    return { bucket: 6, a: retryAt, b: last, c: 0 };
  }
  if (isOverdueCadence(l)) {
    const { score } = scoreLeadRecord(l);
    const lpRank = prospectTierSortRank(scoreLocalProspect(l).prospectTier);
    return { bucket: 0, a: due, b: -score, c: lpRank };
  }

  const lp = scoreLocalProspect(l);
  const lpRank = prospectTierSortRank(lp.prospectTier);
  if (lp.prospectTier === 'Skip') {
    return { bucket: 5, a: 0, b: 0, c: lpRank };
  }
  if (stage2AgingOver3Days(l)) {
    return { bucket: 1, a: 0, b: last, c: lpRank };
  }

  const { score, tier } = scoreLeadRecord(l);
  if (tier === 'high') {
    return { bucket: 2, a: 0, b: -score, c: lpRank };
  }
  const ps = parseInt(l.pipelineStage, 10);
  const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
  if (n === 1) {
    return { bucket: 3, a: 0, b: last, c: lpRank };
  }
  return { bucket: 4, a: 0, b: last, c: lpRank };
}

/** Safety ceiling — early-stage action queues can be large; keep HTML/JSON bounded. */
const FOCUS_QUEUE_HARD_CAP = 5000;

/** Same early-stage rule as Today’s “leads queued for action” (stages 1–2). */
function isEarlyStageActionLead(l) {
  const ps = parseInt(l && l.pipelineStage, 10);
  const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
  return n <= 2;
}

function filterEarlyStageActionLeads(leads) {
  return (Array.isArray(leads) ? leads : []).filter(isEarlyStageActionLead);
}

/**
 * @param {object[]} leads — workspace-visible leads (e.g. after excludeOutreachFolderLeads)
 * @param {number} [cap]
 * @param {{ queueMode?: string, earlyStagesOnly?: boolean }} [opts]
 * @returns {object[]} same lead objects, ordered for Money Mode
 */
function buildFocusQueue(leads, cap = FOCUS_QUEUE_HARD_CAP, opts = {}) {
  const queueMode = opts.queueMode || 'continue_list';
  let list = Array.isArray(leads) ? [...leads] : [];
  if (opts.earlyStagesOnly) {
    list = list.filter(isEarlyStageActionLead);
  }
  if (queueMode === 'retry_when_due') {
    const now = Date.now();
    list = list.filter((l) => !isLeadDeferredForRetry(l, 'continue_list', now));
  }
  const keyed = list.map((lead) => ({ lead, key: sortKey(lead, opts) }));
  keyed.sort((x, y) => {
    const sx = x.key;
    const sy = y.key;
    if (sx.bucket !== sy.bucket) return sx.bucket - sy.bucket;
    if (sx.a !== sy.a) return sx.a - sy.a;
    if (sx.c !== sy.c) return sx.c - sy.c;
    return sx.b - sy.b;
  });
  const limit =
    Number.isFinite(cap) && cap > 0 ? Math.min(Math.floor(cap), FOCUS_QUEUE_HARD_CAP) : FOCUS_QUEUE_HARD_CAP;
  return keyed.slice(0, limit).map((row) => row.lead);
}

function shortLeadKey(l) {
  const k = String(l.key || '').trim();
  return k.startsWith('lead:') ? k.slice(5) : k;
}

module.exports = {
  buildFocusQueue,
  filterEarlyStageActionLeads,
  isEarlyStageActionLead,
  FOCUS_QUEUE_HARD_CAP,
  shortLeadKey,
  lastActivityMs,
  isOverdueCadence,
};
