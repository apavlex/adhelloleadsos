/**
 * Calls & texts for a Reviews-app customer linked to a GHL contact.
 * Pulls conversation messages (TYPE_SMS + TYPE_CALL) for the synced contact.
 */
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { leadConnectorOpenUrl } = require('./ghlDeepLinks');

const MAX_ITEMS = 40;
const FETCH_MS = 4500;

function clean(v, max = 400) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toMs(raw) {
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function callLabel(msg) {
  const status = clean(msg.status || (msg.meta && msg.meta.call && msg.meta.call.status), 40).toLowerCase();
  const type = String(msg.messageType || msg.type || '').toUpperCase();
  if (type.includes('VOICEMAIL') || status.includes('voicemail')) return 'Voicemail';
  if (status.includes('no-answer') || status.includes('no_answer') || status === 'missed') return 'Missed call';
  if (status.includes('busy')) return 'Busy';
  if (status.includes('cancel')) return 'Cancelled call';
  const dur = msg.meta && msg.meta.call && (msg.meta.call.duration ?? msg.meta.call.durationSec);
  if (Number(dur) > 0) return `Call · ${Math.round(Number(dur))}s`;
  return 'Call';
}

function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const messageType = String(msg.messageType || msg.type || '').toUpperCase();
  const isSms = !messageType || messageType.includes('SMS') || messageType.includes('TYPE_SMS');
  const isCall = messageType.includes('CALL') || messageType.includes('VOICEMAIL');
  // When type is empty, treat body-bearing rows as SMS; skip other channels.
  if (messageType && !isSms && !isCall) return null;
  if (!messageType && !clean(msg.body, 10)) return null;

  const kind = isCall ? 'call' : 'sms';
  const direction = String(msg.direction || 'outbound').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
  const body = clean(msg.body, 400);
  if (kind === 'sms' && !body) return null;

  const at = msg.dateAdded || msg.createdAt || msg.timestamp || new Date().toISOString();
  const title = kind === 'call'
    ? callLabel(msg)
    : (direction === 'inbound' ? 'Text received' : 'Text sent');

  return {
    id: clean(msg.id || msg.altId || `${kind}:${at}`, 80),
    kind,
    direction,
    title,
    body: kind === 'call' ? (body || title) : body,
    at: typeof at === 'string' ? at : new Date(at).toISOString(),
    status: clean(msg.status, 40),
    conversationId: clean(msg.conversationId, 80),
  };
}

async function listConversations(contactId, integrationEnv) {
  const data = await ghlClient.searchConversations({ contactId, limit: 10 }, integrationEnv);
  const conversations = Array.isArray(data && data.conversations)
    ? data.conversations
    : Array.isArray(data)
      ? data
      : [];
  return conversations.filter((c) => c && c.id);
}

async function pullTypedMessages(conversationId, type, integrationEnv) {
  const collected = [];
  let lastMessageId;
  let guard = 0;
  while (guard < 4 && collected.length < MAX_ITEMS) {
    // eslint-disable-next-line no-await-in-loop
    const data = await ghlClient.getConversationMessages(
      conversationId,
      { limit: 50, lastMessageId, type },
      integrationEnv,
    ).catch(() => null);
    const batch = Array.isArray(data && data.messages) ? data.messages : [];
    batch.forEach((msg) => {
      const n = normalizeMessage({ ...msg, conversationId });
      if (n) collected.push(n);
    });
    if (!batch.length || !(data && data.nextPage) || !data.lastMessageId) break;
    lastMessageId = data.lastMessageId;
    guard += 1;
  }
  return collected;
}

async function fetchMessagesForConversation(conversationId, integrationEnv) {
  // Prefer untyped fetch (SMS + calls). Fall back to typed pulls when the API requires it.
  const untyped = await pullTypedMessages(conversationId, '', integrationEnv);
  if (untyped.length) return untyped;
  const [sms, calls] = await Promise.all([
    pullTypedMessages(conversationId, 'TYPE_SMS', integrationEnv),
    pullTypedMessages(conversationId, 'TYPE_CALL', integrationEnv),
  ]);
  return [...sms, ...calls];
}

/**
 * @returns {Promise<{ available: boolean, linked: boolean, items: object[], openHref: string, error: string }>}
 */
async function listForCustomer(network, customer) {
  const contactId = String((customer && customer.ghlContactId) || '').trim();
  const empty = { available: false, linked: false, items: [], openHref: '', error: '' };
  if (!network || !network.ownerWorkspaceId) return empty;
  if (!contactId) return { ...empty, available: true, linked: false };

  const env = await workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
  if (!ghlClient.isConfigured(env)) {
    return { available: true, linked: true, items: [], openHref: '', error: 'GHL CRM is not connected.' };
  }

  const locationId = String((env && env.GHL_LOCATION_ID) || '').trim();
  const dashboardUrl = String((env && env.GHL_DASHBOARD_URL) || process.env.GHL_DASHBOARD_URL || '').trim();
  const openHref = leadConnectorOpenUrl({
    dashboardUrl,
    locationId,
    contactId,
    preferConversation: false,
  });

  try {
    const work = (async () => {
      const conversations = await listConversations(contactId, env);
      const all = [];
      const seen = new Set();
      for (const conv of conversations.slice(0, 4)) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await fetchMessagesForConversation(String(conv.id), env);
        rows.forEach((row) => {
          if (!row || seen.has(row.id)) return;
          seen.add(row.id);
          all.push({
            ...row,
            conversationId: row.conversationId || String(conv.id),
            openHref: leadConnectorOpenUrl({
              dashboardUrl,
              locationId,
              contactId,
              conversationId: row.conversationId || String(conv.id),
              preferConversation: row.kind === 'sms',
            }) || openHref,
          });
        });
      }
      all.sort((a, b) => toMs(b.at) - toMs(a.at));
      return all.slice(0, MAX_ITEMS);
    })();

    const items = await Promise.race([
      work,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out loading GHL activity.')), FETCH_MS);
      }),
    ]);

    return { available: true, linked: true, items, openHref, error: '' };
  } catch (err) {
    return {
      available: true,
      linked: true,
      items: [],
      openHref,
      error: clean((err && err.message) || 'Could not load calls & texts from GHL.', 160),
    };
  }
}

module.exports = {
  listForCustomer,
  normalizeMessage,
  callLabel,
  MAX_ITEMS,
};
