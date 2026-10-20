/**
 * Find duplicate lead groups and merge them in bulk (one primary per group).
 */

const { computeDedupeKey } = require('./leadDedupe');
const { mergeLeadsByKeys } = require('./leadMerge');

function fieldFillScore(lead) {
  if (!lead || typeof lead !== 'object') return 0;
  const fields = [
    'phone',
    'email',
    'website',
    'address',
    'city',
    'state',
    'url',
    'instagram',
    'facebook',
    'linkedin',
  ];
  let score = 0;
  for (const f of fields) {
    const v = String(lead[f] || '').trim();
    if (v && v.toLowerCase() !== 'n/a') score += 1;
  }
  if (Array.isArray(lead.contacts)) score += Math.min(3, lead.contacts.length);
  if (Array.isArray(lead.tags)) score += Math.min(2, lead.tags.length);
  const reviews = parseInt(lead.reviewsCount || lead.reviews, 10) || 0;
  if (reviews > 0) score += 1;
  return score;
}

function pickPrimaryLead(list) {
  const ranked = [...(list || [])].sort((a, b) => {
    const fillDiff = fieldFillScore(b) - fieldFillScore(a);
    if (fillDiff) return fillDiff;
    const aAt = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const bAt = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return bAt - aAt;
  });
  return ranked[0] || null;
}

/**
 * @param {object[]} leads
 * @param {{ limit?: number }} [opts]
 * @returns {{ matchKey: string, matchedOn: string, leads: object[] }[]}
 */
function findDuplicateGroups(leads, opts) {
  const limit = Math.min(100, Math.max(1, parseInt(opts && opts.limit, 10) || 50));
  const groups = new Map();
  for (const lead of leads || []) {
    const key = computeDedupeKey(lead);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([matchKey, list]) => ({
      matchKey,
      matchedOn: String(matchKey).split(':')[0] || 'unknown',
      leads: list,
    }));
}

/**
 * Merge every duplicate group found in the given lead list.
 * @returns {Promise<{ success: boolean, groupsFound: number, groupsMerged: number, leadsMergedAway: number, errors: string[] }>}
 */
async function mergeAllDuplicateGroups({ dbService, workspaceId, leads, limit }) {
  const groups = findDuplicateGroups(leads, { limit: limit || 50 });
  let groupsMerged = 0;
  let leadsMergedAway = 0;
  const errors = [];

  for (const group of groups) {
    const primary = pickPrimaryLead(group.leads);
    if (!primary) continue;
    const keys = group.leads.map((l) => l.key).filter(Boolean);
    if (keys.length < 2) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await mergeLeadsByKeys({
        dbService,
        workspaceId,
        keys,
        primaryKey: primary.key,
      });
      if (!result.success) {
        errors.push(result.error || 'Merge failed');
        continue;
      }
      groupsMerged += 1;
      leadsMergedAway += Number(result.mergedCount) || 0;
    } catch (e) {
      errors.push((e && e.message) || 'Merge failed');
    }
  }

  return {
    success: errors.length === 0 || groupsMerged > 0,
    groupsFound: groups.length,
    groupsMerged,
    leadsMergedAway,
    errors,
  };
}

module.exports = {
  findDuplicateGroups,
  pickPrimaryLead,
  fieldFillScore,
  mergeAllDuplicateGroups,
};
