/**
 * Push prospecting actions from AdHello to GHL (tags + notes) for closed-loop follow-up.
 */

const dbService = require('./database');
const ghlClient = require('./ghlClient');
const ghlSync = require('./ghlSync');
const workspaceIntegrations = require('./workspaceIntegrations');
const { mergeTagLists } = require('./ghlSyncHelpers');
const {
  computeActionTagsFromLead,
  formatNextActionNote,
  isActionTag,
} = require('./ghlActionTags');

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
  resolveLeadTagNamesForGhl,
  prepareLeadForGhlPush,
  syncLeadProspectActionToGhl,
  triggerGhlProspectSync,
};
