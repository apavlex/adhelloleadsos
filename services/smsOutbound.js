/**
 * Outbound SMS / iMessage routing — GHL, Saperly, Comms, or SignalWire.
 */

const ghlClient = require('./ghlClient');
const ghlMessaging = require('./ghlMessaging');
const commsClient = require('./commsClient');
const saperlyClient = require('./saperlyClient');
const signalwire = require('./signalwire');

const PROVIDER_CHAINS = {
  auto: ['ghl', 'saperly', 'comms', 'signalwire'],
  saperly: ['saperly', 'ghl', 'comms', 'signalwire'],
  comms: ['comms', 'ghl', 'saperly', 'signalwire'],
  ghl: ['ghl', 'saperly', 'comms', 'signalwire'],
};

function resolveSmsPrimary(integrationEnv) {
  return String(integrationEnv.SMS_PRIMARY || process.env.SMS_PRIMARY || 'auto')
    .trim()
    .toLowerCase();
}

function isProviderConfigured(provider, integrationEnv) {
  if (provider === 'ghl') return ghlClient.isConfigured(integrationEnv);
  if (provider === 'saperly') return saperlyClient.isConfigured(integrationEnv);
  if (provider === 'comms') return commsClient.isConfigured(integrationEnv);
  if (provider === 'signalwire') return signalwire.configured();
  return false;
}

/**
 * Pick the first configured provider for this workspace.
 * @param {Record<string, string>} integrationEnv
 * @param {{ preferred?: string, force?: string }} [opts]
 */
function resolveSmsProvider(integrationEnv, opts = {}) {
  const force = String(opts.force || opts.preferred || '').trim().toLowerCase();
  const primary = resolveSmsPrimary(integrationEnv);
  const baseChain = PROVIDER_CHAINS[primary] || PROVIDER_CHAINS.auto;
  const chain = force
    ? [force, ...baseChain.filter((p) => p !== force)]
    : baseChain;

  for (const provider of chain) {
    if (isProviderConfigured(provider, integrationEnv)) return provider;
  }
  return null;
}

function providerDisplayName(provider) {
  if (provider === 'comms') return 'Comms';
  if (provider === 'saperly') return 'Saperly';
  if (provider === 'ghl') return 'Go High Level';
  if (provider === 'signalwire') return 'SignalWire';
  return String(provider || 'SMS');
}

function leadHasPhone(lead) {
  const p = lead && lead.phone;
  return !!(p && String(p).trim() && String(p).trim() !== 'N/A');
}

function extractCommsMessageId(data) {
  if (!data || typeof data !== 'object') return '';
  const msg = data.message || data.data || data;
  return String(msg.id || msg.message_id || data.id || '').trim();
}

function extractCommsChannel(data) {
  if (!data || typeof data !== 'object') return '';
  const msg = data.message || data.data || data;
  return String(msg.channel || data.channel || '').trim().toLowerCase();
}

/**
 * Send SMS/iMessage to a lead via the resolved provider.
 * @param {{ lead: object, message: string, integrationEnv: Record<string, string>, workspaceId?: string, fromNumber?: string, provider?: string, to?: string }} opts
 */
async function sendSmsToLead(opts) {
  const lead = opts.lead;
  const message = String(opts.message || '').trim();
  const integrationEnv = opts.integrationEnv || {};
  const toRaw = String(opts.to || (lead && lead.phone) || '').trim();
  if (!toRaw || toRaw === 'N/A') throw new Error('Recipient phone number is required.');
  if (!message) throw new Error('Message body is required.');

  const provider = resolveSmsProvider(integrationEnv, { force: opts.provider });
  if (!provider) {
    throw new Error(
      'Outbound SMS is not configured. Connect Saperly, Comms, or Go High Level in Workspace → Integrations, or set SignalWire env vars.',
    );
  }

  if (provider === 'ghl') {
    const sent = await ghlMessaging.sendSmsToLead({ lead, message, integrationEnv, toPhone: toRaw });
    return {
      provider: 'ghl',
      messageId: sent.messageId || '',
      contactId: sent.contactId || '',
      channel: 'sms',
      raw: sent.raw,
    };
  }

  if (provider === 'comms') {
    const to = ghlClient.normalizePhoneE164(toRaw);
    if (!to) throw new Error('Recipient phone number is not valid for SMS.');
    const data = await commsClient.sendMessage({ to, body: message }, integrationEnv);
    return {
      provider: 'comms',
      messageId: extractCommsMessageId(data),
      channel: extractCommsChannel(data) || commsClient.resolveConfig(integrationEnv).defaultChannel || '',
      raw: data,
    };
  }

  if (provider === 'saperly') {
    const to = ghlClient.normalizePhoneE164(toRaw);
    if (!to) throw new Error('Recipient phone number is not valid for SMS.');
    const data = await saperlyClient.sendMessage({ to, body: message }, integrationEnv);
    return {
      provider: 'saperly',
      messageId: String(data.id || '').trim(),
      channel: 'sms',
      raw: data,
    };
  }

  const sms = await signalwire.sendSms({
    to: toRaw,
    body: message,
    leadKey: lead.key,
    workspaceId: opts.workspaceId,
    from: opts.fromNumber,
  });
  return {
    provider: 'signalwire',
    messageId: sms.sid || '',
    channel: 'sms',
    raw: sms,
  };
}

function messagingStatus(integrationEnv) {
  const provider = resolveSmsProvider(integrationEnv);
  return {
    configured: !!provider,
    provider,
    providerLabel: provider ? providerDisplayName(provider) : '',
    commsConfigured: commsClient.isConfigured(integrationEnv),
    saperlyConfigured: saperlyClient.isConfigured(integrationEnv),
    ghlConfigured: ghlClient.isConfigured(integrationEnv),
    signalwireConfigured: signalwire.configured(),
    smsPrimary: resolveSmsPrimary(integrationEnv),
  };
}

module.exports = {
  PROVIDER_CHAINS,
  resolveSmsPrimary,
  resolveSmsProvider,
  providerDisplayName,
  sendSmsToLead,
  messagingStatus,
  leadHasPhone,
};
