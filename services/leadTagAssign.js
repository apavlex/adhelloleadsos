/**
 * Lead tag assignment shared by /tags/assign, /tags/assign-bulk and Pavlex tag_leads:
 * save the lead's tag keys, then run the tag-add side effects (pipeline auto-advance,
 * Auto Outreach enrollment).
 */
const dbService = require('./database');
const { filterLeadsForRequest } = require('./workspaceService');
const { resolveLeadsBySelectedKeys } = require('./bulkSelectionKeys');
const { enrollLeadInAutoOutreach, AUTO_OUTREACH_TAG_NAME } = require('./prospectingEnroll');
const { buildPipelineAdvancePatch } = require('./pipelineAdvance');

async function tagNameMap(workspaceId) {
  const tags = await dbService.listTags(workspaceId);
  return new Map(tags.map((t) => [t.key, t.name || 'tag']));
}

function tagChangeSummary(names, added, removed) {
  const parts = [];
  if (added.length) parts.push(`Added ${added.map((k) => names.get(k) || 'tag').join(', ')}`);
  if (removed.length) parts.push(`Removed ${removed.map((k) => names.get(k) || 'tag').join(', ')}`);
  return parts.join(' · ');
}

async function maybeAdvanceOnTagAdd(workspaceId, lead) {
  if (!lead || !lead.key || !workspaceId) return lead;
  const patch = await buildPipelineAdvancePatch(lead, 'ADD_TAG', workspaceId);
  if (!patch || !Object.keys(patch).length) return lead;
  const updated = await dbService.updateLead(lead.key, patch, workspaceId);
  return updated || { ...lead, ...patch };
}

async function maybeEnrollAutoOutreachOnTagAdd(workspaceId, lead, addedTagKeys) {
  if (!lead || !lead.key || !Array.isArray(addedTagKeys) || !addedTagKeys.length) return null;
  const tags = await dbService.listTags(workspaceId);
  const autoTag = tags.find(
    (t) => String(t.name || '').trim().toLowerCase() === AUTO_OUTREACH_TAG_NAME,
  );
  if (!autoTag || !addedTagKeys.includes(autoTag.key)) return null;
  try {
    return await enrollLeadInAutoOutreach({
      leadKey: lead.key,
      workspaceId,
      reEnroll: false,
      tagLead: false,
    });
  } catch (e) {
    console.warn('[tags] auto-outreach enroll failed:', e && e.message);
    return null;
  }
}

function addedTagKeys(prev, next) {
  const before = new Set(dbService.normalizeTagKeys(prev));
  return dbService.normalizeTagKeys(next).filter((k) => !before.has(k));
}

/** mode add | remove | anything else = replace with tagKeys. */
function nextTagKeysForMode(prev, mode, tagKeys) {
  if (mode === 'add') return dbService.normalizeTagKeys([...prev, ...tagKeys]);
  if (mode === 'remove') {
    const remove = new Set(tagKeys);
    return prev.filter((t) => !remove.has(t));
  }
  return tagKeys;
}

/**
 * Persist nextTags on the lead and run tag-add side effects.
 * @returns {Promise<{ lead: object, added: string[], removed: string[] } | null>} null when the lead could not be saved
 */
async function saveLeadTagChange({ workspaceId, fullKey, prev, nextTags, mode }) {
  let lead = await dbService.setLeadTags(fullKey, nextTags, workspaceId);
  if (!lead) return null;
  const added = addedTagKeys(prev, nextTags);
  if (added.length) {
    lead = await maybeAdvanceOnTagAdd(workspaceId, lead);
  }
  if (mode === 'add' || added.length) {
    await maybeEnrollAutoOutreachOnTagAdd(workspaceId, lead, added);
    const refreshed = await dbService.getLead(fullKey, workspaceId);
    if (refreshed) lead = refreshed;
  }
  const removed = prev.filter((t) => !nextTags.includes(t));
  return { lead, added, removed };
}

async function tagsWithLeadCounts(req) {
  const tags = await dbService.listTags(req.workspaceId);
  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  const counts = new Map();
  visible.forEach((lead) => {
    dbService.normalizeTagKeys(lead && lead.tags).forEach((key) => {
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return tags.map((tag) => ({
    ...tag,
    leadCount: counts.get(tag.key) || 0,
  }));
}

async function resolveLeadsForTagAssign(req, leadKeysRaw) {
  const leadKeys = (Array.isArray(leadKeysRaw) ? leadKeysRaw : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  if (!leadKeys.length) return { leadKeys, matched: [] };

  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  const matched = await resolveLeadsBySelectedKeys({
    dbService,
    workspaceId: req.workspaceId,
    visibleLeads: visible,
    keyOrder: leadKeys,
  });
  return { leadKeys, matched };
}

function findMatchedLead(matched, rawKey) {
  return (
    matched.find((l) => {
      const k = String(l.key || '').trim();
      const norm = k.replace(/^lead:/i, '');
      const rawNorm = rawKey.replace(/^lead:/i, '');
      return k === rawKey || norm === rawNorm || `lead:${norm}` === rawKey || k === `lead:${rawNorm}`;
    }) || null
  );
}

async function storageKeyForLead(lead, workspaceId) {
  const raw = String((lead && lead.key) || '').trim();
  if (!raw) return '';
  return (await dbService.resolveLeadStorageKey(raw, workspaceId)) || raw;
}

module.exports = {
  tagNameMap,
  tagChangeSummary,
  addedTagKeys,
  nextTagKeysForMode,
  saveLeadTagChange,
  tagsWithLeadCounts,
  resolveLeadsForTagAssign,
  findMatchedLead,
  storageKeyForLead,
};
