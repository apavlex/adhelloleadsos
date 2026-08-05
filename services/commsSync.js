/**
 * Inbound Comms webhooks → lead SMS thread updates.
 */

const dbService = require('./database');
const { normalizePhoneE164 } = require('./ghlClient');
const signalwire = require('./signalwire');
const { handleInboundReply } = require('./inboundReplyRules');

function normalizePhone(raw) {
  return normalizePhoneE164(raw) || signalwire.normalizePhone(raw) || '';
}

function parseCommsWebhook(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const eventType = String(payload.type || payload.event || payload.event_type || '').trim().toLowerCase();
  const message = payload.message || payload.data || payload;
  if (!message || typeof message !== 'object') return null;

  const body = String(message.body || message.text || message.content || '').trim();
  if (!body) return null;

  const from = normalizePhone(message.from || message.sender || message.from_number);
  const to = normalizePhone(message.to || message.recipient || message.to_number);
  const messageId = String(message.id || message.message_id || payload.id || '').trim();

  let direction = String(message.direction || payload.direction || '').trim().toLowerCase();
  if (!direction) {
    if (/received|inbound|incoming/.test(eventType)) direction = 'inbound';
    else if (/sent|outbound|delivered|status/.test(eventType)) direction = 'outbound';
    else direction = 'inbound';
  }

  return {
    eventType,
    body,
    from,
    to,
    messageId,
    direction: direction === 'inbound' ? 'inbound' : 'outbound',
    channel: String(message.channel || '').trim().toLowerCase(),
    timestamp: message.created_at || message.timestamp || payload.timestamp || '',
    conversationId: String(message.conversation_id || message.conversationId || '').trim(),
  };
}

function findLeadByPhone(leads, phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  return (
    (leads || []).find((lead) => {
      const lp = normalizePhone(lead && lead.phone);
      return lp && lp === target;
    }) || null
  );
}

/**
 * @param {object} payload
 * @param {{ workspaceId?: string }} [opts]
 */
async function processWebhook(payload, opts = {}) {
  const parsed = parseCommsWebhook(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_message_event' };

  const wid = String(opts.workspaceId || 'default').trim() || 'default';
  const localLeads = await dbService.getAllLeads(wid);
  const matchPhone = parsed.direction === 'inbound' ? parsed.from : parsed.to;
  const lead = findLeadByPhone(localLeads, matchPhone);
  if (!lead || !lead.key) {
    return { ok: true, workspaceId: wid, ignored: true, reason: 'lead_not_found' };
  }

  if (parsed.direction === 'inbound') {
    const result = await handleInboundReply({
      lead,
      workspaceId: wid,
      channel: 'sms',
      body: parsed.body,
      messageId: parsed.messageId,
      provider: 'comms',
      commsChannel: parsed.channel,
      conversationId: parsed.conversationId,
      timestamp: parsed.timestamp || new Date().toISOString(),
    });
    return {
      ok: true,
      workspaceId: wid,
      key: lead.key,
      direction: 'inbound',
      action: result.applied ? 'inbound_reply' : 'ignored',
      reason: result.reason || null,
      pausedSequence: result.pausedSequence || false,
      taskId: result.taskId || null,
    };
  }

  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  if (
    parsed.messageId &&
    updates.some((u) => String((u && (u.messageSid || u.commsMessageId)) || '').trim() === parsed.messageId)
  ) {
    return { ok: true, workspaceId: wid, key: lead.key, ignored: true, reason: 'duplicate' };
  }

  const entryType = parsed.direction === 'inbound' ? 'sms_inbound' : 'sms_outbound';
  const newUpdates = [
    ...updates,
    {
      timestamp: parsed.timestamp || new Date().toISOString(),
      type: entryType,
      value: parsed.body,
      messageSid: parsed.messageId,
      commsMessageId: parsed.messageId,
      provider: 'comms',
      channel: parsed.channel || '',
      conversationId: parsed.conversationId || '',
    },
  ];

  const patch = {
    updates: newUpdates,
    lastTouchChannel: parsed.direction === 'inbound' ? 'sms' : lead.lastTouchChannel,
    logs: [
      {
        type: entryType,
        message:
          parsed.direction === 'inbound'
            ? `Inbound ${parsed.channel === 'imessage' ? 'iMessage' : 'SMS'} (Comms): ${parsed.body.slice(0, 180)}`
            : `Outbound ${parsed.channel === 'imessage' ? 'iMessage' : 'SMS'} (Comms): ${parsed.body.slice(0, 180)}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await dbService.updateLead(lead.key, patch);
  return { ok: true, workspaceId: wid, key: lead.key, direction: parsed.direction, added: true };
}

module.exports = {
  parseCommsWebhook,
  processWebhook,
};
