/** Workspace-wide lead activity feed (notes, calls, SMS, status changes). */

const QUICK_LOG_PILL_LABELS =
  'Gatekeeper|No pickup|Left VM|Not interested|Callback requested|DM connected|Send info|Site audit';

const NOISE_LOG_TYPES = new Set(['sequence_step']);
const NOISE_UPDATE_TYPES = new Set(['sms_status', 'call_status', 'voicemail_amd']);

function activityEntryTextFromRaw(u) {
  if (!u || typeof u !== 'object') return '';
  if (u.value != null && String(u.value).trim()) return String(u.value).trim();
  if (u.content != null && String(u.content).trim()) return String(u.content).trim();
  if (u.message != null && String(u.message).trim()) return String(u.message).trim();
  if (u.note != null && String(u.note).trim()) return String(u.note).trim();
  return '';
}

function formatActivityEntryText(entry) {
  const u = entry && entry.raw ? entry.raw : {};
  const typ = String(entry.typ || '').toLowerCase();
  if (typ === 'quick_log') {
    const label = String(u.value || entry.text || '').trim();
    const bits = [label];
    if (u.disposition) bits.push(`Disposition: ${String(u.disposition).replace(/_/g, ' ')}`);
    if (u.statusChange) bits.push(`Status → ${u.statusChange}`);
    return bits.filter(Boolean).join(' · ');
  }
  return String(entry.text || '').trim();
}

function formatActivityTypeLabel(typ, raw) {
  const t = String(typ || '').toLowerCase();
  const map = {
    quick_log: 'Quick log',
    note: 'Note',
    call_disposition: 'Call',
    status_change: 'Pipeline',
    call_browser_handoff: 'Call',
    call_outbound: 'Call',
    sms_outbound: 'SMS',
    sms_inbound: 'SMS',
    email_outbound: 'Email',
    direct_mail_outbound: 'Direct mail',
    voicemail_drop: 'Voicemail',
  };
  if (map[t]) return map[t];
  if (t === 'quick_log' && raw && raw.disposition) return 'Quick log · call';
  return String(typ || 'update').replace(/_/g, ' ');
}

function isQuickLogMirroredNote(entry) {
  const typ = String(entry.typ || '').toLowerCase();
  if (typ === 'quick_log') return true;
  const raw = entry.raw || {};
  if (raw.disposition || raw.statusChange) return true;
  const text = String(entry.text || '').trim();
  if (new RegExp(`^\\[[^\\]]+\\]\\s+(${QUICK_LOG_PILL_LABELS})\\s*$`, 'i').test(text)) {
    return true;
  }
  return false;
}

function isManualPanelNote(entry) {
  const typ = String(entry.typ || '').toLowerCase();
  const raw = entry.raw || {};
  if (typ === 'quick_log') return false;
  if (isQuickLogMirroredNote(entry)) return false;
  if (typ === 'call_disposition' || typ === 'status_change') return false;
  if (/^sequence|^cadence/i.test(typ)) return false;
  if (raw.source === 'panel_post' || raw.manual === true) return true;
  if (typ === 'note' && raw.source !== 'quick_log_pill') return true;
  return ['user_note', 'post', 'comment', 'manual_note'].includes(typ);
}

function activityEntryMatchesFilter(entry, filter) {
  const f = String(filter || 'all').toLowerCase();
  if (f === 'all') return true;
  const typ = String(entry.typ || '').toLowerCase();
  const text = String(entry.text || '').toLowerCase();
  const blob = `${typ} ${text}`;
  if (f === 'calls') {
    if (typ === 'quick_log' && entry.raw && entry.raw.disposition) return true;
    return (
      /(^|_)(call|dial|phone|voicemail|sms|text_message|telephony|imessage)(_|$|\b)/i.test(typ) ||
      /\b(called|calling|dialed|dial|voicemail|softphone|telephony|phone touch|sms sent|imessage)\b/i.test(
        blob,
      )
    );
  }
  if (f === 'notes') {
    return isManualPanelNote(entry);
  }
  if (f === 'status') {
    return (
      typ === 'status_change' ||
      typ === 'call_disposition' ||
      (typ === 'quick_log' && !!(entry.raw && (entry.raw.disposition || entry.raw.statusChange)))
    );
  }
  return true;
}

function isNoiseEntry(entry) {
  const typ = String(entry.typ || '').toLowerCase();
  if (NOISE_LOG_TYPES.has(typ) || NOISE_UPDATE_TYPES.has(typ)) return true;
  if (/^sequence|^cadence/i.test(typ)) return true;
  const text = String(entry.text || '').trim();
  if (!text) return true;
  return false;
}

function mergeLeadActivityEntries(lead, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const maxPerSource = Number.isFinite(o.maxPerSource) ? o.maxPerSource : 24;
  const out = [];
  const seen = new Set();

  const pushUnique = (entry) => {
    if (isNoiseEntry(entry)) return;
    const text = String(entry.text || '').trim();
    if (!text) return;
    const tsMs = Date.parse(entry.ts) || 0;
    const bucket = tsMs ? Math.floor(tsMs / 1000) : String(entry.ts || '');
    const key = `${bucket}|${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  const updates = Array.isArray(lead && lead.updates) ? lead.updates : [];
  updates
    .slice(-maxPerSource)
    .forEach((u) => {
      const ts = u.timestamp || u.ts || u.createdAt || '';
      const val = activityEntryTextFromRaw(u);
      const typ = String(u.type || 'update');
      pushUnique({ ts, typ, text: val, raw: u });
    });

  const logs = Array.isArray(lead && lead.logs) ? lead.logs : [];
  logs.slice(-maxPerSource).forEach((e) => {
    const ts = e.timestamp || '';
    const msg = typeof e.message === 'string' ? e.message : JSON.stringify(e).slice(0, 220);
    const typ = String(e.type || 'log');
    pushUnique({ ts, typ, text: msg, raw: e });
  });

  out.sort((a, b) => {
    const ta = Date.parse(a.ts) || 0;
    const tb = Date.parse(b.ts) || 0;
    return tb - ta;
  });
  return out;
}

function buildWorkspaceActivityFeed(leads, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const filter = String(opts.filter || 'all').toLowerCase();
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  const sinceDays = Number.isFinite(opts.sinceDays) ? opts.sinceDays : 14;
  const sinceMs =
    opts.sinceMs != null && Number.isFinite(opts.sinceMs)
      ? opts.sinceMs
      : Date.now() - sinceDays * 86400000;

  const groups = [];
  let totalEvents = 0;

  for (const lead of leads || []) {
    if (!lead || !lead.key) continue;
    const events = [];
    for (const e of mergeLeadActivityEntries(lead)) {
      if (!activityEntryMatchesFilter(e, filter)) continue;
      const tsMs = Date.parse(e.ts) || 0;
      if (sinceMs && tsMs && tsMs < sinceMs) continue;
      events.push({
        ts: e.ts || '',
        tsMs,
        type: e.typ,
        typeLabel: formatActivityTypeLabel(e.typ, e.raw),
        text: formatActivityEntryText(e).slice(0, 500),
      });
    }
    if (!events.length) continue;
    events.sort((a, b) => b.tsMs - a.tsMs);
    totalEvents += events.length;
    groups.push({
      leadKey: lead.key,
      leadTitle: String(lead.title || lead.company || lead.email || 'Lead').slice(0, 120),
      folderKey: String(lead.folderKey || '').trim(),
      status: String(lead.status || '').trim(),
      city: String(lead.city || '').trim(),
      latestTs: events[0].ts,
      latestTsMs: events[0].tsMs,
      eventCount: events.length,
      events,
    });
  }

  groups.sort((a, b) => b.latestTsMs - a.latestTsMs);
  return {
    groups: groups.slice(offset, offset + limit),
    total: groups.length,
    totalEvents,
    filter,
    limit,
    offset,
    sinceDays,
  };
}

module.exports = {
  activityEntryTextFromRaw,
  formatActivityEntryText,
  formatActivityTypeLabel,
  isManualPanelNote,
  activityEntryMatchesFilter,
  mergeLeadActivityEntries,
  buildWorkspaceActivityFeed,
};
