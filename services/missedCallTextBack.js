/**
 * Auto SMS after a GHL missed call / voicemail — uses the workspace GHL connection
 * (same path as lead-panel / Focus SMS). Replies sync via existing GHL webhooks + poll.
 */
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const smsOutbound = require('./smsOutbound');
const { notifyMissedCallTextSent } = require('./inboundPush');
const whiteLabel = require('./whiteLabel');

const DEFAULT_MESSAGE =
  'Hey{{name_part}} — sorry we missed your call! Reply here and we’ll get right back to you.';

const TEXTBACK_COOLDOWN_MS = 30 * 60 * 1000;
const RECENT_MISS_MS = 48 * 60 * 60 * 1000;

function settingsFromWorkspace(ws) {
  const raw = ws && ws.missedCallTextBack && typeof ws.missedCallTextBack === 'object' ? ws.missedCallTextBack : {};
  const message = String(raw.message || DEFAULT_MESSAGE)
    .trim()
    .slice(0, 1000);
  return {
    enabled: raw.enabled === true || raw.enabled === '1' || raw.enabled === 'on',
    message: message || DEFAULT_MESSAGE,
  };
}

function normalizeSettings(body) {
  const enabled =
    body &&
    (body.missedCallTextBackEnabled === '1' ||
      body.missedCallTextBackEnabled === 'on' ||
      body.missedCallTextBackEnabled === true);
  let message = String((body && body.missedCallTextBackMessage) || '').trim().slice(0, 1000);
  if (!message) message = DEFAULT_MESSAGE;
  return { enabled: !!enabled, message };
}

function firstName(lead) {
  const title = String((lead && lead.title) || '').trim();
  if (!title || title.toUpperCase() === 'N/A') return '';
  // Prefer first token that looks like a person name (skip phone-looking titles).
  if (/^\+?\d[\d\s().-]{6,}$/.test(title)) return '';
  return title.split(/\s+/)[0].slice(0, 40);
}

function businessName(ws) {
  const wl = whiteLabel.brandForWorkspace(ws || {});
  // Prefer an explicit white-label name, then workspace name (not the AdHello default).
  return (
    String((wl && wl.customName) || '').trim() ||
    String((ws && ws.name) || '').trim() ||
    String((wl && wl.appName) || '').trim() ||
    'us'
  );
}

function renderMessage(template, { lead, workspace }) {
  const name = firstName(lead);
  const business = businessName(workspace);
  const phone = String((lead && lead.phone) || '').trim();
  return String(template || DEFAULT_MESSAGE)
    .replace(/\{\{\s*name_part\s*\}\}/gi, name ? ` ${name}` : '')
    .replace(/\{\{\s*name\s*\}\}/gi, name || 'there')
    .replace(/\{\{\s*business\s*\}\}/gi, business)
    .replace(/\{\{\s*phone\s*\}\}/gi, phone || '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1000);
}

function recentTextBack(lead, { callEventId, sinceMs } = {}) {
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  const since = Number.isFinite(sinceMs) ? sinceMs : Date.now() - TEXTBACK_COOLDOWN_MS;
  const eventId = String(callEventId || '').trim();
  return updates.some((u) => {
    if (!u || u.type !== 'sms_outbound') return false;
    if (u.reason !== 'missed_call_textback' && u.missedCallTextBack !== true) return false;
    if (eventId && String(u.callEventId || '') === eventId) return true;
    const at = Date.parse(u.timestamp || '');
    return Number.isFinite(at) && at >= since;
  });
}

/**
 * After a missed call / voicemail is recorded: optionally send GHL SMS + notify staff.
 * @returns {Promise<{ sent: boolean, skipped?: string, messageId?: string, lead?: object }>}
 */
async function maybeSendMissedCallTextBack({
  lead,
  workspaceId,
  outcome,
  callEventId,
  workspace: workspaceHint,
} = {}) {
  const kind = String(outcome || '');
  if (kind !== 'missed_call' && kind !== 'voicemail') {
    return { sent: false, skipped: 'not_missed' };
  }
  if (!lead || !lead.key || !workspaceId) {
    return { sent: false, skipped: 'missing_context' };
  }

  const ws = workspaceHint || (await dbService.getWorkspace(workspaceId));
  if (!ws) return { sent: false, skipped: 'no_workspace' };
  const settings = settingsFromWorkspace(ws);
  if (!settings.enabled) return { sent: false, skipped: 'disabled' };

  const block = smsOutbound.leadSmsBlock(lead);
  if (block) return { sent: false, skipped: block.reason };

  if (recentTextBack(lead, { callEventId })) {
    return { sent: false, skipped: 'already_sent' };
  }

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const readiness = smsOutbound.ghlGroupSmsReadiness(integrationEnv);
  if (!readiness.ready) return { sent: false, skipped: 'ghl_not_ready' };

  const message = renderMessage(settings.message, { lead, workspace: ws });
  if (!message) return { sent: false, skipped: 'empty_message' };

  let sent;
  try {
    sent = await smsOutbound.sendSmsToLead({
      lead,
      message,
      integrationEnv,
      workspaceId,
      requireProvider: 'ghl',
    });
  } catch (err) {
    console.warn(
      '[missedCallTextBack] send failed:',
      lead.key,
      err && err.message ? err.message : err,
    );
    return { sent: false, skipped: 'send_failed', error: (err && err.message) || 'send_failed' };
  }

  const at = new Date().toISOString();
  const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
  updates.push({
    timestamp: at,
    type: 'sms_outbound',
    value: message,
    messageSid: sent.messageId || '',
    ghlMessageId: sent.messageId || '',
    ghlContactId: sent.contactId || lead.ghlContactId || '',
    provider: 'ghl',
    reason: 'missed_call_textback',
    missedCallTextBack: true,
    callEventId: String(callEventId || '').trim(),
    outcome: kind,
  });

  const patch = {
    updates,
    lastTouchChannel: 'sms',
    ghlContactId: sent.contactId || lead.ghlContactId || undefined,
    logs: [
      {
        type: 'sms_outbound',
        message: `Missed-call text-back sent via GHL${sent.messageId ? ` (${sent.messageId})` : ''}`,
        timestamp: at,
      },
    ],
  };

  const updated = await dbService.updateLead(lead.key, patch, workspaceId);
  notifyMissedCallTextSent({
    workspaceId,
    lead: updated || lead,
    preview: message,
    outcome: kind,
  });

  return {
    sent: true,
    messageId: sent.messageId || '',
    lead: updated,
  };
}

/** True when the lead has a recent missed call / voicemail (updates or inbound feed). */
function hasRecentMissedCall(lead, { withinMs = RECENT_MISS_MS } = {}) {
  const now = Date.now();
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  if (
    updates.some((u) => {
      if (!u || u.type !== 'call_inbound') return false;
      if (u.outcome !== 'missed_call' && u.outcome !== 'voicemail') return false;
      const at = Date.parse(u.timestamp || '');
      return Number.isFinite(at) && now - at <= withinMs;
    })
  ) {
    return true;
  }
  const events = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
  return events.some((e) => {
    if (!e || (e.type !== 'missed_call' && e.type !== 'voicemail')) return false;
    const at = Date.parse(e.at || '');
    return Number.isFinite(at) && now - at <= withinMs;
  });
}

/** True when an inbound SMS is a reply to a GHL missed-call text-back (same channel). */
function isReplyToMissedCallTextBack(lead, { withinMs = RECENT_MISS_MS } = {}) {
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  const now = Date.now();
  return updates.some((u) => {
    if (!u || u.type !== 'sms_outbound') return false;
    if (u.reason !== 'missed_call_textback' && u.missedCallTextBack !== true) return false;
    // Device / native SMS is never the GHL auto channel.
    if (u.provider === 'device' || u.deviceSms) return false;
    const at = Date.parse(u.timestamp || '');
    return Number.isFinite(at) && now - at <= withinMs;
  });
}

module.exports = {
  DEFAULT_MESSAGE,
  settingsFromWorkspace,
  normalizeSettings,
  renderMessage,
  recentTextBack,
  maybeSendMissedCallTextBack,
  hasRecentMissedCall,
  isReplyToMissedCallTextBack,
};
