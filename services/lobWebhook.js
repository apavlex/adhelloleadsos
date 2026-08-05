/**
 * Lob webhooks — postcard.viewed (QR scan) → lead engagement signal.
 */
const dbService = require('./database');
const { applyEngagementSignal } = require('./engagementSignals');

const VIEWED_EVENT_TYPES = new Set([
  'postcard.viewed',
  'letter.viewed',
  'self_mailer.viewed',
]);

function parseLobWebhook(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const eventType = String(
    payload.event_type || payload.eventType || payload.type || payload.event || '',
  )
    .trim()
    .toLowerCase();
  if (!VIEWED_EVENT_TYPES.has(eventType)) return null;

  const body = payload.body || payload.data || payload.resource || payload;
  const postcardId = String(
    body.id || body.postcard_id || body.letter_id || body.self_mailer_id || '',
  ).trim();
  if (!postcardId) return null;

  const timestamp =
    body.date_created ||
    body.date_modified ||
    payload.date_created ||
    payload.created_at ||
    '';

  return {
    eventType,
    postcardId,
    timestamp: timestamp || new Date().toISOString(),
    redirectUrl: String(body.qr_code_redirect_url || body.redirect_url || '').trim(),
  };
}

function leadHasPostcardId(lead, postcardId) {
  const id = String(postcardId || '').trim();
  if (!id || !lead) return false;
  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  if (updates.some((u) => String((u && u.postcardId) || '').trim() === id)) return true;
  const logs = Array.isArray(lead.logs) ? lead.logs : [];
  return logs.some((l) => String((l && l.postcardId) || '').trim() === id);
}

function findLeadByPostcardId(leads, postcardId) {
  const id = String(postcardId || '').trim();
  if (!id) return null;
  return (Array.isArray(leads) ? leads : []).find((lead) => leadHasPostcardId(lead, id)) || null;
}

/**
 * @param {object} payload
 * @param {{ workspaceId?: string }} [opts]
 */
async function processLobWebhook(payload, opts = {}) {
  const parsed = parseLobWebhook(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_viewed_event' };

  const wid = String(opts.workspaceId || 'default').trim() || 'default';
  const localLeads = await dbService.getAllLeads(wid);
  const lead = findLeadByPostcardId(localLeads, parsed.postcardId);
  if (!lead || !lead.key) {
    return {
      ok: true,
      workspaceId: wid,
      ignored: true,
      reason: 'lead_not_found',
      postcardId: parsed.postcardId,
    };
  }

  const applied = await applyEngagementSignal({
    lead,
    workspaceId: wid,
    signalType: 'mail_scan',
    at: parsed.timestamp,
    createTask: true,
    provider: 'lob',
    linkUrl: parsed.redirectUrl || '',
    extraPatch: {
      lastTouchChannel: 'direct_mail',
    },
  });

  return {
    ok: true,
    workspaceId: wid,
    key: lead.key,
    action: 'mail_scan',
    postcardId: parsed.postcardId,
    applied: !!applied.applied,
    taskId: applied.taskId || null,
  };
}

module.exports = {
  VIEWED_EVENT_TYPES,
  parseLobWebhook,
  findLeadByPostcardId,
  leadHasPostcardId,
  processLobWebhook,
};
