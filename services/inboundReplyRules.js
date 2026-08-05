/**
 * Pause cadence and fast-track engaged leads when an inbound reply arrives (GHL SMS/email, Comms iMessage/SMS).
 */
const dbService = require('./database');
const sequenceEngine = require('./sequenceEngine');
const {
  recordEngagementSignals,
  ensureEngagementCallTask,
  buildEngagementUpdateEntry,
} = require('./engagementSignals');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');
const { triggerGhlProspectSync } = require('./ghlProspectSync');

function isWarmReplyBody(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  if (/^(stop|unsubscribe|opt.?out|remove me)/i.test(t)) return false;
  return true;
}

function messageIdSeen(updates, messageId) {
  const id = String(messageId || '').trim();
  if (!id) return false;
  return (updates || []).some((u) => {
    if (!u || typeof u !== 'object') return false;
    return [u.messageSid, u.ghlMessageId, u.commsMessageId]
      .map((x) => String(x || '').trim())
      .includes(id);
  });
}

/**
 * @param {{ lead: object, workspaceId: string, channel: 'sms'|'email', body: string, messageId?: string, provider?: string, commsChannel?: string, ghlContactId?: string, conversationId?: string, timestamp?: string }} ctx
 */
async function handleInboundReply(ctx) {
  const lead = ctx.lead;
  const workspaceId = String(ctx.workspaceId || lead.workspaceId || '').trim();
  const channel = ctx.channel === 'email' ? 'email' : 'sms';
  const provider = String(ctx.provider || 'ghl').trim() || 'ghl';
  const body = String(ctx.body || '').trim();
  if (!lead || !lead.key || !workspaceId) {
    return { applied: false, reason: 'missing_context' };
  }
  if (!isWarmReplyBody(body)) {
    return { applied: false, reason: 'opt_out_or_stop' };
  }

  const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
  const messageId = String(ctx.messageId || '').trim();
  if (messageId && messageIdSeen(updates, messageId)) {
    return { applied: false, reason: 'duplicate' };
  }

  const atIso = ctx.timestamp || new Date().toISOString();
  const entryType = channel === 'email' ? 'email_inbound' : 'sms_inbound';
  const signalType = channel === 'email' ? 'email_reply' : 'sms_reply';
  const commsChannel = String(ctx.commsChannel || '').trim().toLowerCase();

  updates.push({
    timestamp: atIso,
    type: entryType,
    value: body.slice(0, 2000),
    messageSid: messageId,
    ghlMessageId: provider === 'ghl' ? messageId : '',
    commsMessageId: provider === 'comms' ? messageId : '',
    provider,
    channel: commsChannel || channel,
    ghlContactId: ctx.ghlContactId || lead.ghlContactId || '',
    conversationId: ctx.conversationId || '',
    reply: true,
  });
  updates.push(
    buildEngagementUpdateEntry(signalType, atIso, {
      provider,
      messageId,
    }),
  );

  const hadActive =
    lead.sequenceState &&
    lead.sequenceState.status === 'active' &&
    lead.sequenceState.nextDueAt;

  if (hadActive) {
    try {
      await sequenceEngine.pauseSequence(lead.key);
    } catch (e) {
      console.warn('[inboundReplyRules] pause sequence failed:', e && e.message);
    }
  }

  const now = new Date(atIso);
  const respondBy = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const ownerEmail = resolveTaskOwnerEmail(lead, ws);

  const channelLabel =
    commsChannel === 'imessage'
      ? 'iMessage'
      : provider === 'comms'
        ? 'SMS (Comms)'
        : channel;

  const patch = {
    status: 'Connected - Follow Up',
    lastDisposition: 'connected',
    lastDispositionAt: now.toISOString(),
    lastTouchChannel: channel,
    nextActionAt: respondBy,
    ghlContactId: lead.ghlContactId || ctx.ghlContactId || undefined,
    engagementSignals: recordEngagementSignals(lead.engagementSignals, signalType, atIso),
    updates,
    logs: [
      {
        type: 'inbound_reply',
        message: `Inbound ${channelLabel} reply — cadence paused, follow-up scheduled.`,
        timestamp: now.toISOString(),
      },
    ],
  };

  if (lead.sequenceState && lead.sequenceState.status === 'active') {
    patch.sequenceState = {
      ...lead.sequenceState,
      status: 'paused',
      pausedAt: now.toISOString(),
      pausedReason: 'inbound_reply',
    };
  }

  let task = null;
  if (ownerEmail) {
    try {
      task = await ensureEngagementCallTask(workspaceId, lead, respondBy);
    } catch (e) {
      console.warn('[inboundReplyRules] task create failed:', e && e.message);
    }
  }

  const updated = await dbService.updateLead(lead.key, patch, workspaceId);

  if (provider === 'ghl') {
    try {
      triggerGhlProspectSync(lead.key, workspaceId, {
        trigger: `inbound_reply:${channel}`,
        note: `Inbound ${channel} reply:\n${body.slice(0, 500)}`,
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  return {
    applied: true,
    pausedSequence: !!hadActive,
    taskId: task && task.id,
    lead: updated,
  };
}

module.exports = {
  handleInboundReply,
  isWarmReplyBody,
  messageIdSeen,
};
