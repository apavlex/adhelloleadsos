/**
 * Pause cadence and fast-track engaged leads when an inbound reply arrives (GHL SMS/email).
 */
const dbService = require('./database');
const sequenceEngine = require('./sequenceEngine');
const { upsertOpenTaskForLead } = require('./userTasks');
const { resolveTaskOwnerEmail } = require('./dispositionFollowUp');
const { triggerGhlProspectSync } = require('./ghlProspectSync');

function isWarmReplyBody(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  if (/^(stop|unsubscribe|opt.?out|remove me)/i.test(t)) return false;
  return true;
}

/**
 * @param {{ lead: object, workspaceId: string, channel: 'sms'|'email', body: string, messageId?: string, ghlContactId?: string, conversationId?: string, timestamp?: string }} ctx
 */
async function handleInboundReply(ctx) {
  const lead = ctx.lead;
  const workspaceId = String(ctx.workspaceId || lead.workspaceId || '').trim();
  const channel = ctx.channel === 'email' ? 'email' : 'sms';
  const body = String(ctx.body || '').trim();
  if (!lead || !lead.key || !workspaceId) {
    return { applied: false, reason: 'missing_context' };
  }
  if (!isWarmReplyBody(body)) {
    return { applied: false, reason: 'opt_out_or_stop' };
  }

  const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
  const messageId = String(ctx.messageId || '').trim();
  if (
    messageId &&
    updates.some(
      (u) => String((u && (u.messageSid || u.ghlMessageId)) || '').trim() === messageId,
    )
  ) {
    return { applied: false, reason: 'duplicate' };
  }

  const entryType = channel === 'email' ? 'email_inbound' : 'sms_inbound';
  updates.push({
    timestamp: ctx.timestamp || new Date().toISOString(),
    type: entryType,
    value: body.slice(0, 2000),
    messageSid: messageId,
    ghlMessageId: messageId,
    provider: 'ghl',
    ghlContactId: ctx.ghlContactId || lead.ghlContactId || '',
    conversationId: ctx.conversationId || '',
    reply: true,
  });
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

  const now = new Date();
  const respondBy = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const ws = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  const ownerEmail = resolveTaskOwnerEmail(lead, ws);

  const patch = {
    status: 'Connected - Follow Up',
    lastDisposition: 'connected',
    lastDispositionAt: now.toISOString(),
    lastTouchChannel: channel,
    nextActionAt: respondBy,
    ghlContactId: lead.ghlContactId || ctx.ghlContactId || undefined,
    updates,
    logs: [
      {
        type: 'inbound_reply',
        message: `Inbound ${channel} reply — cadence paused, follow-up scheduled.`,
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
      task = await upsertOpenTaskForLead(workspaceId, ownerEmail, {
        title: `Reply from ${lead.title || 'Lead'} — respond now`,
        column: 'todo',
        scheduledAt: respondBy,
        leadKey: lead.key,
      });
    } catch (e) {
      console.warn('[inboundReplyRules] task create failed:', e && e.message);
    }
  }

  const updated = await dbService.updateLead(lead.key, patch, workspaceId);

  try {
    triggerGhlProspectSync(lead.key, workspaceId, {
      trigger: `inbound_reply:${channel}`,
      note: `Inbound ${channel} reply:\n${body.slice(0, 500)}`,
    });
  } catch (_) {
    /* non-fatal */
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
};
