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
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || !lead.key) continue;
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
    summary,
  };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  SIGNAL_TYPES,
  buildEngagementInbox,
  inferSignalTypeFromUpdate,
};
