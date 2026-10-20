/**
 * Inbound activity per lead (form/ad leads, missed calls, voicemails, texts, emails)
 * and the "Inbound" feed on Today: events nobody has followed up on yet.
 */
const dbService = require('./database');
const { leadConnectorOpenUrl } = require('./ghlDeepLinks');

const MAX_EVENTS_PER_LEAD = 20;
const FEED_DAYS = 7;
const FEED_LIMIT = 25;
const GHL_ACTIVITY_DAYS = 30;
const GHL_ACTIVITY_LIMIT = 200;

const TYPE_LABELS = {
  form: 'New form lead',
  missed_call: 'Missed call',
  voicemail: 'Voicemail',
  call: 'Inbound call',
  sms: 'Text',
  email: 'Email',
};

/** Missed calls + SMS shown on the dedicated GHL / Lead Connector activity page. */
const GHL_ACTIVITY_TYPES = new Set(['missed_call', 'voicemail', 'sms']);

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
  const out = {
    id: String(ev.id || `${type}:${at}`).trim().slice(0, 160),
    type,
    at,
    label: String(ev.label || '').trim().slice(0, 140),
    preview: String(ev.preview || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    source: String(ev.source || '').trim().slice(0, 60),
  };
  const contactId = String(ev.ghlContactId || ev.contactId || '').trim();
  if (contactId) out.ghlContactId = contactId.slice(0, 80);
  const conversationId = String(ev.conversationId || '').trim();
  if (conversationId) out.conversationId = conversationId.slice(0, 80);
  return out;
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

function focusHrefFor(short) {
  return `/focus?lead=${encodeURIComponent(short)}`;
}

function focusCallHrefFor(short) {
  return `/focus?lead=${encodeURIComponent(short)}&channel=call`;
}

/**
 * Attach Lead Connector / GHL open URLs (app.gohighlevel.com) so Call can hand
 * off to the Lead Connector app when the OS associates that host with the app.
 * @param {object} row
 * @param {{ lead?: object, locationId?: string, dashboardUrl?: string, event?: object }} ctx
 */
function withLeadConnectorLinks(row, ctx = {}) {
  const lead = ctx.lead || {};
  const contactId = String(
    (ctx.event && ctx.event.ghlContactId) || lead.ghlContactId || row.ghlContactId || '',
  ).trim();
  const conversationId = String(
    (ctx.event && ctx.event.conversationId) || row.conversationId || '',
  ).trim();
  const preferConversation = row.type === 'sms';
  const ghlHref = leadConnectorOpenUrl({
    dashboardUrl: ctx.dashboardUrl,
    locationId: ctx.locationId,
    contactId,
    conversationId,
    preferConversation,
  });
  const hasLc = !!(ghlHref && contactId && String(ctx.locationId || '').trim());
  const phone = cleanContact(row.phone || lead.phone);
  const focusSms = focusHrefFor(row.short);
  const focusCall = focusCallHrefFor(row.short);
  return {
    ...row,
    ghlContactId: contactId || '',
    conversationId: conversationId || '',
    ghlHref: hasLc ? ghlHref : '',
    // Call / Reply in Lead Connector when linked; else Focus (or tel: as last resort for call).
    callHref: hasLc
      ? ghlHref
      : row.type === 'sms' || row.type === 'email'
        ? focusSms
        : phone
          ? `tel:${phone}`
          : focusCall,
    callExternal: hasLc,
    callOpensLeadConnector: hasLc,
    focusHref: row.focusHref || focusHrefFor(row.short),
  };
}

/**
 * One row per lead with unhandled inbound activity in the last FEED_DAYS days, newest first.
 * @param {object[]} leads
 * @param {{ now?: number, days?: number, limit?: number, locationId?: string, dashboardUrl?: string }} [opts]
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
    const base = {
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
      focusHref: focusHrefFor(short),
      openHref: `/pipeline?focusLead=${encodeURIComponent(short)}`,
      handled: false,
    };
    rows.push(
      withLeadConnectorLinks(base, {
        lead,
        event: latest,
        locationId: opts.locationId,
        dashboardUrl: opts.dashboardUrl,
      }),
    );
  }
  rows.sort((a, b) => toMs(b.at) - toMs(a.at));
  return rows.slice(0, limit);
}

/**
 * Full GHL missed-call + SMS history (one row per event, includes handled).
 * Call opens Lead Connector when the lead has a GHL contact id.
 * @param {object[]} leads
 * @param {{ now?: number, days?: number, limit?: number, locationId?: string, dashboardUrl?: string, types?: string[] }} [opts]
 */
function listGhlCallSmsItems(leads, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const cutoff = now - (opts.days || GHL_ACTIVITY_DAYS) * 86400000;
  const limit = opts.limit || GHL_ACTIVITY_LIMIT;
  const allow = Array.isArray(opts.types) && opts.types.length
    ? new Set(opts.types.map((t) => String(t).toLowerCase()))
    : GHL_ACTIVITY_TYPES;
  const rows = [];
  for (const lead of Array.isArray(leads) ? leads : []) {
    const events = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
    if (!events.length) continue;
    const handledMs = lastFollowUpMs(lead);
    const short = shortLeadKey(lead.key);
    for (const e of events) {
      if (!e || !allow.has(e.type)) continue;
      const t = toMs(e.at);
      if (t < cutoff) continue;
      const base = {
        id: e.id || `${e.type}:${e.at}`,
        leadKey: lead.key,
        short,
        title: String(lead.title || lead.name || 'Unknown contact').trim(),
        phone: cleanContact(lead.phone),
        email: cleanContact(lead.email),
        type: e.type,
        typeLabel: TYPE_LABELS[e.type] || e.type,
        label: e.label || '',
        preview: e.preview || '',
        at: e.at,
        source: e.source || 'ghl',
        handled: t <= handledMs,
        focusHref: focusHrefFor(short),
        openHref: `/pipeline?focusLead=${encodeURIComponent(short)}`,
      };
      rows.push(
        withLeadConnectorLinks(base, {
          lead,
          event: e,
          locationId: opts.locationId,
          dashboardUrl: opts.dashboardUrl,
        }),
      );
    }
  }
  rows.sort((a, b) => toMs(b.at) - toMs(a.at));
  return rows.slice(0, limit);
}

module.exports = {
  TYPE_LABELS,
  ACTIONABLE_TYPES,
  FOLLOW_UP_UPDATE_TYPES,
  GHL_ACTIVITY_TYPES,
  MAX_EVENTS_PER_LEAD,
  GHL_ACTIVITY_DAYS,
  GHL_ACTIVITY_LIMIT,
  normalizeInboundEvent,
  appendInboundEvent,
  recordInboundEvent,
  lastFollowUpMs,
  pendingInboundItems,
  listGhlCallSmsItems,
  withLeadConnectorLinks,
};
