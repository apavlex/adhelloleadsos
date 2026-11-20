/**
 * Instantly.ai inbound webhooks → lead engagement / notifications.
 * Events: reply_received, email_opened, link_clicked, lead_interested, …
 * https://developer.instantly.ai/guides/webhook-events
 */

const dbService = require('./database');
const { handleInboundReply } = require('./inboundReplyRules');
const { applyEngagementSignal } = require('./engagementSignals');

function str(v) {
  return String(v == null ? '' : v).trim();
}

function extractEmail(raw) {
  const s = str(raw);
  if (!s) return '';
  const angle = s.match(/<([^>]+@[^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return bare ? bare[0].toLowerCase() : s.toLowerCase();
}

function eventTypeOf(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return str(
    p.event_type ||
      p.eventType ||
      p.type ||
      p.event ||
      (p.data && (p.data.event_type || p.data.type)) ||
      '',
  ).toLowerCase();
}

function nested(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return p.data && typeof p.data === 'object' ? p.data : p;
}

function leadEmailOf(payload) {
  const p = nested(payload);
  return extractEmail(
    p.lead_email ||
      p.email ||
      p.from ||
      p.reply_from ||
      p.leadEmail ||
      (p.lead && (p.lead.email || p.lead.Email)) ||
      '',
  );
}

function replyBodyOf(payload) {
  const p = nested(payload);
  return str(
    p.reply_text ||
      p.replyText ||
      p.reply_text_snippet ||
      p.email_text ||
      p.emailText ||
      p.text ||
      p.body ||
      p.message ||
      '',
  );
}

function replySubjectOf(payload) {
  const p = nested(payload);
  return str(p.reply_subject || p.email_subject || p.subject || '');
}

function messageIdOf(payload) {
  const p = nested(payload);
  return str(
    p.email_id ||
      p.emailId ||
      p.id ||
      p.message_id ||
      p.messageId ||
      p.uuid ||
      '',
  );
}

function uniboxUrlOf(payload) {
  const p = nested(payload);
  return str(p.unibox_url || p.uniboxUrl || p.thread_url || '');
}

function emailAccountOf(payload) {
  const p = nested(payload);
  return str(p.email_account || p.eaccount || p.from_account || '');
}

function timestampOf(payload) {
  const p = nested(payload);
  const raw = p.timestamp || p.created_at || p.date || p.replied_at || p.event_timestamp || '';
  const ms = Date.parse(String(raw || ''));
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return new Date().toISOString();
}

function campaignIdOf(payload) {
  const p = nested(payload);
  return str(p.campaign_id || p.campaignId || p.campaign || '');
}

/**
 * Map Instantly event → engagement signal (non-reply).
 * @returns {string} signal type or ''
 */
function signalTypeForEvent(eventType) {
  const t = str(eventType).toLowerCase();
  if (t === 'email_opened' || t === 'email_open' || t === 'opened') return 'email_open';
  if (t === 'link_clicked' || t === 'email_link_clicked' || t === 'clicked') return 'link_click';
  return '';
}

function isReplyEvent(eventType) {
  const t = str(eventType).toLowerCase();
  return (
    t === 'reply_received' ||
    t === 'auto_reply_received' ||
    t === 'lead_interested' ||
    t === 'lead_meeting_booked' ||
    t === 'lead_meeting_completed' ||
    t === 'lead_closed'
  );
}

function isAutoReplyEvent(eventType) {
  return str(eventType).toLowerCase() === 'auto_reply_received';
}

async function findLeadForInstantly(workspaceId, email) {
  const em = extractEmail(email);
  if (!em) return null;
  if (typeof dbService.findLeadByEmail === 'function') {
    const hit = await dbService.findLeadByEmail(em, workspaceId);
    if (hit) return hit;
  }
  const leads = await dbService.getAllLeads(workspaceId);
  return (
    (leads || []).find((l) => {
      if (!l) return false;
      if (extractEmail(l.email) === em) return true;
      const contacts = Array.isArray(l.contacts) ? l.contacts : [];
      return contacts.some((c) => extractEmail(c && c.email) === em);
    }) || null
  );
}

/**
 * Process one Instantly webhook payload.
 * @param {object} payload
 * @param {{ workspaceId: string }} opts
 */
async function processWebhook(payload, opts = {}) {
  const workspaceId = str(opts.workspaceId || (payload && payload.workspaceId) || '');
  if (!workspaceId) {
    return { ignored: true, reason: 'missing_workspace' };
  }

  const eventType = eventTypeOf(payload);
  if (!eventType) {
    return { ignored: true, reason: 'missing_event_type' };
  }

  const email = leadEmailOf(payload);
  if (!email) {
    return { ignored: true, reason: 'missing_lead_email', eventType };
  }

  const lead = await findLeadForInstantly(workspaceId, email);
  if (!lead) {
    return { ignored: true, reason: 'lead_not_found', eventType, email };
  }

  const at = timestampOf(payload);
  const messageId = messageIdOf(payload);
  const uniboxUrl = uniboxUrlOf(payload);
  const emailAccount = emailAccountOf(payload);
  const campaignId = campaignIdOf(payload);
  const subject = replySubjectOf(payload);
  const body = replyBodyOf(payload);

  if (isReplyEvent(eventType)) {
    const text =
      body ||
      (subject ? `Re: ${subject}` : '') ||
      (eventType === 'lead_interested'
        ? 'Marked interested in Instantly'
        : 'Email reply via Instantly');
    const result = await handleInboundReply({
      lead,
      workspaceId,
      channel: 'email',
      body: text,
      messageId: messageId || `instantly:${eventType}:${email}:${at}`,
      provider: 'instantly',
      timestamp: at,
      conversationId: campaignId || '',
      autoResponder: isAutoReplyEvent(eventType),
      extraEntry: {
        instantlyEmailId: messageId || '',
        instantlyUniboxUrl: uniboxUrl || '',
        instantlyEmailAccount: emailAccount || '',
        linkUrl: uniboxUrl || '',
      },
      extraPatch: {
        ...(messageId ? { instantlyLastEmailId: messageId } : {}),
        ...(uniboxUrl ? { instantlyUniboxUrl: uniboxUrl } : {}),
        ...(emailAccount ? { instantlyEmailAccount: emailAccount } : {}),
        ...(campaignId ? { instantlyCampaignId: campaignId } : {}),
      },
    });

    return {
      ignored: false,
      action: 'email_inbound',
      eventType,
      leadKey: lead.key,
      replyHandled: !!(result && result.applied),
      reason: result && result.reason,
      uniboxUrl: uniboxUrl || '',
      workspaceId,
    };
  }

  const signalType = signalTypeForEvent(eventType);
  if (!signalType) {
    return { ignored: true, reason: 'unsupported_event', eventType, email };
  }

  const applied = await applyEngagementSignal({
    lead,
    workspaceId,
    signalType,
    at,
    createTask: false,
    provider: 'instantly',
    linkUrl: uniboxUrl,
    messageId: messageId || undefined,
  });

  return {
    ignored: false,
    action: signalType,
    eventType,
    leadKey: lead.key,
    applied: !!(applied && applied.applied),
    workspaceId,
  };
}

module.exports = {
  processWebhook,
  eventTypeOf,
  leadEmailOf,
  replyBodyOf,
  messageIdOf,
  uniboxUrlOf,
  emailAccountOf,
  isReplyEvent,
  isAutoReplyEvent,
  signalTypeForEvent,
  findLeadForInstantly,
  extractEmail,
};
