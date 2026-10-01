/**
 * Execute cadence steps via GHL (email/SMS). Call/task/LinkedIn steps stay manual.
 */
const workspaceIntegrations = require('./workspaceIntegrations');
const ghlMessaging = require('./ghlMessaging');
const smsOutbound = require('./smsOutbound');
const messageLog = require('./messageLog');
const phoneLineType = require('./phoneLineType');
const { expandCadenceText } = require('./cadenceTokens');

const AUTO_CHANNELS = new Set(['email', 'sms']);

function isAutoChannel(channel) {
  return AUTO_CHANNELS.has(String(channel || '').trim().toLowerCase());
}

function subjectFromStepTitle(title) {
  const t = String(title || '').trim();
  return t.replace(/^Day\s+\d+\s*[—–-]\s*/i, '').slice(0, 160) || 'Follow-up';
}

function bodyFromStep(step, lead, baseUrl) {
  const hint = expandCadenceText(step.hint || '', lead, { baseUrl });
  const title = expandCadenceText(step.title || '', lead, { baseUrl });
  if (hint && title && hint !== title) {
    return `${title}\n\n${hint}`.trim();
  }
  return hint || title || '';
}

/**
 * @returns {Promise<{ executed: boolean, channel?: string, reason?: string, provider?: string, messageId?: string, error?: string }>}
 */
async function executeSequenceStep({ lead, step, workspaceId }) {
  const channel = String(step.channel || 'task').trim().toLowerCase();
  if (!isAutoChannel(channel)) {
    return { executed: false, reason: 'manual_channel', channel };
  }

  const wid = String(workspaceId || lead.workspaceId || '').trim();
  if (!wid) return { executed: false, reason: 'no_workspace', channel };

  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

  let logBase = null;
  try {
    if (channel === 'email') {
      if (!ghlMessaging.leadHasEmail(lead)) {
        return { executed: false, reason: 'no_email', channel };
      }
      const ready = ghlMessaging.messagingReady(integrationEnv);
      if (!ready.emailReady) {
        return { executed: false, reason: 'ghl_email_not_configured', channel };
      }
      const title = expandCadenceText(step.title || '', lead, { baseUrl });
      const body = bodyFromStep(step, lead, baseUrl);
      const subject = subjectFromStepTitle(title);
      logBase = { workspaceId: wid, channel: 'email', source: 'cadence', lead, subject, body };
      const sent = await ghlMessaging.sendEmailToLead({
        lead,
        subject,
        body,
        integrationEnv,
      });
      messageLog.record(
        { workspaceId: wid, actor: null },
        { ...logBase, recipient: sent.emailTo, provider: sent.provider || 'ghl', providerMessageId: sent.messageId },
      );
      return {
        executed: true,
        channel: 'email',
        provider: sent.provider || 'ghl',
        messageId: sent.messageId || '',
        contactId: sent.contactId || '',
      };
    }

    if (channel === 'sms') {
      if (!smsOutbound.leadHasPhone(lead)) {
        return { executed: false, reason: 'no_phone', channel };
      }
      if (!phoneLineType.isSmsAllowed(lead)) {
        return { executed: false, reason: 'landline_sms_skip', channel };
      }
      const message = bodyFromStep(step, lead, baseUrl).slice(0, 1600);
      if (!message) return { executed: false, reason: 'empty_body', channel };
      logBase = { workspaceId: wid, channel: 'sms', source: 'cadence', lead, body: message };
      const sent = await smsOutbound.sendSmsToLead({
        lead,
        message,
        integrationEnv,
        workspaceId: wid,
        provider: 'ghl',
      });
      messageLog.record(
        { workspaceId: wid, actor: null },
        { ...logBase, provider: sent.provider || 'ghl', providerMessageId: sent.messageId },
      );
      return {
        executed: true,
        channel: 'sms',
        provider: sent.provider || 'ghl',
        messageId: sent.messageId || '',
        contactId: sent.contactId || '',
      };
    }
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    if (logBase) messageLog.record({ workspaceId: wid, actor: null }, { ...logBase, error });
    return {
      executed: false,
      channel,
      reason: 'send_failed',
      error,
    };
  }

  return { executed: false, reason: 'unsupported_channel', channel };
}

module.exports = {
  isAutoChannel,
  executeSequenceStep,
  subjectFromStepTitle,
  bodyFromStep,
};
