/**
 * Rep-facing engagement inbox — all signal events in a time window.
 */
const {
  SIGNAL_FIELD,
  SIGNAL_PRIORITY,
  signalLabel,
  normalizeEngagementSignals,
} = require('./engagementSignals');
const { focusHref } = require('./callQueue');

const DEFAULT_WINDOW_DAYS = 7;

const SIGNAL_TYPES = Object.freeze([
  'sms_reply',
  'email_reply',
  'link_click',
  'mail_scan',
  'audit_open',
  'email_open',
]);

function inferSignalTypeFromUpdate(entry) {
  if (entry && entry.signalType && SIGNAL_TYPES.includes(entry.signalType)) {
    return entry.signalType;
  }
  const blob = String((entry && entry.value) || '').toLowerCase();
  if (blob.includes('sms reply')) return 'sms_reply';
  if (blob.includes('email reply')) return 'email_reply';
  if (blob.includes('postcard qr') || blob.includes('mail scan')) return 'mail_scan';
  if (blob.includes('audit open')) return 'audit_open';
  if (blob.includes('email open')) return 'email_open';
  if (blob.includes('link click')) return 'link_click';
  return '';
}

function leadTitle(lead) {
  return String(lead?.title || lead?.company || lead?.email || 'Lead').trim().slice(0, 120) || 'Lead';
}

function eventKey(leadKey, signalType, at) {
  return `${String(leadKey || '')}|${String(signalType || '')}|${String(at || '')}`;
}

function eventsFromUpdates(lead, cutoffMs) {
  const out = [];
  const updates = Array.isArray(lead?.updates) ? lead.updates : [];
  for (const u of updates) {
    if (!u || u.type !== 'engagement_signal') continue;
    const atMs = Date.parse(u.timestamp || '');
    if (!Number.isFinite(atMs) || atMs < cutoffMs) continue;
    const signalType = inferSignalTypeFromUpdate(u) || 'link_click';
    const at = u.timestamp || new Date(atMs).toISOString();
    out.push({
      id: eventKey(lead.key, signalType, at),
      leadKey: lead.key,
      leadTitle: leadTitle(lead),
      signalType,
      signalLabel: signalLabel(signalType),
      at,
      atMs,
      detail: String(u.value || signalLabel(signalType)).trim(),
      provider: String(u.provider || '').trim(),
      linkUrl: String(u.linkUrl || '').trim(),
      priority: SIGNAL_PRIORITY[signalType] ?? 99,
      href: focusHref(lead.key),
      focusLeadParam: String(lead.key || '').replace(/^lead:/i, ''),
    });
  }
  return out;
}

/** Synthesize events from engagementSignals.*At when timeline entries are missing. */
function eventsFromSignalFields(lead, cutoffMs) {
  const out = [];
  const s = normalizeEngagementSignals(lead?.engagementSignals);
  for (const [signalType, field] of Object.entries(SIGNAL_FIELD)) {
    const at = s[field];
    const atMs = Date.parse(at || '');
    if (!at || !Number.isFinite(atMs) || atMs < cutoffMs) continue;
    out.push({
      id: eventKey(lead.key, signalType, at),
      leadKey: lead.key,
      leadTitle: leadTitle(lead),
      signalType,
      signalLabel: signalLabel(signalType),
      at,
      atMs,
      detail: signalLabel(signalType),
      provider: '',
      linkUrl: '',
      priority: SIGNAL_PRIORITY[signalType] ?? 99,
      href: focusHref(lead.key),
      focusLeadParam: String(lead.key || '').replace(/^lead:/i, ''),
      synthesized: true,
    });
  }
  return out;
}

function mergeEvents(primary, fallback) {
  const seen = new Set(primary.map((e) => e.id));
  const merged = [...primary];
  for (const e of fallback) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  return merged;
}

const REPLY_SIGNALS = new Set(['sms_reply', 'email_reply']);
const THREAD_TYPES = new Set(['sms_inbound', 'email_inbound', 'sms_outbound', 'email_outbound']);

function cleanThreadText(raw, direction) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (direction === 'out') {
    text = text.replace(/^Outbound\s+(SMS|Email|iMessage)\s*:\s*/i, '');
  }
  return text.slice(0, 400);
}

/**
 * Full SMS/email thread for a lead in the window — inbound (prospect) and outbound (you/rep),
 * oldest first so the inbox reads like a conversation.
 */
function conversationFor(lead, cutoffMs) {
  const list = [];
  for (const u of Array.isArray(lead?.updates) ? lead.updates : []) {
    const typ = String((u && u.type) || '').toLowerCase();
    if (!u || !THREAD_TYPES.has(typ)) continue;
    const atMs = Date.parse(u.timestamp || '');
    if (!Number.isFinite(atMs) || atMs < cutoffMs) continue;
    const direction = typ.endsWith('_outbound') ? 'out' : 'in';
    const text = cleanThreadText(u.value || u.body || u.message, direction);
    if (!text) continue;
    list.push({
      at: u.timestamp,
      atMs,
      channel: typ.startsWith('email_') ? 'email' : 'sms',
      direction,
      text,
    });
  }
  list.sort((a, b) => a.atMs - b.atMs || (a.direction === 'in' ? -1 : 1));
  return list;
}

/** @deprecated Prefer conversationFor — kept for callers that only want inbound texts. */
function inboundRepliesFor(lead, cutoffMs) {
  return conversationFor(lead, cutoffMs)
    .filter((m) => m.direction === 'in')
    .reverse()
    .map((m) => ({ ...m, repeat: 1 }));
}

function leadSendPrefill(lead) {
  if (!lead) return null;
  const name = String(lead.title || lead.company || lead.name || '').trim().slice(0, 200);
  const phone = String(lead.phone || lead.mobile || '').trim().slice(0, 40);
  const email = String(lead.email || '').trim().slice(0, 200);
  // Teammate send requires a reachable contact — skip when neither phone nor email exists.
  if (!phone && !email) return null;
  return {
    name: name || email || phone || 'Lead',
    phone,
    email,
    city: String(lead.city || '').trim().slice(0, 80),
    zip: String(lead.zip || lead.postalCode || '').trim().slice(0, 16),
    address: String(lead.address || lead.street || '').trim().slice(0, 200),
  };
}

/** One row per business (at its highest-priority signal) with a signal count and the reply texts. */
function groupEventsByLead(events, leadsByKey, cutoffMs) {
  const rows = [];
  const byLead = new Map();
  for (const ev of events) {
    let row = byLead.get(ev.leadKey);
    if (!row) {
      row = { ...ev, count: 0, replyCount: 0, latestAt: ev.at, latestAtMs: ev.atMs };
      byLead.set(ev.leadKey, row);
      rows.push(row);
    }
    row.count += 1;
    if (REPLY_SIGNALS.has(ev.signalType)) row.replyCount += 1;
    if (ev.atMs > row.latestAtMs) {
      row.latestAt = ev.at;
      row.latestAtMs = ev.atMs;
    }
  }
  for (const row of rows) {
    const lead = leadsByKey.get(row.leadKey);
    const thread = lead && row.replyCount ? conversationFor(lead, cutoffMs) : [];
    row.thread = thread;
    // Inbound-only list (newest first) for badges / older clients.
    row.replies = thread.filter((m) => m.direction === 'in').reverse().map((m) => ({ ...m, repeat: 1 }));
    row.sendLead = leadSendPrefill(lead);
    if (thread.length) {
      const lastIn = [...thread].reverse().find((m) => m.direction === 'in');
      if (lastIn && row.sendLead) {
        row.sendLead.note = `Warm ${lastIn.channel === 'email' ? 'email' : 'SMS'} reply — follow up: ${lastIn.text}`.slice(0, 1000);
      }
    }
    row.countLabel =
      row.count < 2 ? '' : row.replyCount === row.count ? `${row.count} replies` : `${row.count} signals`;
  }
  return rows;
}

function summarizeEvents(events) {
  const byType = Object.fromEntries(SIGNAL_TYPES.map((t) => [t, 0]));
  for (const e of events) {
    if (byType[e.signalType] != null) byType[e.signalType] += 1;
  }
  return {
    total: events.length,
    byType,
    uniqueLeads: new Set(events.map((e) => e.leadKey)).size,
  };
}

/** True when a lead has an SMS/email reply signal inside the window (fields or timeline). */
function leadHasWarmReplyInWindow(lead, cutoffMs) {
  if (!lead) return false;
  const s = normalizeEngagementSignals(lead.engagementSignals);
  for (const field of ['smsRepliedAt', 'emailRepliedAt']) {
    const atMs = Date.parse(s[field] || '');
    if (Number.isFinite(atMs) && atMs >= cutoffMs) return true;
  }
  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  for (const u of updates) {
    if (!u || u.type !== 'engagement_signal') continue;
    const atMs = Date.parse(u.timestamp || '');
    if (!Number.isFinite(atMs) || atMs < cutoffMs) continue;
    const signalType = inferSignalTypeFromUpdate(u) || '';
    if (REPLY_SIGNALS.has(signalType)) return true;
  }
  return false;
}

/**
 * Unique leads with a recent SMS/email reply signal — same window as /engagement.
 * Use this for Today “replies waiting” so the count matches the inbox (not historic logs).
 * Fast path: does not build the full engagement inbox (important for 1k+ lead workspaces).
 * @param {object[]} leads
 * @param {{ windowDays?: number, now?: Date }} [opts]
 * @returns {number}
 */
function countWarmReplyLeads(leads, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const windowDays =
    typeof opts.windowDays === 'number' ? opts.windowDays : DEFAULT_WINDOW_DAYS;
  const cutoffMs = now.getTime() - windowDays * 86400000;
  let count = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || !lead.key) continue;
    if (leadHasWarmReplyInWindow(lead, cutoffMs)) count += 1;
  }
  return count;
}

/**
 * @param {object[]} leads
 * @param {{ windowDays?: number, signalType?: string, limit?: number, now?: Date }} [opts]
 */
function buildEngagementInbox(leads, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const nowMs = now.getTime();
  const windowDays =
    typeof opts.windowDays === 'number' ? opts.windowDays : DEFAULT_WINDOW_DAYS;
  const cutoffMs = nowMs - windowDays * 86400000;
  const filterType = String(opts.signalType || '').trim();
  const limit = typeof opts.limit === 'number' ? opts.limit : 200;

  let events = [];
  const leadsByKey = new Map();
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || !lead.key) continue;
    leadsByKey.set(lead.key, lead);
    const fromUpdates = eventsFromUpdates(lead, cutoffMs);
    const fromFields = eventsFromSignalFields(lead, cutoffMs);
    events = events.concat(mergeEvents(fromUpdates, fromFields));
  }

  if (filterType && SIGNAL_TYPES.includes(filterType)) {
    events = events.filter((e) => e.signalType === filterType);
  }

  events.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.atMs - a.atMs;
  });

  const summary = summarizeEvents(events);
  return {
    windowDays,
    events: events.slice(0, limit),
    rows: groupEventsByLead(events, leadsByKey, cutoffMs).slice(0, limit),
    summary,
  };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  SIGNAL_TYPES,
  buildEngagementInbox,
  countWarmReplyLeads,
  inferSignalTypeFromUpdate,
  conversationFor,
  inboundRepliesFor,
};
