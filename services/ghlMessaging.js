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

function isSmsUpdate(entry) {
  const typ = String((entry && entry.type) || '').toLowerCase();
  return typ === 'sms_inbound' || typ === 'sms_outbound';
}

function smsMessageId(entry) {
  return String(
    (entry && (entry.messageSid || entry.ghlMessageId || entry.id)) || '',
  ).trim();
}

function normalizeLocalSmsMessage(entry) {
  const typ = String((entry && entry.type) || '').toLowerCase();
  const body = String((entry && (entry.value || entry.body)) || '').trim();
  if (!body) return null;
  return {
    id: smsMessageId(entry) || `local-${entry.timestamp || Date.now()}-${typ}`,
    direction: typ === 'sms_inbound' ? 'inbound' : 'outbound',
    body,
    timestamp: entry.timestamp || new Date().toISOString(),
    provider: entry.provider || 'local',
    status: entry.status || '',
    source: 'local',
  };
}

function normalizeGhlSmsMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const messageType = String(msg.messageType || msg.type || '').toUpperCase();
  if (messageType && !messageType.includes('SMS')) return null;
  const body = String(msg.body || '').trim();
  if (!body) return null;
  const direction = String(msg.direction || 'outbound').toLowerCase();
  return {
    id: String(msg.id || msg.altId || '').trim(),
    direction: direction === 'inbound' ? 'inbound' : 'outbound',
    body,
    timestamp: msg.dateAdded || msg.createdAt || new Date().toISOString(),
    provider: 'ghl',
    status: msg.status || '',
    source: 'ghl',
    conversationId: msg.conversationId || '',
  };
}

function mergeSmsMessages(localMsgs, ghlMsgs) {
  const byKey = new Map();
  const fingerprint = (m) =>
    `${m.direction}|${String(m.timestamp || '').slice(0, 19)}|${m.body.slice(0, 120)}`;

  const add = (m) => {
    if (!m || !m.body) return;
    const idKey = m.id ? `id:${m.id}` : '';
    const fpKey = fingerprint(m);
    if (idKey && byKey.has(idKey)) {
      const existing = byKey.get(idKey);
      if (m.source === 'ghl' && existing.source === 'local') byKey.set(idKey, m);
      return;
    }
    if (byKey.has(fpKey)) {
      const existing = byKey.get(fpKey);
      if (m.source === 'ghl' && existing.source === 'local') byKey.set(fpKey, m);
      return;
    }
    const key = idKey || fpKey;
    byKey.set(key, m);
  };

  (Array.isArray(localMsgs) ? localMsgs : []).forEach(add);
  (Array.isArray(ghlMsgs) ? ghlMsgs : []).forEach(add);

  return Array.from(byKey.values()).sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0;
    const tb = Date.parse(b.timestamp) || 0;
    return ta - tb;
  });
}

async function resolveGhlContactIdForLead(lead, integrationEnv, { createIfMissing = false } = {}) {
  const existing = String((lead && lead.ghlContactId) || '').trim();
  if (existing) return existing;
  if (!ghlClient.isConfigured(integrationEnv)) return '';
  try {
    const found = await ghlClient.searchContactByEmailOrPhone(lead, integrationEnv);
    const id = found && found.id ? String(found.id).trim() : '';
    if (id) return id;
  } catch (_) {
    /* search optional */
  }
  if (createIfMissing) return ensureGhlContactId(lead, integrationEnv);
  return '';
}

async function findSmsConversationId(contactId, integrationEnv) {
  const data = await ghlClient.searchConversations({ contactId, limit: 10 }, integrationEnv);
  const conversations = Array.isArray(data.conversations)
    ? data.conversations
    : Array.isArray(data)
      ? data
      : [];
  if (!conversations.length) return '';
  const smsConv = conversations.find((c) => {
    const t = String((c && (c.type || c.lastMessageType || c.channel)) || '').toUpperCase();
    return !t || t.includes('SMS') || t.includes('PHONE');
  });
  const pick = smsConv || conversations[0];
  return String((pick && pick.id) || '').trim();
}

async function fetchSmsMessagesFromGhl({ lead, integrationEnv, maxMessages = 100 }) {
  if (!ghlClient.isConfigured(integrationEnv) || !leadHasPhone(lead)) return [];
  const contactId = await resolveGhlContactIdForLead(lead, integrationEnv);
  if (!contactId) return [];

  const conversationId = await findSmsConversationId(contactId, integrationEnv);
  if (!conversationId) return [];

  const collected = [];
  let lastMessageId;
  let guard = 0;
  while (guard < 12 && collected.length < maxMessages) {
    // eslint-disable-next-line no-await-in-loop
    const data = await ghlClient.getConversationMessages(
      conversationId,
      { limit: 50, lastMessageId, type: 'TYPE_SMS' },
      integrationEnv,
    );
    const batch = Array.isArray(data.messages) ? data.messages : [];
    batch.forEach((msg) => {
      const norm = normalizeGhlSmsMessage(msg);
      if (norm) collected.push(norm);
    });
    if (!data.nextPage || !data.lastMessageId) break;
    lastMessageId = data.lastMessageId;
    guard += 1;
  }

  return collected.slice(-maxMessages);
}

function buildSmsThreadFromLead(lead) {
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  return updates
    .filter(isSmsUpdate)
    .map(normalizeLocalSmsMessage)
    .filter(Boolean);
}

async function buildSmsThreadForLead({ lead, integrationEnv, syncFromGhl = false }) {
  const local = buildSmsThreadFromLead(lead);
  if (!syncFromGhl) return mergeSmsMessages(local, []);
  const ghl = await fetchSmsMessagesFromGhl({ lead, integrationEnv });
  return mergeSmsMessages(local, ghl);
}

function ghlMessageToLeadUpdate(msg, contactId) {
  const direction = String(msg.direction || '').toLowerCase();
  const type = direction === 'inbound' ? 'sms_inbound' : 'sms_outbound';
  return {
    timestamp: msg.timestamp || new Date().toISOString(),
    type,
    value: msg.body,
    messageSid: msg.id || '',
    ghlMessageId: msg.id || '',
    provider: 'ghl',
    ghlContactId: contactId || '',
    conversationId: msg.conversationId || '',
    status: msg.status || '',
  };
}

function appendUniqueSmsUpdates(lead, newEntries) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  const seen = new Set(
    updates
      .map(smsMessageId)
      .filter(Boolean)
      .map((id) => `id:${id}`),
  );
  let added = 0;
  (Array.isArray(newEntries) ? newEntries : []).forEach((entry) => {
    const id = smsMessageId(entry);
    if (id) {
      const key = `id:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    updates.push(entry);
    added += 1;
  });
  return { updates, added };
}

async function syncGhlSmsToLead({ lead, integrationEnv }) {
  const ghlMessages = await fetchSmsMessagesFromGhl({ lead, integrationEnv });
  if (!ghlMessages.length) {
    return { lead, added: 0, messages: await buildSmsThreadForLead({ lead, integrationEnv }) };
  }
  const contactId = await resolveGhlContactIdForLead(lead, integrationEnv);
  const entries = ghlMessages.map((m) => ghlMessageToLeadUpdate(m, contactId));
  const { updates, added } = appendUniqueSmsUpdates(lead, entries);
  if (!added) {
    return {
      lead,
      added: 0,
      messages: mergeSmsMessages(buildSmsThreadFromLead(lead), ghlMessages),
    };
  }
  const patched = {
    updates,
    ghlContactId: lead.ghlContactId || contactId || undefined,
  };
  return {
    lead: { ...lead, ...patched },
    added,
    messages: mergeSmsMessages(
      updates.filter(isSmsUpdate).map(normalizeLocalSmsMessage).filter(Boolean),
      ghlMessages,
    ),
    patch: patched,
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
  isSmsUpdate,
  buildSmsThreadForLead,
  buildSmsThreadFromLead,
  syncGhlSmsToLead,
  mergeSmsMessages,
  normalizeGhlSmsMessage,
  normalizeLocalSmsMessage,
};
