/**
 * Ordering leads for Focus Mode (single-lead outreach flow).
 */

const { scoreLeadRecord } = require('./opportunityScore');
const { scoreLocalProspect, prospectTierSortRank } = require('./localProspectScore');

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

function priorityBucket(l) {
  if (isOverdueCadence(l)) return 0;
  const lp = scoreLocalProspect(l);
  if (lp.prospectTier === 'Skip') return 5;
  if (stage2AgingOver3Days(l)) return 1;
  const { tier } = scoreLeadRecord(l);
  if (tier === 'high') return 2;
  const ps = parseInt(l.pipelineStage, 10);
  const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
  if (n === 1) return 3;
  return 4;
}

function sortKey(l) {
  const lpRank = prospectTierSortRank(scoreLocalProspect(l).prospectTier);
  const { score } = scoreLeadRecord(l);
  const bucket = priorityBucket(l);
  const last = lastActivityMs(l);
  const due = l.sequenceState && l.sequenceState.nextDueAt ? Date.parse(l.sequenceState.nextDueAt) : 0;
  if (bucket === 0) return { bucket, a: due, b: -score, c: lpRank };
  if (bucket === 1) return { bucket, a: 0, b: last, c: lpRank };
  if (bucket === 2) return { bucket, a: 0, b: -score, c: lpRank };
  if (bucket === 3) return { bucket, a: 0, b: last, c: lpRank };
  if (bucket === 5) return { bucket, a: 0, b: 0, c: lpRank };
  return { bucket, a: 0, b: last, c: lpRank };
}

/**
 * @param {object[]} leads — workspace-visible leads (e.g. after excludeOutreachFolderLeads)
 * @param {number} cap
 * @returns {object[]} same lead objects, ordered for Focus Mode
 */
function buildFocusQueue(leads, cap = 200) {
  const list = Array.isArray(leads) ? [...leads] : [];
  list.sort((x, y) => {
    const sx = sortKey(x);
    const sy = sortKey(y);
    if (sx.bucket !== sy.bucket) return sx.bucket - sy.bucket;
    if (sx.a !== sy.a) return sx.a - sy.a;
    if (sx.c !== sy.c) return sx.c - sy.c;
    return sx.b - sy.b;
  });
  return list.slice(0, cap);
}

function shortLeadKey(l) {
  const k = String(l.key || '').trim();
  return k.startsWith('lead:') ? k.slice(5) : k;
}

module.exports = {
  buildFocusQueue,
  shortLeadKey,
  lastActivityMs,
  isOverdueCadence,
};
