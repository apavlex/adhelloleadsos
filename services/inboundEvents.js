/**
 * Inbound activity per lead (form/ad leads, missed calls, voicemails, texts, emails)
 * and the "Inbound" feed on Today: events nobody has followed up on yet.
 */
const dbService = require('./database');

const MAX_EVENTS_PER_LEAD = 20;
const FEED_DAYS = 7;
const FEED_LIMIT = 25;

const TYPE_LABELS = {
  form: 'New form lead',
  missed_call: 'Missed call',
  voicemail: 'Voicemail',
  call: 'Inbound call',
  sms: 'Text',
  email: 'Email',
};

/** Events that need a follow-up (answered calls are logged but not queued). */
const ACTIONABLE_TYPES = new Set(['form', 'missed_call', 'voicemail', 'sms', 'email']);

/** A later update of one of these types means someone already followed up. */
const FOLLOW_UP_UPDATE_TYPES = new Set([
  'call_outbound',
  'call_browser_handoff',
  'sms_outbound',
  'email_outbound',
  'note',
]);

function toIso(raw) {
  if (raw == null || raw === '') return new Date().toISOString();
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function toMs(raw) {
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function normalizeInboundEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const type = String(ev.type || '').trim().toLowerCase();
  if (!TYPE_LABELS[type]) return null;
  const at = toIso(ev.at);
  return {
    id: String(ev.id || `${type}:${at}`).trim().slice(0, 160),
    type,
    at,
    label: String(ev.label || '').trim().slice(0, 140),
    preview: String(ev.preview || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    source: String(ev.source || '').trim().slice(0, 60),
  };
}

/** Append (deduped by id), keep newest MAX_EVENTS_PER_LEAD, oldest first. */
function appendInboundEvent(existing, ev) {
  const entry = normalizeInboundEvent(ev);
  const list = (Array.isArray(existing) ? existing : []).filter((e) => e && typeof e === 'object');
  if (!entry) return list;
  if (list.some((e) => e.id === entry.id)) return list;
  return [...list, entry]
    .sort((a, b) => toMs(a.at) - toMs(b.at))
    .slice(-MAX_EVENTS_PER_LEAD);
}

async function recordInboundEvent(leadKey, workspaceId, ev) {
  const lead = await dbService.getLead(leadKey);
  if (!lead) return null;
  const next = appendInboundEvent(lead.inboundEvents, ev);
  return dbService.updateLead(lead.key || leadKey, { inboundEvents: next }, workspaceId || undefined);
}

/** Latest time someone followed up on this lead (outbound touch, note, or "Done"). */
function lastFollowUpMs(lead) {
  let best = toMs(lead && lead.inboundHandledAt);
  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  for (const u of updates) {
    if (!u || !FOLLOW_UP_UPDATE_TYPES.has(String(u.type || ''))) continue;
    const t = toMs(u.timestamp);
    if (t > best) best = t;
  }
  return best;
}

function shortLeadKey(key) {
  return String(key || '').replace(/^lead:/i, '');
}

function cleanContact(v) {
  const s = String(v || '').trim();
  return s && s.toUpperCase() !== 'N/A' ? s : '';
}

/**
 * One row per lead with unhandled inbound activity in the last FEED_DAYS days, newest first.
 * @param {object[]} leads
 * @param {{ now?: number, days?: number, limit?: number }} [opts]
 */
function pendingInboundItems(leads, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const cutoff = now - (opts.days || FEED_DAYS) * 86400000;
  const limit = opts.limit || FEED_LIMIT;
  const rows = [];
  for (const lead of Array.isArray(leads) ? leads : []) {
    const events = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
    if (!events.length) continue;
    const handledMs = lastFollowUpMs(lead);
    const open = events.filter((e) => {
      if (!e || !ACTIONABLE_TYPES.has(e.type)) return false;
      const t = toMs(e.at);
      return t >= cutoff && t > handledMs;
    });
    if (!open.length) continue;
    const latest = open.reduce((a, b) => (toMs(b.at) >= toMs(a.at) ? b : a));
    const short = shortLeadKey(lead.key);
    const types = [...new Set(open.map((e) => e.type))];
    rows.push({
      leadKey: lead.key,
      short,
      title: String(lead.title || lead.name || 'Unknown contact').trim(),
      phone: cleanContact(lead.phone),
      email: cleanContact(lead.email),
      type: latest.type,
      typeLabel: TYPE_LABELS[latest.type],
      label: latest.label || '',
      preview: latest.preview || '',
      at: latest.at,
      count: open.length,
      otherTypes: types.filter((t) => t !== latest.type).map((t) => TYPE_LABELS[t]),
      focusHref: `/focus?lead=${encodeURIComponent(short)}`,
      callHref: `/focus?lead=${encodeURIComponent(short)}&channel=call`,
      openHref: `/pipeline?focusLead=${encodeURIComponent(short)}`,
    });
  }
  rows.sort((a, b) => toMs(b.at) - toMs(a.at));
  return rows.slice(0, limit);
}

module.exports = {
  TYPE_LABELS,
  ACTIONABLE_TYPES,
  FOLLOW_UP_UPDATE_TYPES,
  MAX_EVENTS_PER_LEAD,
  normalizeInboundEvent,
  appendInboundEvent,
  recordInboundEvent,
  lastFollowUpMs,
  pendingInboundItems,
};
