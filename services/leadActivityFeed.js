/** Workspace-wide lead activity feed (notes, calls, SMS, status changes). */

const QUICK_LOG_PILL_LABELS =
  'Gatekeeper|No pickup|Left VM|Not interested|Callback requested|DM connected|Send info|Site audit';

const NOISE_LOG_TYPES = new Set(['sequence_step']);
const NOISE_UPDATE_TYPES = new Set(['sms_status', 'call_status', 'voicemail_amd', 'voicemail_status']);

const SECONDARY_ACTIVITY_TYPES = new Set([
  'status_change',
  'assignment',
  'call_queued',
  'direct_mail_queued',
]);

const PRIMARY_TOUCH_TYPES = new Set([
  'note',
  'user_note',
  'post',
  'comment',
  'manual_note',
  'quick_log',
  'call_disposition',
  'call_outbound',
  'call_browser_handoff',
  'sms_outbound',
  'sms_inbound',
  'email_outbound',
  'direct_mail_outbound',
  'voicemail_drop',
]);

function isSecondaryActivityText(text, typ) {
  const t = String(text || '').trim();
  if (!t) return true;
  const tl = t.toLowerCase();
  const type = String(typ || '').toLowerCase();
  if (/^signalwire call initiated\b/i.test(t)) return true;
  if (/^disposition set to\b/i.test(t)) return true;
  if (/^(ghl |signalwire |comms )?(sms|imessage) sent\b/i.test(t) && /\([^\)]+\)\s*$/.test(t)) return true;
  if (/^ghl email sent\b/i.test(t) || (/^email sent\b/i.test(t) && /\([^\)]+\)\s*$/.test(t))) return true;
  if (type === 'call_outbound' && /^outbound call initiated\b/i.test(t) && tl.includes('signalwire')) return true;
  return false;
}

function isSecondaryActivityEntry(entry) {
  const typ = String(entry.typ || '').toLowerCase();
  if (SECONDARY_ACTIVITY_TYPES.has(typ)) return true;
  if (isSecondaryActivityText(entry.text, typ)) return true;
  return false;
}

function isPrimaryActivityEntry(entry) {
  if (isNoiseEntry(entry)) return false;
  if (isSecondaryActivityEntry(entry)) return false;

  const typ = String(entry.typ || '').toLowerCase();
  if (isManualPanelNote(entry)) return true;
  if (PRIMARY_TOUCH_TYPES.has(typ)) return true;
  return false;
}

function collapsePrimaryActivities(entries) {
  const primary = (entries || []).filter(isPrimaryActivityEntry);
  primary.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));

  const out = [];
  const CALL_WINDOW_MS = 20 * 60 * 1000;

  for (const entry of primary) {
    const typ = String(entry.typ || '').toLowerCase();
    const tsMs = Date.parse(entry.ts) || 0;
    const textNorm = String(entry.text || '').trim().toLowerCase().slice(0, 96);

    if (typ === 'call_disposition' || typ === 'quick_log') {
      const dup = out.find((e) => {
        const et = String(e.typ || '').toLowerCase();
        if (et !== typ) return false;
        const dt = Math.abs((Date.parse(e.ts) || 0) - tsMs);
        if (dt > 120000) return false;
        return String(e.text || '').trim().toLowerCase().slice(0, 96) === textNorm;
      });
      if (dup) continue;
    }

    if (typ === 'call_outbound') {
      const hasNearbyOutcome = primary.some((e) => {
        const et = String(e.typ || '').toLowerCase();
        if (et !== 'call_disposition' && et !== 'quick_log') return false;
        return Math.abs((Date.parse(e.ts) || 0) - tsMs) <= CALL_WINDOW_MS;
      });
      if (hasNearbyOutcome) continue;
    }

    out.push(entry);
  }

  return out;
}

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
  if (typ === 'call_outbound') {
    const rawText = String(entry.text || '').trim();
    const phoneMatch = rawText.match(/\(([^)]+)\)/);
    if (/^outbound call initiated\b/i.test(rawText)) {
      return phoneMatch ? `Call made (${phoneMatch[1]})` : 'Call made';
    }
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
    call_outbound: 'Call made',
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
      (typ === 'call_disposition' && !isSecondaryActivityText(entry.text, typ)) ||
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
    const merged = mergeLeadActivityEntries(lead);
    const filtered = merged.filter((e) => activityEntryMatchesFilter(e, filter));
    const primary =
      filter === 'notes'
        ? filtered
        : collapsePrimaryActivities(filtered);
    const events = [];
    for (const e of primary) {
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
      tags: Array.isArray(lead.tags) ? lead.tags.map(String).filter(Boolean) : [],
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
  isPrimaryActivityEntry,
  isSecondaryActivityEntry,
  collapsePrimaryActivities,
  activityEntryMatchesFilter,
  mergeLeadActivityEntries,
  buildWorkspaceActivityFeed,
};
