/**
 * Per-lead touch history for Focus and lead panel sidebar.
 */
const {
  mergeLeadActivityEntries,
  collapsePrimaryActivities,
  formatActivityEntryText,
  formatActivityTypeLabel,
} = require('./leadActivityFeed');
const { engagementBadgeForLead } = require('./engagementSignals');
const { lastActivityMs } = require('./focusQueue');
const { classifyNoteAttribution, noteTypeLabel } = require('./leadNoteAttribution');

const TOUCH_CHANNEL_LABELS = Object.freeze({
  call: 'Phone call',
  email: 'Email',
  sms: 'SMS',
  social_dm: 'Social DM',
  linkedin: 'LinkedIn',
  hosted_audit: 'Emailed audit',
  direct_mail: 'Direct mail',
  voicemail: 'Voicemail',
  meeting: 'Meeting',
  other: 'Other',
});

function formatTouchChannelLabel(channel) {
  const raw = String(channel || '').trim();
  if (!raw) return '';
  return TOUCH_CHANNEL_LABELS[raw] || raw.replace(/_/g, ' ');
}

function formatTouchWhen(ts) {
  const ms = Date.parse(ts || '');
  if (!Number.isFinite(ms)) return '—';
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** A message the business sent us (SMS/email reply), as opposed to our own outreach or opens/clicks. */
function isBusinessReply(entry) {
  const typ = String((entry && entry.typ) || '').toLowerCase();
  if (typ === 'sms_inbound' || typ === 'email_inbound') return true;
  if (typ !== 'engagement_signal') return false;
  const raw = (entry && entry.raw) || {};
  return /reply/i.test(String(raw.signalType || raw.signal || ''));
}

function mapTouchEntry(entry, opts = {}) {
  const at = entry.ts || '';
  const typ = String(entry.typ || '').toLowerCase();
  const fullText = formatActivityEntryText(entry);
  const isNoteLike = typ === 'note' || typ === 'user_note' || typ === 'post' || typ === 'comment' || typ === 'manual_note';
  const attribution = isNoteLike ? classifyNoteAttribution(entry.raw || {}, opts) : null;
  const typeLabel = isNoteLike
    ? noteTypeLabel(entry.raw || {}, opts)
    : formatActivityTypeLabel(entry.typ, entry.raw);
  return {
    at,
    atLabel: formatTouchWhen(at),
    typeLabel,
    /** Full note text for UI (expandable). Preview kept for compact rows. */
    text: fullText,
    textPreview: fullText.length > 220 ? `${fullText.slice(0, 220)}…` : fullText,
    attribution,
    isNote: isNoteLike,
    isEngagement: typ === 'engagement_signal' || typ === 'sms_inbound' || typ === 'email_inbound',
    isReply: isBusinessReply(entry),
  };
}

/**
 * @param {object} lead
 * @param {{ limit?: number, windowDays?: number, now?: Date, viewerEmail?: string }} [opts]
 */
function buildLeadTouchPoints(lead, opts = {}) {
  const limit = typeof opts.limit === 'number' ? opts.limit : 8;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 7;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const mapOpts = { viewerEmail: opts.viewerEmail || '' };

  const merged = mergeLeadActivityEntries(lead, { maxPerSource: 40 });
  const primary = collapsePrimaryActivities(merged);
  const all = primary.map((e) => mapTouchEntry(e, mapOpts));
  const replies = all.filter((t) => t.isReply);
  const recentTouches = replies.slice(0, limit).concat(all.filter((t) => !t.isReply).slice(0, limit));
  const latestReply = replies[0]
    ? { ...replies[0], summary: [`${replies[0].typeLabel} reply`, replies[0].atLabel].filter(Boolean).join(' · ') }
    : null;

  const channel = String(lead?.lastTouchChannel || '').trim();
  const channelLabel = formatTouchChannelLabel(channel);
  const badge = engagementBadgeForLead(lead, windowDays, now.getTime());

  const latest = all[0] || null;
  const fallbackMs = lastActivityMs(lead);
  const lastTouch = latest
    ? {
        at: latest.at,
        atLabel: latest.atLabel,
        channel,
        channelLabel: channelLabel || latest.typeLabel,
        typeLabel: latest.typeLabel,
        text: latest.text,
        textPreview: latest.textPreview,
        attribution: latest.attribution || null,
        isNote: !!latest.isNote,
        summary: [channelLabel || latest.typeLabel, latest.atLabel].filter(Boolean).join(' · '),
      }
    : {
        at: fallbackMs ? new Date(fallbackMs).toISOString() : '',
        atLabel: fallbackMs ? formatTouchWhen(new Date(fallbackMs).toISOString()) : '—',
        channel,
        channelLabel: channelLabel || 'Not set',
        typeLabel: '',
        text: '',
        textPreview: '',
        attribution: null,
        isNote: false,
        summary: channelLabel
          ? `${channelLabel}${fallbackMs ? ` · ${formatTouchWhen(new Date(fallbackMs).toISOString())}` : ''}`
          : fallbackMs
            ? formatTouchWhen(new Date(fallbackMs).toISOString())
            : '—',
      };

  return {
    lastTouch,
    engagementBadge: badge
      ? { label: badge.label, signalType: badge.signalType || '', at: badge.at || '' }
      : null,
    recentTouches,
    latestReply,
    replyCount: replies.length,
    totalCount: primary.length,
  };
}

module.exports = {
  isBusinessReply,
  TOUCH_CHANNEL_LABELS,
  formatTouchChannelLabel,
  formatTouchWhen,
  buildLeadTouchPoints,
};
