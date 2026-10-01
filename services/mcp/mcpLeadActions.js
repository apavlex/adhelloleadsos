/**
 * Pavlex lead actions — tags and GoHighLevel sync.
 * Each tool reuses the code path behind the matching app UI action and touches only ctx.workspaceId.
 */
const dbService = require('../database');
const workspaceIntegrations = require('../workspaceIntegrations');
const ghlClient = require('../ghlClient');
const ghlSync = require('../ghlSync');
const { triggerGhlProspectSync } = require('../ghlProspectSync');
const { filterLeadsForRequest } = require('../workspaceService');
const {
  tagNameMap,
  tagChangeSummary,
  saveLeadTagChange,
  tagsWithLeadCounts,
  resolveLeadsForTagAssign,
  findMatchedLead,
  storageKeyForLead,
} = require('../leadTagAssign');
const { buildReqLike } = require('./mcpCrmService');
const { recordActivity } = require('./mcpPavlexOps');

const MAX_TAG_LEADS = 100;
const MAX_TAG_NAMES = 20;
const MAX_TAG_NAME_LEN = 60;
const MAX_GHL_SYNC_LEADS = 50;
const GHL_SYNC_WAIT_MS = 30000;
const MAX_TRACKED_GHL_JOBS = 100;

function invalid(message, code = 'INVALID_ARGUMENT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireWorkspace(ctx) {
  const wid = String((ctx && ctx.workspaceId) || '').trim();
  if (!wid) throw invalid('A workspace is required.', 'UNAUTHORIZED');
  return wid;
}

function uniqueLeadIds(input, max, toolName) {
  const raw = Array.isArray(input.lead_ids) ? input.lead_ids : [];
  const ids = [...new Set(raw.map((k) => String(k || '').trim()).filter(Boolean))];
  if (!ids.length) throw invalid('lead_ids must be a non-empty array.');
  if (ids.length > max) throw invalid(`Maximum ${max} leads per ${toolName} call.`);
  return ids;
}

function cleanTagNames(raw) {
  const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const name = String(item || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_NAME_LEN);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

// ── Tags (same writes as POST /tags and /tags/assign(-bulk)) ─────────────────

async function listTags(ctx) {
  const wid = requireWorkspace(ctx);
  const tags = await tagsWithLeadCounts(buildReqLike(wid, ctx.userEmail));
  return {
    tags: tags.map((t) => ({
      key: t.key,
      name: t.name || '',
      color: t.color || '',
      isActive: t.isActive !== false,
      leadCount: t.leadCount || 0,
    })),
  };
}

/* dbService.createTag keys tags by Date.now(); two creates in the same millisecond collide. */
let lastTagCreateMs = 0;
async function nextTagTimestampSlot() {
  while (Date.now() <= lastTagCreateMs) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1));
  }
  lastTagCreateMs = Date.now();
}

function findTagByName(catalog, name) {
  const want = String(name || '').trim().toLowerCase();
  return catalog.find((t) => String(t.name || '').trim().toLowerCase() === want) || null;
}

async function tagLeads(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const leadIds = uniqueLeadIds(input, MAX_TAG_LEADS, 'tag_leads');
  const addNames = cleanTagNames(input.add);
  const removeNames = cleanTagNames(input.remove);
  if (!addNames.length && !removeNames.length) {
    throw invalid('Provide tag names to add and/or remove (add: ["Hot"], remove: ["Cold"]).');
  }
  if (addNames.length + removeNames.length > MAX_TAG_NAMES) {
    throw invalid(`Maximum ${MAX_TAG_NAMES} tag names per tag_leads call.`);
  }
  const clash = addNames.find((n) => removeNames.some((r) => r.toLowerCase() === n.toLowerCase()));
  if (clash) throw invalid(`"${clash}" is in both add and remove.`);

  const catalog = await dbService.listTags(wid);
  const addKeys = [];
  const createdTags = [];
  for (const name of addNames) {
    let tag = findTagByName(catalog, name);
    if (!tag) {
      // eslint-disable-next-line no-await-in-loop
      await nextTagTimestampSlot();
      // eslint-disable-next-line no-await-in-loop
      tag = await dbService.createTag(wid, name);
      catalog.push(tag);
      createdTags.push(tag.name);
      recordActivity(ctx, { category: 'tags', action: 'tag_create', summary: `Created tag "${tag.name}"` });
    }
    addKeys.push(tag.key);
  }
  const removeKeys = [];
  const unknownRemoveTags = [];
  for (const name of removeNames) {
    const tag = findTagByName(catalog, name);
    if (tag) removeKeys.push(tag.key);
    else unknownRemoveTags.push(name);
  }

  const reqLike = buildReqLike(wid, ctx.userEmail);
  const { matched } = await resolveLeadsForTagAssign(reqLike, leadIds);
  const names = await tagNameMap(wid);
  const mode = addKeys.length ? 'add' : 'remove';
  const removeSet = new Set(removeKeys);
  const results = [];
  const changedLeads = [];
  for (const rawId of leadIds) {
    const target = findMatchedLead(matched, rawId);
    // eslint-disable-next-line no-await-in-loop
    const fullKey = target ? await storageKeyForLead(target, wid) : '';
    // eslint-disable-next-line no-await-in-loop
    const existing = fullKey ? await dbService.getLead(fullKey, wid) : null;
    if (!existing) {
      results.push({ lead_id: rawId, success: false, error: 'Lead not found in this workspace.', code: 'NOT_FOUND' });
      continue;
    }
    const prev = dbService.normalizeTagKeys(existing.tags);
    const nextTags = dbService.normalizeTagKeys([...prev.filter((k) => !removeSet.has(k)), ...addKeys]);
    const title = existing.title || '';
    if (nextTags.length === prev.length && nextTags.every((k) => prev.includes(k))) {
      results.push({ lead_id: fullKey, title, success: true, unchanged: true, added: [], removed: [] });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const change = await saveLeadTagChange({ workspaceId: wid, fullKey, prev, nextTags, mode });
    if (!change) {
      results.push({ lead_id: fullKey, title, success: false, error: 'Could not save tags on lead.', code: 'ERROR' });
      continue;
    }
    changedLeads.push({ key: fullKey, title, change });
    results.push({
      lead_id: fullKey,
      title,
      success: true,
      added: change.added.map((k) => names.get(k) || 'tag'),
      removed: change.removed.map((k) => names.get(k) || 'tag'),
    });
  }

  if (changedLeads.length) {
    if (leadIds.length === 1) {
      const only = changedLeads[0];
      triggerGhlProspectSync(only.key, wid, { trigger: 'tag_assign' });
      recordActivity(ctx, {
        category: 'tags',
        action: 'lead_tags',
        summary: tagChangeSummary(names, only.change.added, only.change.removed),
        leadKey: only.key,
        leadTitle: only.title,
      });
    } else {
      const count = changedLeads.length;
      recordActivity(ctx, {
        category: 'tags',
        action: 'bulk_tags',
        summary: `${tagChangeSummary(names, addKeys, removeKeys)} on ${count} lead${count === 1 ? '' : 's'}`,
        leadKeys: changedLeads.map((l) => l.key),
        leadTitle: count === 1 ? changedLeads[0].title : null,
      });
    }
  }

  const ok = results.filter((r) => r.success).length;
  return {
    add: addNames,
    remove: removeNames,
    createdTags,
    unknownRemoveTags,
    changed: changedLeads.length,
    unchanged: ok - changedLeads.length,
    failed: results.length - ok,
    results,
  };
}

// ── GoHighLevel push (same path as the "Sync GHL" button → POST /ghl/push) ──

const ghlJobs = new Map();
let ghlWaitMs = GHL_SYNC_WAIT_MS;

function trimTrackedGhlJobs() {
  if (ghlJobs.size <= MAX_TRACKED_GHL_JOBS) return;
  for (const [id, job] of ghlJobs) {
    if (ghlJobs.size <= MAX_TRACKED_GHL_JOBS) break;
    if (job.status !== 'running') ghlJobs.delete(id);
  }
}

function ghlCounts(results) {
  const counts = { created: 0, updated: 0, skipped: 0, error: 0 };
  results.forEach((r) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  return counts;
}

function publicGhlJob(job) {
  return {
    job_id: job.id,
    status: job.status,
    total: job.total,
    processed: job.results.length,
    ...ghlCounts(job.results),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    results: job.results.slice(),
  };
}

async function pushOneLead(job, lead) {
  const hadContact = !!String(lead.ghlContactId || '').trim();
  const base = { lead_id: lead.key, title: lead.title || '' };
  try {
    const out = await ghlSync.pushLeads({
      workspaceId: job.workspaceId,
      integrationEnv: job.integrationEnv,
      leadKeys: [lead.key],
      syncedBy: job.syncedBy,
    });
    const r = out && out.results && out.results[0];
    if (!r) return { ...base, status: 'skipped', message: 'Lead not found.' };
    if (!r.ok) return { ...base, status: 'error', message: r.error || 'GHL sync failed.' };
    return {
      ...base,
      status: hadContact ? 'updated' : 'created',
      ghlContactId: r.ghlContactId || '',
      message: hadContact ? 'Updated the existing GHL contact.' : 'Created a new GHL contact.',
    };
  } catch (e) {
    return { ...base, status: 'error', message: (e && e.message) || 'GHL sync failed.' };
  }
}

async function runGhlJob(job, leads) {
  for (const lead of leads) {
    // eslint-disable-next-line no-await-in-loop
    job.results.push(await pushOneLead(job, lead));
  }
  job.status = 'completed';
  job.finishedAt = new Date().toISOString();
}

async function syncLeadsToGhl(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const leadIds = uniqueLeadIds(input, MAX_GHL_SYNC_LEADS, 'sync_leads_to_ghl');
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  if (!ghlClient.isConfigured(integrationEnv)) {
    throw invalid(
      "GoHighLevel isn't connected for this workspace. Add the GHL API key and Location ID under Workspace → Integrations, then try again.",
      'GHL_NOT_CONNECTED',
    );
  }

  const visible = filterLeadsForRequest(buildReqLike(wid, ctx.userEmail), await dbService.getAllLeads(wid));
  const byKey = new Map(visible.map((l) => [l.key, l]));
  const toPush = [];
  const skipped = [];
  const seen = new Set();
  for (const rawId of leadIds) {
    const norm = rawId.startsWith('lead:') ? rawId : `lead:${rawId}`;
    let lead = byKey.get(norm) || byKey.get(rawId);
    if (!lead) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await dbService.resolveLeadStorageKey(rawId, wid);
      if (resolved) lead = byKey.get(resolved);
    }
    if (!lead) {
      skipped.push({ lead_id: rawId, title: '', status: 'skipped', message: 'Lead not found in this workspace.' });
      continue;
    }
    if (seen.has(lead.key)) continue;
    seen.add(lead.key);
    toPush.push(lead);
  }

  const job = {
    id: `pavlex_ghl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: wid,
    integrationEnv,
    syncedBy: String(ctx.userEmail || '').trim().toLowerCase(),
    status: 'running',
    total: skipped.length + toPush.length,
    results: skipped,
    startedAt: new Date().toISOString(),
  };
  ghlJobs.set(job.id, job);
  trimTrackedGhlJobs();

  const run = runGhlJob(job, toPush).catch((e) => {
    job.status = 'failed';
    job.error = (e && e.message) || 'GHL sync failed.';
    job.finishedAt = new Date().toISOString();
  });
  let waitTimer;
  await Promise.race([
    run,
    new Promise((r) => {
      waitTimer = setTimeout(r, ghlWaitMs);
      if (typeof waitTimer.unref === 'function') waitTimer.unref();
    }),
  ]);
  clearTimeout(waitTimer);

  const out = publicGhlJob(job);
  if (job.status === 'running') {
    out.async = true;
    out.message = `Synced ${out.processed} of ${out.total} so far; the rest continue in the background. Check with get_ghl_sync_status.`;
  } else {
    out.message = `GHL sync done: ${out.created} created, ${out.updated} updated, ${out.skipped} skipped, ${out.error} failed.`;
  }
  if (job.error) out.error = job.error;
  return out;
}

async function getGhlSyncStatus(ctx, input = {}) {
  const wid = requireWorkspace(ctx);
  const id = String(input.job_id || '').trim();
  if (id) {
    const job = ghlJobs.get(id);
    if (!job || job.workspaceId !== wid) {
      return { job: null, message: 'Unknown GHL sync job (the server may have restarted).' };
    }
    return { job: publicGhlJob(job) };
  }
  const recent = [...ghlJobs.values()]
    .filter((j) => j.workspaceId === wid)
    .slice(-5)
    .reverse()
    .map((j) => {
      const { results, ...summary } = publicGhlJob(j);
      return summary;
    });
  return { jobs: recent };
}

function _resetGhlJobsForTests({ waitMs } = {}) {
  ghlJobs.clear();
  ghlWaitMs = waitMs != null ? waitMs : GHL_SYNC_WAIT_MS;
}

module.exports = {
  MAX_TAG_LEADS,
  MAX_GHL_SYNC_LEADS,
  listTags,
  tagLeads,
  syncLeadsToGhl,
  getGhlSyncStatus,
  _resetGhlJobsForTests,
};
