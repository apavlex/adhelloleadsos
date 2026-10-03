/**
 * Send one SMS or email to a lead through GHL outside an HTTP request (AI assistants over MCP),
 * with the same compliance checks, lead timeline entry, pipeline advance, message log, team
 * activity, and GHL sync as the lead panel.
 */
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const smsOutbound = require('./smsOutbound');
const ghlMessaging = require('./ghlMessaging');
const messageLog = require('./messageLog');
const teamActivity = require('./teamActivity');
const { buildPipelineAdvancePatch } = require('./pipelineAdvance');
const { triggerGhlProspectSync } = require('./ghlProspectSync');
const { validateOutreachComposerBody } = require('./outreachComposerSanitize');
const { resolveLeadTimezone, inAllowedWindow } = require('./dialerPacing');

/** Lead-local hours an assistant may text in (TCPA-style 8 AM – 9 PM). */
const SMS_WINDOW = { start: '08:00', end: '21:00' };

function sendError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function appendUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

function localMinute(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const hh = Number((parts.find((p) => p.type === 'hour') || {}).value) % 24;
  const mm = Number((parts.find((p) => p.type === 'minute') || {}).value);
  return { minute: hh * 60 + mm, label: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now) };
}

/** Null when the lead may be texted now, else a reason. */
function smsWindowBlock(lead, workspace, now = new Date()) {
  const tz = resolveLeadTimezone(lead, workspace && workspace.timezone);
  let local;
  try {
    local = localMinute(tz, now);
  } catch {
    return null;
  }
  if (inAllowedWindow(local.minute, SMS_WINDOW.start, SMS_WINDOW.end)) return null;
  return `It's ${local.label} for this lead (${tz}). Texts go out 8 AM – 9 PM their time; try again then or schedule a follow-up task.`;
}

/** Composer validation, with a plain "too short" error when nothing was stripped. */
function validateBody(raw, channel) {
  const validated = validateOutreachComposerBody(raw, channel);
  if (validated.ok) return validated.text;
  const plain = String(raw || '').trim();
  if (plain && validated.text === plain) {
    throw sendError(`That ${channel === 'email' ? 'email' : 'text'} is too short to send. Write a full message.`, 'INVALID_MESSAGE');
  }
  throw sendError(validated.error, 'INVALID_MESSAGE');
}

/** " via Muse" when the row is credited to the user; nothing when the bot is the actor. */
function activityVia(activity, via) {
  return activity && activity.actor && activity.actor.bot ? '' : ` via ${via}`;
}

function context(workspaceId, actor) {
  return { workspaceId, actor: actor && actor.email ? actor : null };
}

/**
 * `activity` is the Team history context (the bot, from teamActivity.toolActivityContext); defaults to the user.
 * @param {{ workspaceId: string, actor: { email: string, name?: string }, lead: object, fullKey: string,
 *           body: string, to?: string, via?: string, activity?: object, now?: Date }} opts
 */
async function sendLeadSms({ workspaceId, actor, lead, fullKey, body, to, via = 'AI assistant', activity, now }) {
  const block = smsOutbound.leadSmsBlock(lead);
  if (block) throw sendError(block.message, block.code);
  const text = validateBody(body, 'sms');
  const ws = await dbService.getWorkspace(workspaceId);
  const late = smsWindowBlock(lead, ws, now);
  if (late) throw sendError(late, 'OUTSIDE_SMS_HOURS');

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const ctx = context(workspaceId, actor);
  const logBase = { channel: 'sms', source: 'ai', lead: { ...lead, key: fullKey }, recipient: to || lead.phone, body: text };
  let sent;
  try {
    sent = await smsOutbound.sendSmsToLead({ lead, message: text, integrationEnv, workspaceId, requireProvider: 'ghl', to: to || undefined });
  } catch (err) {
    messageLog.record(ctx, { ...logBase, error: (err && err.message) || 'Send failed' });
    throw err;
  }
  messageLog.record(ctx, { ...logBase, provider: 'ghl', providerMessageId: sent.messageId });

  const contactedPatch = await buildPipelineAdvancePatch(lead, 'SMS', workspaceId);
  const contactId = sent.contactId || lead.ghlContactId || '';
  const updated = await dbService.updateLead(
    fullKey,
    {
      ...contactedPatch,
      status: 'Follow-up',
      lastTouchChannel: 'sms',
      ...(contactId ? { ghlContactId: contactId } : {}),
      updates: appendUpdate(lead, {
        type: 'sms_outbound',
        value: text,
        messageSid: sent.messageId || '',
        provider: 'ghl',
        ghlContactId: contactId,
        ghlMessageId: sent.messageId || '',
        via,
      }),
      logs: [{ type: 'sms_outbound', message: `Go High Level SMS sent by ${via}${sent.messageId ? ` (${sent.messageId})` : ''}`, timestamp: new Date().toISOString() }],
    },
    workspaceId,
  );
  teamActivity.record(activity || ctx, {
    category: 'outreach',
    action: 'sms',
    summary: `Sent SMS${activityVia(activity, via)}: ${text.slice(0, 160)}`,
    leadKey: fullKey,
    leadTitle: lead.title || '',
  });
  triggerGhlProspectSync(fullKey, workspaceId, { trigger: 'sms_sent' });
  return { messageId: sent.messageId || '', contactId, to: to || lead.phone, body: text, lead: updated };
}

/**
 * @param {{ workspaceId: string, actor: { email: string, name?: string }, lead: object, fullKey: string,
 *           subject: string, body: string, to?: string, via?: string, activity?: object }} opts
 */
async function sendLeadEmail({ workspaceId, actor, lead, fullKey, subject, body, to, via = 'AI assistant', activity }) {
  if (lead.doNotContact) throw sendError('This lead is marked Do Not Contact.', 'lead_dnc');
  const text = validateBody(body, 'email');
  const subj = String(subject || '').trim();
  if (!subj) throw sendError('Email subject is required.', 'INVALID_MESSAGE');

  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  const ready = ghlMessaging.messagingReady(integrationEnv);
  if (!ready.configured) {
    throw sendError('Connect Go High Level in Workspace → Integrations to send email from the app.', 'ghl_not_ready');
  }
  if (!ready.emailReady) {
    throw sendError('Add an "email from" address for Go High Level in Workspace → Integrations to send email.', 'ghl_not_ready');
  }
  const ctx = context(workspaceId, actor);
  const logBase = { channel: 'email', source: 'ai', lead: { ...lead, key: fullKey }, recipient: to || lead.email, subject: subj, body: text };
  let sent;
  try {
    sent = await ghlMessaging.sendEmailToLead({ lead, subject: subj, body: text, integrationEnv, toEmail: to || undefined });
  } catch (err) {
    messageLog.record(ctx, { ...logBase, error: (err && err.message) || 'Send failed' });
    throw err;
  }
  messageLog.record(ctx, { ...logBase, recipient: sent.emailTo || logBase.recipient, provider: 'ghl', providerMessageId: sent.messageId });

  const contactedPatch = await buildPipelineAdvancePatch(lead, 'CALL', workspaceId);
  const topEmail = String(lead.email || '').trim();
  const updated = await dbService.updateLead(
    fullKey,
    {
      ...contactedPatch,
      ghlContactId: sent.contactId || lead.ghlContactId,
      status: 'Email Sent',
      lastTouchChannel: 'email',
      ...(!to && sent.emailTo && (!topEmail || topEmail === 'N/A') ? { email: sent.emailTo } : {}),
      updates: appendUpdate(lead, {
        type: 'email_outbound',
        value: subj,
        messageSid: sent.messageId || '',
        provider: 'ghl',
        ghlContactId: sent.contactId || lead.ghlContactId || '',
        via,
      }),
      logs: [{ type: 'email_outbound', message: `GHL email sent by ${via}${sent.messageId ? ` (${sent.messageId})` : ''} to ${sent.emailTo}`, timestamp: new Date().toISOString() }],
    },
    workspaceId,
  );
  teamActivity.record(activity || ctx, {
    category: 'outreach',
    action: 'email',
    summary: `Sent email${activityVia(activity, via)}: ${subj.slice(0, 160)}`,
    leadKey: fullKey,
    leadTitle: lead.title || '',
  });
  triggerGhlProspectSync(fullKey, workspaceId, { trigger: 'email_sent' });
  return { messageId: sent.messageId || '', contactId: sent.contactId || '', to: sent.emailTo, subject: subj, lead: updated };
}

module.exports = {
  SMS_WINDOW,
  smsWindowBlock,
  sendLeadSms,
  sendLeadEmail,
};
