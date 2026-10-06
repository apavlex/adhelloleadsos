/**
 * Pull new GHL conversation messages (texts, emails, calls) on a timer so inbound activity
 * shows up even when GHL webhooks are not set up or not delivered. Each message goes through
 * the same handler as the InboundMessage / OutboundMessage webhook, which skips duplicates.
 */
const dbService = require('./database');
const ghlClient = require('./ghlClient');
const workspaceIntegrations = require('./workspaceIntegrations');

const FIRST_RUN_LOOKBACK_MS = 48 * 3600 * 1000;
const MAX_CONVERSATIONS_PER_RUN = 25;
const MESSAGES_PER_CONVERSATION = 20;
const cursorKey = (locationId) => `ghlInboundPollCursor:${locationId}`;

let running = false;

function toMs(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw == null ? '' : raw).trim();
  if (/^\d{10,}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function listFrom(data, key) {
  const box = data && data[key];
  if (Array.isArray(box)) return box;
  if (box && Array.isArray(box[key])) return box[key];
  return [];
}

/** GHL message (Conversations API) → InboundMessage / OutboundMessage webhook body. */
function messageToWebhookPayload(msg, conv, locationId) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const c = conv && typeof conv === 'object' ? conv : {};
  const direction = String(m.direction || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
  const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
  const call = meta.call && typeof meta.call === 'object' ? meta.call : {};
  const email = meta.email && typeof meta.email === 'object' ? meta.email : {};
  const contactId = String(m.contactId || c.contactId || '').trim();
  const name = String(c.fullName || c.contactName || c.name || '').trim();
  const at = toMs(m.dateAdded);
  return {
    type: direction === 'inbound' ? 'InboundMessage' : 'OutboundMessage',
    messageType: String(m.messageType || m.type || ''),
    direction,
    locationId: String(m.locationId || c.locationId || locationId || '').trim(),
    contactId,
    conversationId: String(m.conversationId || c.id || '').trim(),
    messageId: String(m.id || '').trim(),
    body: String(m.body || ''),
    subject: String(email.subject || m.subject || ''),
    status: String(m.status || ''),
    dateAdded: at ? new Date(at).toISOString() : '',
    phone: String(c.phone || '').trim(),
    from: direction === 'inbound' && /EMAIL/i.test(String(m.messageType || '')) ? String(c.email || '') : '',
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    callStatus: String(call.status || ''),
    callDuration: call.duration ?? null,
    contact: {
      id: contactId,
      phone: String(c.phone || '').trim(),
      email: String(c.email || '').trim(),
      ...(name ? { name } : {}),
    },
  };
}

/**
 * Process conversations with messages newer than the saved cursor for one GHL location.
 * @param {{ env: object, locationId: string, now?: number, client?: object, processMessage?: Function, getCursor?: Function, setCursor?: Function }} opts
 */
async function pollLocation(opts) {
  const client = opts.client || ghlClient;
  const processMessage = opts.processMessage || ((payload) => require('./ghlSync').processMessageWebhook(payload));
  const getCursor = opts.getCursor || ((loc) => Number(dbService.getKvSync(cursorKey(loc))) || 0);
  const setCursor = opts.setCursor || ((loc, ms) => dbService.setKvSync(cursorKey(loc), String(ms)));
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const loc = opts.locationId;
  const cursor = getCursor(loc) || now - FIRST_RUN_LOOKBACK_MS;

  const data = await client.listRecentConversations({ limit: 50 }, opts.env);
  const changed = listFrom(data, 'conversations')
    .map((c) => ({ c, at: toMs(c.lastMessageDate || c.dateUpdated) }))
    .filter((x) => x.at > cursor)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_CONVERSATIONS_PER_RUN);

  const stats = { conversations: changed.length, messages: 0, applied: 0 };
  let nextCursor = cursor;
  for (const { c, at } of changed) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await client.getConversationMessages(c.id, { limit: MESSAGES_PER_CONVERSATION, type: '' }, opts.env);
      const fresh = listFrom(res, 'messages')
        .filter((m) => toMs(m && m.dateAdded) > cursor)
        .sort((a, b) => toMs(a.dateAdded) - toMs(b.dateAdded));
      for (const m of fresh) {
        stats.messages += 1;
        // eslint-disable-next-line no-await-in-loop
        const r = await processMessage(messageToWebhookPayload(m, c, loc));
        if (r && !r.ignored) stats.applied += 1;
      }
    } catch (e) {
      console.warn('[ghlInboundPoll] conversation %s failed: %s', c.id, e && e.message);
      break;
    }
    nextCursor = Math.max(nextCursor, at);
  }
  if (nextCursor !== getCursor(loc)) setCursor(loc, nextCursor);
  return stats;
}

/** One pass over every distinct GHL location configured on a workspace (or the server env). */
async function pollAllWorkspaces() {
  if (running) return { skipped: true };
  running = true;
  const seen = new Set();
  const results = [];
  try {
    const ids = await dbService.listWorkspaceIds();
    if (!ids.includes('default')) ids.push('default');
    for (const wid of ids) {
      // eslint-disable-next-line no-await-in-loop
      const env = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
      if (env.DEMO_WORKSPACE || !ghlClient.isConfigured(env)) continue;
      const loc = String(env.GHL_LOCATION_ID || '').replace(/\s+/g, '');
      if (!loc || seen.has(loc)) continue;
      seen.add(loc);
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await pollLocation({ env, locationId: loc });
        if (stats.messages) {
          console.log('[ghlInboundPoll] loc=%s conversations=%d messages=%d applied=%d', loc.slice(0, 8), stats.conversations, stats.messages, stats.applied);
        }
        results.push({ locationId: loc, ...stats });
      } catch (e) {
        console.warn('[ghlInboundPoll] location %s failed: %s', loc.slice(0, 8), e && e.message);
      }
    }
  } finally {
    running = false;
  }
  return { results };
}

module.exports = { messageToWebhookPayload, pollLocation, pollAllWorkspaces, FIRST_RUN_LOOKBACK_MS };
