/**
 * Push prospecting actions from AdHello to GHL (tags + notes) for closed-loop follow-up.
 */

const dbService = require('./database');
const ghlClient = require('./ghlClient');
const { allowsGhlPush, getWorkspaceGhlSyncDirection } = require('./ghlSyncDirection');
const workspaceIntegrations = require('./workspaceIntegrations');
const { mergeTagLists } = require('./ghlSyncHelpers');
const {
  computeActionTagsFromLead,
  formatNextActionNote,
  isActionTag,
} = require('./ghlActionTags');
const { quickLogItemForDisposition } = require('./quickLogConfig');

function normalizeLeadStorageKey(leadKey) {
  const k = String(leadKey || '').trim();
  if (!k) return '';
  return k.startsWith('lead:') ? k : `lead:${k}`;
}

/**
 * Persist quick-log disposition on a lead before GHL push (tags derive from lastDisposition).
 * @param {{ leadKey: string, code: string, notes?: string, workspaceId: string }} opts
 */
async function patchLeadDispositionForGhlPush(opts) {
  const code = String(opts.code || '').trim().toLowerCase();
  const workspaceId = opts.workspaceId || 'default';
  if (!opts.leadKey || !code) return { skipped: true, reason: 'missing_fields' };

  const storageKey =
    (await dbService.resolveLeadStorageKey(opts.leadKey, workspaceId)) ||
    normalizeLeadStorageKey(opts.leadKey);
  if (!storageKey) return { skipped: true, reason: 'lead_not_found' };

  const item = quickLogItemForDisposition(code);
  if (!item) return { skipped: true, reason: 'unknown_disposition' };

  const existing = await dbService.getLead(storageKey);
  if (!existing) return { skipped: true, reason: 'lead_not_found' };

  const notes = String(opts.notes || '').trim();
  const patch = {
    lastDisposition: code,
    lastDispositionAt: new Date().toISOString(),
  };
  if (notes) patch.lastDispositionNotes = notes.slice(0, 2000);
  if (item.status) patch.status = item.status;

  const updated = await dbService.updateLead(storageKey, patch, workspaceId);
  return { ok: true, lead: updated, code, key: storageKey };
}

function appendLeadPanelUpdate(existing, entry) {
  const updates = Array.isArray(existing && existing.updates) ? [...existing.updates] : [];
  updates.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  return updates;
}

/**
 * Save an unposted panel note on the lead before GHL push (included in note sync).
 * @param {{ leadKey: string, content: string, workspaceId: string }} opts
 */
async function appendPanelNoteBeforeGhlPush(opts) {
  const content = String(opts.content || '').trim();
  const workspaceId = opts.workspaceId || 'default';
  if (!opts.leadKey || !content) return { skipped: true, reason: 'missing_fields' };

  const storageKey =
    (await dbService.resolveLeadStorageKey(opts.leadKey, workspaceId)) ||
    normalizeLeadStorageKey(opts.leadKey);
  if (!storageKey) return { skipped: true, reason: 'lead_not_found' };

  const existing = await dbService.getLead(storageKey);
  if (!existing) return { skipped: true, reason: 'lead_not_found' };

  const updates = appendLeadPanelUpdate(existing, {
    type: 'note',
    value: content,
    source: 'panel_post',
  });
  const updated = await dbService.updateLead(storageKey, { updates }, workspaceId);
  return { ok: true, lead: updated, key: storageKey };
}

/**
 * Map GHL tag names to workspace tag keys (by catalog name). Keeps existing keys and
 * non-catalog strings that are already on the lead.
 */
async function resolveGhlTagNamesToLeadKeys(workspaceId, ghlTagNames, localTags = []) {
  const catalog = await dbService.listTags(workspaceId);
  const byNameLower = new Map(
    catalog.map((t) => [String(t.name || '').trim().toLowerCase(), t.key]),
  );
  const merged = dbService.normalizeTagKeys([
    ...(Array.isArray(localTags) ? localTags : []),
    ...(Array.isArray(ghlTagNames) ? ghlTagNames : []),
  ]);
  const out = [];
  for (const item of merged) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    if (raw.startsWith('tag:')) {
      if (!out.includes(raw)) out.push(raw);
      continue;
    }
    if (isActionTag(raw)) continue;
    const key = byNameLower.get(raw.toLowerCase());
    if (key) {
      if (!out.includes(key)) out.push(key);
    } else if (!out.includes(raw)) {
      out.push(raw);
    }
  }
  return dbService.normalizeTagKeys(out);
}

async function resolveLeadTagNamesForGhl(workspaceId, lead) {
  const catalog = await dbService.listTags(workspaceId);
  const byKey = new Map(catalog.map((t) => [t.key, t.name]));
  const userNames = (Array.isArray(lead.tags) ? lead.tags : [])
    .map((k) => {
      const key = String(k || '').trim();
      if (!key) return '';
      if (byKey.has(key)) return byKey.get(key);
      if (key.startsWith('tag:')) return '';
      return key;
    })
    .filter(Boolean);
  const actionTags = computeActionTagsFromLead(lead);
  return mergeTagLists(userNames, actionTags);
}

/**
 * @param {object} lead
 * @param {string} workspaceId
 */
async function prepareLeadForGhlPush(lead, workspaceId) {
  const actionTags = computeActionTagsFromLead(lead);
  const ghlTagNamesForPush = await resolveLeadTagNamesForGhl(workspaceId, lead);
  return {
    ...lead,
    ghlActionTags: actionTags,
    ghlTagNamesForPush,
  };
}

/**
 * Sync one lead's prospecting state to GHL (contact upsert + action tags + optional note).
 * @param {{ leadKey: string, workspaceId: string, note?: string, trigger?: string }} opts
 */
async function syncLeadProspectActionToGhl(opts) {
  const leadKey = String(opts.leadKey || '').trim();
  const workspaceId = opts.workspaceId || 'default';
  if (!leadKey) throw new Error('leadKey is required');

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  if (!ghlClient.isConfigured(integrationEnv)) {
    return { skipped: true, reason: 'ghl_not_configured' };
  }

  const ws = await dbService.getWorkspace(workspaceId);
  const syncDirection = getWorkspaceGhlSyncDirection(ws);
  if (!allowsGhlPush(syncDirection)) {
    return { skipped: true, reason: 'ghl_sync_direction_pull_only', syncDirection };
  }

  const fullKey = leadKey.startsWith('lead:') ? leadKey : `lead:${leadKey}`;
  let lead = await dbService.getLead(fullKey);
  if (!lead) return { skipped: true, reason: 'lead_not_found' };

  const actionTags = computeActionTagsFromLead(lead);
  const patch = {
    ghlActionTags: actionTags,
    ghlActionSyncedAt: new Date().toISOString(),
  };
  if (opts.trigger) patch.ghlLastSyncTrigger = String(opts.trigger).slice(0, 64);

  lead = await dbService.updateLead(fullKey, patch, workspaceId);
  const prepared = await prepareLeadForGhlPush(lead, workspaceId);

  const noteBody = String(opts.note || '').trim() || formatNextActionNote(prepared);
  if (noteBody) {
    prepared.logs = [
      ...(Array.isArray(prepared.logs) ? prepared.logs : []),
      {
        type: 'ghl_action',
        message: noteBody,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  // Lazy require: ghlProspectSync ↔ ghlSync is circular at load time.
  const ghlSync = require('./ghlSync');
  const result = await ghlSync.pushLeadToGhl(prepared, integrationEnv);
  return {
    ok: true,
    ghlContactId: result.ghlContactId,
    actionTags,
    trigger: opts.trigger || '',
  };
}

/** Fire-and-forget GHL sync after prospecting actions. */
function triggerGhlProspectSync(leadKey, workspaceId, extra = {}) {
  if (!leadKey || !workspaceId) return;
  setImmediate(() => {
    syncLeadProspectActionToGhl({
      leadKey,
      workspaceId,
      trigger: extra.trigger || 'prospect_action',
      note: extra.note || '',
    }).catch((err) => {
      console.warn('[ghl prospect sync]', leadKey, err.message || err);
    });
  });
}

module.exports = {
  normalizeLeadStorageKey,
  patchLeadDispositionForGhlPush,
  appendPanelNoteBeforeGhlPush,
  resolveGhlTagNamesToLeadKeys,
  resolveLeadTagNamesForGhl,
  prepareLeadForGhlPush,
  syncLeadProspectActionToGhl,
  triggerGhlProspectSync,
};
