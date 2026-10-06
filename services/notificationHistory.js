/**
 * Notification history: inbound activity (forms, calls, voicemails, texts, emails),
 * finished lead searches, and logged bell notifications, newest first.
 */
const { TYPE_LABELS, ACTIONABLE_TYPES, lastFollowUpMs } = require('./inboundEvents');

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 300;
const KINDS = ['inbound', 'search', 'other'];

function toMs(raw) {
  const t = Date.parse(String(raw || ''));
  return Number.isFinite(t) ? t : 0;
}

function shortKey(key) {
  return String(key || '').replace(/^lead:/i, '');
}

function inboundEntries(leads, cutoff) {
  const out = [];
  for (const lead of Array.isArray(leads) ? leads : []) {
    const events = Array.isArray(lead && lead.inboundEvents) ? lead.inboundEvents : [];
    if (!events.length) continue;
    const handledMs = lastFollowUpMs(lead);
    const short = shortKey(lead.key);
    const who = String(lead.title || lead.name || 'Unknown contact').trim();
    for (const e of events) {
      const at = toMs(e && e.at);
      if (!e || !TYPE_LABELS[e.type] || at < cutoff) continue;
      const actionable = ACTIONABLE_TYPES.has(e.type);
      out.push({
        id: `inbound:${short}:${e.id || e.at}`,
        kind: 'inbound',
        type: e.type,
        at: new Date(at).toISOString(),
        title: `${TYPE_LABELS[e.type]}: ${who}`,
        body: [e.label, e.preview].filter(Boolean).join(' · '),
        href: `/focus?lead=${encodeURIComponent(short)}${e.type === 'sms' || e.type === 'email' ? '' : '&channel=call'}`,
        linkLabel: e.type === 'sms' || e.type === 'email' ? 'Reply' : 'Call',
        status: actionable ? (at > handledMs ? 'open' : 'handled') : '',
      });
    }
  }
  return out;
}

function searchEntries(searches, cutoff) {
  const out = [];
  for (const s of Array.isArray(searches) ? searches : []) {
    const at = toMs(s && (s.timestamp || s.createdAt));
    if (!s || at < cutoff) continue;
    const failed = String(s.status || '') === 'failed';
    const count = Number(s.resultCount);
    const what = [String(s.keyword || '').trim(), [s.city, s.state].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' in ');
    const label = s.source === 'scheduled' ? 'Scheduled scrape' : 'Lead search';
    const folder = String(s.targetFolderKey || '').trim();
    out.push({
      id: `search:${s.key || at}`,
      kind: 'search',
      type: failed ? 'search_failed' : 'search',
      at: new Date(at).toISOString(),
      title: failed ? `${label} failed` : Number.isFinite(count) && count === 0 ? `${label}: no leads found` : `${label} complete`,
      body: [what ? `"${what}"` : '', failed ? String(s.error || '').slice(0, 200) : Number.isFinite(count) ? `${count} lead${count === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(' · '),
      href: !failed && folder ? `/prospecting?tab=pipeline&folderKey=${encodeURIComponent(folder)}` : '/history',
      linkLabel: failed ? 'Details' : 'View results',
      status: '',
    });
  }
  return out;
}

function loggedEntries(logged, cutoff, userEmail) {
  const me = String(userEmail || '').trim().toLowerCase();
  return (Array.isArray(logged) ? logged : [])
    .filter((n) => n && toMs(n.at) >= cutoff && (!n.userEmail || !me || n.userEmail === me))
    .map((n) => ({
      id: `log:${n.id}`,
      kind: 'other',
      type: 'job',
      at: n.at,
      title: n.title,
      body: n.body || '',
      href: n.href || '',
      linkLabel: n.linkLabel || (n.href ? 'Open' : ''),
      status: '',
    }));
}

/**
 * @param {{ leads?: object[], searches?: object[], logged?: object[], userEmail?: string, kind?: string, now?: number, days?: number, limit?: number }} input
 */
function buildNotificationHistory(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const cutoff = now - (input.days || DEFAULT_DAYS) * 86400000;
  const kind = KINDS.includes(input.kind) ? input.kind : 'all';
  const all = [
    ...inboundEntries(input.leads, cutoff),
    ...searchEntries(input.searches, cutoff),
    ...loggedEntries(input.logged, cutoff, input.userEmail),
  ];
  const counts = { all: all.length, inbound: 0, search: 0, other: 0 };
  for (const e of all) counts[e.kind] += 1;
  const items = (kind === 'all' ? all : all.filter((e) => e.kind === kind))
    .sort((a, b) => toMs(b.at) - toMs(a.at))
    .slice(0, input.limit || DEFAULT_LIMIT);
  return { items, counts, kind };
}

module.exports = { buildNotificationHistory, KINDS };
