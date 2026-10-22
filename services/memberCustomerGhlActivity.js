/**
 * Calls & texts for a Reviews-app customer linked to a GHL contact.
 * Pulls conversation messages (TYPE_SMS + TYPE_CALL) for the synced contact,
 * and merges locally stored inbound SMS/calls (same feed the bell uses) so
 * the profile still shows history when the live GHL conversation API is empty.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');
const { leadConnectorOpenUrl } = require('./ghlDeepLinks');
const { listGhlCallSmsItems, TYPE_LABELS } = require('./inboundEvents');
const work = require('./memberWork');

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

function leadMatchesCustomer(lead, customer) {
  if (!lead || !customer) return false;
  const ghlId = clean(customer.ghlContactId, 80);
  if (ghlId && clean(lead.ghlContactId, 80) === ghlId) return true;
  const match = work.findCustomerMatch([customer], {
    ghlContactId: lead.ghlContactId,
    email: lead.email,
    phone: lead.phone,
  });
  return !!(match && match.id === customer.id);
}

/**
 * Inbound SMS/calls already stored on workspace leads (bell / webhook path).
 * Shown when the live conversation API returns nothing for this contact.
 */
async function localInboundItems(network, customer, { locationId, contactId, openHref } = {}) {
  const wid = String((network && network.ownerWorkspaceId) || '').trim();
  if (!wid || !customer) return [];
  let leads = [];
  try {
    leads = await dbService.getAllLeads(wid);
  } catch (_) {
    return [];
  }
  const matched = (Array.isArray(leads) ? leads : []).filter((lead) => leadMatchesCustomer(lead, customer));
  if (!matched.length) return [];

  const rows = listGhlCallSmsItems(matched, {
    locationId,
    limit: MAX_ITEMS,
    days: 60,
  });
  return rows.map((row) => {
    const kind = row.type === 'sms' ? 'sms' : 'call';
    const title = kind === 'sms'
      ? 'Text received'
      : (TYPE_LABELS[row.type] || row.typeLabel || 'Call');
    const body = kind === 'sms'
      ? clean(row.preview || row.label, 400)
      : clean(row.label || row.preview || title, 400);
    const convId = clean(row.conversationId, 80);
    const cid = contactId || clean(row.ghlContactId || (matched[0] && matched[0].ghlContactId), 80);
    // Never use /focus callHref — that leaves the Reviews app for the leads workspace.
    const lcHref = (row.callOpensLeadConnector && row.ghlHref)
      || leadConnectorOpenUrl({
        locationId,
        contactId: cid,
        conversationId: convId,
        preferConversation: kind === 'sms' && !!convId,
      })
      || openHref
      || '';
    return {
      id: clean(row.id || `${kind}:${row.at}`, 80),
      kind,
      direction: 'inbound',
      title,
      body,
      at: row.at,
      status: '',
      conversationId: convId,
      openHref: lcHref,
      source: 'local',
    };
  }).filter((item) => item.kind !== 'sms' || item.body);
}

function mergeActivityItems(apiItems, localItems) {
  const seen = new Set();
  const out = [];
  const push = (row) => {
    if (!row) return;
    const key = `${row.kind}|${row.at}|${clean(row.body, 80)}`;
    if (seen.has(key) || seen.has(row.id)) return;
    seen.add(key);
    if (row.id) seen.add(row.id);
    out.push(row);
  };
  (Array.isArray(apiItems) ? apiItems : []).forEach(push);
  (Array.isArray(localItems) ? localItems : []).forEach(push);
  out.sort((a, b) => toMs(b.at) - toMs(a.at));
  return out.slice(0, MAX_ITEMS);
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
 * If this Reviews customer isn't linked yet, attach ghlContactId from a matching
 * workspace lead (phone / email) so Calls & texts + Open in GHL can connect.
 */
async function ensureCustomerGhlLink(network, memberId, customer) {
  if (!network || !memberId || !customer || customer.ghlContactId) return customer;
  const wid = String(network.ownerWorkspaceId || '').trim();
  if (!wid) return customer;
  let leads = [];
  try {
    leads = await dbService.getAllLeads(wid);
  } catch (_) {
    return customer;
  }
  const match = (Array.isArray(leads) ? leads : []).find((lead) => {
    if (!lead || !String(lead.ghlContactId || '').trim()) return false;
    return !!work.findCustomerMatch([customer], {
      ghlContactId: lead.ghlContactId,
      email: lead.email,
      phone: lead.phone,
    });
  });
  if (!match) return customer;
  const saved = await work.saveCustomer(
    network.id,
    memberId,
    {
      name: customer.name,
      phone: customer.phone || match.phone || '',
      email: customer.email || match.email || '',
      address: customer.address,
      notes: customer.notes,
    },
    {
      id: customer.id,
      ghlContactId: String(match.ghlContactId).trim(),
      source: customer.source || 'ghl',
      tags: customer.tags,
      isReferralPartner: customer.isReferralPartner,
    },
  );
  return (saved.ok && saved.customer) ? saved.customer : customer;
}

/**
 * @returns {Promise<{ available: boolean, linked: boolean, items: object[], openHref: string, error: string }>}
 */
async function listForCustomer(network, customer) {
  const contactId = String((customer && customer.ghlContactId) || '').trim();
  const empty = { available: false, linked: false, items: [], openHref: '', error: '' };
  if (!network || !network.ownerWorkspaceId) return empty;
  if (!contactId) {
    // Still surface locally stored inbound when we can match a lead by phone/email.
    const localItems = await localInboundItems(network, customer, {});
    return {
      available: true,
      linked: false,
      items: localItems,
      openHref: '',
      error: '',
    };
  }

  const env = await workspaceIntegrations.getResolvedIntegrationEnv(network.ownerWorkspaceId);
  const locationId = String((env && env.GHL_LOCATION_ID) || '').trim();
  const dashboardUrl = String((env && env.GHL_DASHBOARD_URL) || process.env.GHL_DASHBOARD_URL || '').trim();
  const openHref = leadConnectorOpenUrl({
    dashboardUrl,
    locationId,
    contactId,
    preferConversation: false,
  });

  const localItems = await localInboundItems(network, customer, {
    locationId,
    contactId,
    openHref,
  });

  if (!ghlClient.isConfigured(env)) {
    return {
      available: true,
      linked: true,
      items: localItems,
      openHref,
      error: localItems.length ? '' : 'GHL CRM is not connected.',
    };
  }

  try {
    const apiWork = (async () => {
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

    const apiItems = await Promise.race([
      apiWork,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out loading GHL activity.')), FETCH_MS);
      }),
    ]);

    return {
      available: true,
      linked: true,
      items: mergeActivityItems(apiItems, localItems),
      openHref,
      error: '',
    };
  } catch (err) {
    // Prefer local inbound (bell feed) over a hard error when GHL API flakes.
    if (localItems.length) {
      return { available: true, linked: true, items: localItems, openHref, error: '' };
    }
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
  localInboundItems,
  leadMatchesCustomer,
  mergeActivityItems,
  ensureCustomerGhlLink,
  normalizeMessage,
  callLabel,
  MAX_ITEMS,
};
