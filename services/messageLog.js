/**
 * Outbound message log — every SMS / email sent to a lead, grouped into bulk campaigns.
 * Powers the Sent history page (/messages). Recording never throws: a logging
 * failure must not turn a delivered message into an error for the sender.
 */
const dbService = require('./database');
const { actorFromReq } = require('./teamActivity');

const CHANNELS = new Set(['sms', 'email']);
const CAMPAIGN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const BACKFILL_KEY_PREFIX = 'msglog:backfill:v1:';

const SOURCE_LABELS = {
  manual: 'One-off',
  bulk: 'Bulk send',
  ai: 'AI text',
  cadence: 'Cadence',
  info_pack: 'Info pack',
  ghl: 'Sent in GHL',
  network: 'Network',
  history: 'Earlier send',
};

/** Higher rank wins; a status only replaces lower-ranked ones. */
const STATUS_RANK = { sent: 0, failed: 1, delivered: 1, opened: 2, clicked: 3 };

function normalizeChannel(raw) {
  const c = String(raw || '').trim().toLowerCase();
  return CHANNELS.has(c) ? c : '';
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(delivered|delivery)/.test(s)) return 'delivered';
  if (/(fail|undeliver|bounce|reject|error|blocked)/.test(s)) return 'failed';
  if (/^(open|read|viewed)/.test(s)) return 'opened';
  if (/^click/.test(s)) return 'clicked';
  return 'sent';
}

function normalizeLeadKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.startsWith('lead:') ? s : `lead:${s}`;
}

function cleanRecipient(raw) {
  const s = String(raw || '').trim();
  return !s || s === 'N/A' ? '' : s.slice(0, 200);
}

function isValidCampaignId(id) {
  return CAMPAIGN_ID_RE.test(String(id || ''));
}

function contextFrom(reqOrCtx) {
  if (!reqOrCtx) return { workspaceId: '', actor: null };
  if (reqOrCtx.headers || reqOrCtx.session) {
    return { workspaceId: reqOrCtx.workspaceId || '', actor: actorFromReq(reqOrCtx) };
  }
  return { workspaceId: reqOrCtx.workspaceId || '', actor: reqOrCtx.actor || null };
}

/**
 * entry: { channel, source?, campaignId?, lead?, leadKey?, leadTitle?, recipient?, subject?, body?,
 *          provider?, providerMessageId?, status?, error?, workspaceId?, createdAt? }
 * @returns {number|null} row id
 */
function record(reqOrCtx, entry) {
  try {
    const ctx = contextFrom(reqOrCtx);
    const e = entry || {};
    const lead = e.lead || null;
    const workspaceId = String(e.workspaceId || ctx.workspaceId || (lead && lead.workspaceId) || '').trim();
    const channel = normalizeChannel(e.channel);
    if (!workspaceId || !channel) return null;
    const actor = ctx.actor;
    const createdAt = e.createdAt || Date.now();

    let campaignId = isValidCampaignId(e.campaignId) ? String(e.campaignId) : null;
    if (campaignId) {
      const campaign = dbService.ensureOutboundCampaign({
        id: campaignId,
        workspaceId,
        channel,
        actorEmail: actor && actor.email,
        actorName: actor && actor.name,
        createdAt,
      });
      if (!campaign) campaignId = null;
    }

    const providerMessageId = String(e.providerMessageId || '').trim();
    const fallbackRecipient = lead ? (channel === 'sms' ? lead.phone : lead.email) : '';
    return dbService.insertOutboundMessage({
      workspaceId,
      channel,
      source: SOURCE_LABELS[e.source] ? e.source : campaignId ? 'bulk' : 'manual',
      campaignId,
      leadKey: normalizeLeadKey(e.leadKey || (lead && lead.key)) || null,
      leadTitle: String(e.leadTitle || (lead && lead.title) || '').slice(0, 200) || null,
      recipient: cleanRecipient(e.recipient || fallbackRecipient) || null,
      subject: e.subject ? String(e.subject).slice(0, 300) : null,
      body: e.body ? String(e.body).slice(0, 20000) : null,
      provider: e.provider ? String(e.provider) : null,
      providerMessageId: providerMessageId || null,
      status: normalizeStatus(e.status) || (e.error ? 'failed' : 'sent'),
      error: e.error ? String(e.error).slice(0, 500) : null,
      actorEmail: actor && actor.email,
      actorName: actor && actor.name,
      dedupeKey: providerMessageId ? `pm:${channel}:${providerMessageId}` : null,
      createdAt,
    });
  } catch (err) {
    console.warn('[messageLog] record failed:', err && err.message);
    return null;
  }
}

function updateStatus({ workspaceId, providerMessageId, status, error } = {}) {
  try {
    const next = normalizeStatus(status);
    if (!next || !providerMessageId) return 0;
    const rank = STATUS_RANK[next];
    const fromStatuses = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < rank);
    if (!fromStatuses.length) return 0;
    return dbService.updateOutboundMessageStatus({
      workspaceId,
      providerMessageId,
      status: next,
      error: next === 'failed' && error ? String(error).slice(0, 500) : null,
      fromStatuses,
    });
  } catch (err) {
    console.warn('[messageLog] status update failed:', err && err.message);
    return 0;
  }
}

/** Outbound message reported by GHL: log it if it was sent outside the app, then apply its status. */
function syncProviderMessage({ workspaceId, channel, providerMessageId, status, lead, body, subject, createdAt }) {
  const id = String(providerMessageId || '').trim();
  if (!id) return;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  record(
    { workspaceId, actor: null },
    {
      channel,
      source: 'ghl',
      lead,
      body,
      subject: channel === 'email' ? subject || String(body || '').slice(0, 120) : '',
      provider: 'ghl',
      providerMessageId: id,
      createdAt: Number.isFinite(at) ? at : Date.now(),
    },
  );
  if (status) updateStatus({ workspaceId, providerMessageId: id, status });
}

function startCampaign(req, { id, channel, name, subject, template, planned }) {
  const ctx = contextFrom(req);
  const ch = normalizeChannel(channel);
  if (!ctx.workspaceId || !ch || !isValidCampaignId(id)) return null;
  return dbService.ensureOutboundCampaign({
    id,
    workspaceId: ctx.workspaceId,
    channel: ch,
    name: name ? String(name).slice(0, 120) : null,
    subject: subject ? String(subject).slice(0, 300) : null,
    template: template ? String(template).slice(0, 8000) : null,
    planned: Math.max(0, parseInt(planned, 10) || 0),
    actorEmail: ctx.actor && ctx.actor.email,
    actorName: ctx.actor && ctx.actor.name,
  });
}

function finishCampaign(req, id, { skipped } = {}) {
  const ctx = contextFrom(req);
  if (!ctx.workspaceId || !isValidCampaignId(id)) return 0;
  return dbService.finishOutboundCampaign(ctx.workspaceId, id, { skipped });
}

function inferHistorySource(u) {
  if (u.cadenceStep != null || u.templateId) return 'cadence';
  if (u.source === 'referral_network') return 'network';
  if (u.aiProvider) return 'ai';
  if (u.conversationId) return 'ghl';
  return 'history';
}

/**
 * One-time import of sends recorded on leads before the log existed. Only entries older
 * than the first live log row are imported, so nothing is counted twice.
 */
async function ensureBackfill(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return 0;
  const flagKey = `${BACKFILL_KEY_PREFIX}${wid}`;
  try {
    if (await dbService.peekStorageKey(flagKey)) return 0;
    const cutoff = dbService.earliestLiveOutboundMessageAt(wid) || Date.now();
    const leads = await dbService.getAllLeads(wid);
    const rows = [];
    for (const lead of leads || []) {
      if (!lead || !lead.key || !Array.isArray(lead.updates)) continue;
      const leadKey = normalizeLeadKey(lead.key);
      for (const u of lead.updates) {
        if (!u || (u.type !== 'sms_outbound' && u.type !== 'email_outbound')) continue;
        const at = Date.parse(u.timestamp);
        if (!Number.isFinite(at) || at >= cutoff) continue;
        const channel = u.type === 'sms_outbound' ? 'sms' : 'email';
        const pmid = String(u.ghlMessageId || u.messageSid || u.commsMessageId || '').trim();
        const text = String(u.value || '');
        const fromGhl = !!u.conversationId;
        rows.push({
          workspaceId: wid,
          channel,
          source: inferHistorySource(u),
          leadKey,
          leadTitle: String(lead.title || '').slice(0, 200) || null,
          recipient: cleanRecipient(channel === 'sms' ? lead.phone : lead.email) || null,
          subject: channel === 'email' && !fromGhl ? text.slice(0, 300) : null,
          body: channel === 'sms' || fromGhl ? text.slice(0, 20000) : null,
          provider: u.provider || null,
          providerMessageId: pmid || null,
          status: normalizeStatus(u.status) || 'sent',
          dedupeKey: `bf:${leadKey}:${u.type}:${u.timestamp}:${pmid}`,
          createdAt: at,
        });
      }
    }
    const n = rows.length ? dbService.insertOutboundMessages(rows) : 0;
    await dbService.putStorageKey(flagKey, JSON.stringify({ at: Date.now(), imported: n }));
    return n;
  } catch (err) {
    console.warn('[messageLog] backfill failed:', err && err.message);
    return 0;
  }
}

module.exports = {
  SOURCE_LABELS,
  normalizeStatus,
  isValidCampaignId,
  record,
  updateStatus,
  syncProviderMessage,
  startCampaign,
  finishCampaign,
  ensureBackfill,
};
