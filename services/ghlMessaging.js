/**
 * Outbound SMS and email through Go High Level Conversations API.
 * Ensures the lead exists as a GHL contact before sending.
 */

const ghlClient = require('./ghlClient');
const ghlSync = require('./ghlSync');

function leadHasPhone(lead) {
  const p = lead && lead.phone;
  return !!(p && String(p).trim() && String(p).trim() !== 'N/A');
}

function leadHasEmail(lead) {
  const e = lead && lead.email;
  return !!(e && String(e).trim() && String(e).trim() !== 'N/A');
}

function resolveEmailFrom(integrationEnv) {
  const { emailFrom } = ghlClient.resolveConfig(integrationEnv);
  return emailFrom;
}

function resolveSmsFromNumber(integrationEnv) {
  const { smsFromNumber } = ghlClient.resolveConfig(integrationEnv);
  const normalized = ghlClient.normalizePhoneE164(smsFromNumber);
  return normalized || '';
}

function textToHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`;
}

function messagingReady(integrationEnv) {
  const configured = ghlClient.isConfigured(integrationEnv);
  const emailFrom = resolveEmailFrom(integrationEnv);
  return {
    configured,
    smsReady: configured,
    emailReady: configured && !!emailFrom,
    hasEmailFrom: !!emailFrom,
    hasSmsFromNumber: !!resolveSmsFromNumber(integrationEnv),
  };
}

async function ensureGhlContactId(lead, integrationEnv) {
  if (!ghlClient.isConfigured(integrationEnv)) {
    throw new Error('GHL is not configured. Set API key and location ID in Workspace → Integrations.');
  }
  const existing = String(lead.ghlContactId || '').trim();
  if (existing) {
    try {
      await ghlClient.updateContact(existing, lead, integrationEnv);
      return existing;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  const pushed = await ghlSync.pushLeadToGhl(lead, integrationEnv);
  const contactId = String(pushed.ghlContactId || (pushed.lead && pushed.lead.ghlContactId) || '').trim();
  if (!contactId) throw new Error('GHL did not return a contact id.');
  return contactId;
}

async function sendSmsToLead({ lead, message, integrationEnv }) {
  if (!leadHasPhone(lead)) {
    throw new Error('Lead has no phone number.');
  }
  const body = String(message || '').trim();
  if (!body) throw new Error('Message body is required.');

  const contactId = await ensureGhlContactId(lead, integrationEnv);
  const payload = {
    type: 'SMS',
    contactId,
    message: body,
    status: 'delivered',
  };

  const fromNumber = resolveSmsFromNumber(integrationEnv);
  const toNumber = ghlClient.normalizePhoneE164(lead.phone);
  if (fromNumber) payload.fromNumber = fromNumber;
  if (toNumber) payload.toNumber = toNumber;

  const data = await ghlClient.sendConversationMessage(payload, integrationEnv);
  const messageId =
    (data && data.messageId) ||
    (data && data.id) ||
    (Array.isArray(data && data.messageIds) && data.messageIds[0]) ||
    '';

  return {
    provider: 'ghl',
    contactId,
    messageId: String(messageId || ''),
    raw: data,
  };
}

async function sendEmailToLead({ lead, subject, body, html, integrationEnv }) {
  if (!leadHasEmail(lead)) {
    throw new Error('Lead has no email address.');
  }
  const emailFrom = resolveEmailFrom(integrationEnv);
  if (!emailFrom) {
    throw new Error(
      'Set the GHL sender email in Workspace → Integrations (Outbound email from). It must be a verified sending address in your GHL sub-account.',
    );
  }

  const text = String(body || '').trim();
  const htmlBody = String(html || '').trim() || (text ? textToHtml(text) : '');
  if (!text && !htmlBody) throw new Error('Email body is required.');

  const contactId = await ensureGhlContactId(lead, integrationEnv);
  const emailTo = String(lead.email).trim();

  const payload = {
    type: 'Email',
    contactId,
    subject: String(subject || '').trim() || 'Message from Agency OS',
    html: htmlBody,
    message: text || htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    emailFrom,
    emailTo,
    status: 'delivered',
  };

  const data = await ghlClient.sendConversationMessage(payload, integrationEnv);
  const messageId =
    (data && data.messageId) ||
    (data && data.id) ||
    (Array.isArray(data && data.messageIds) && data.messageIds[0]) ||
    '';

  return {
    provider: 'ghl',
    contactId,
    messageId: String(messageId || ''),
    raw: data,
  };
}

module.exports = {
  leadHasPhone,
  leadHasEmail,
  messagingReady,
  ensureGhlContactId,
  sendSmsToLead,
  sendEmailToLead,
  textToHtml,
};
