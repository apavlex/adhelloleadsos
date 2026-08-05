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

function mapTouchEntry(entry) {
  const at = entry.ts || '';
  const typeLabel = formatActivityTypeLabel(entry.typ, entry.raw);
  const text = formatActivityEntryText(entry).slice(0, 220);
  const typ = String(entry.typ || '').toLowerCase();
  return {
    at,
    atLabel: formatTouchWhen(at),
    typeLabel,
    text,
    isEngagement: typ === 'engagement_signal' || typ === 'sms_inbound' || typ === 'email_inbound',
  };
}

/**
 * @param {object} lead
 * @param {{ limit?: number, windowDays?: number, now?: Date }} [opts]
 */
function buildLeadTouchPoints(lead, opts = {}) {
  const limit = typeof opts.limit === 'number' ? opts.limit : 8;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 7;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());

  const merged = mergeLeadActivityEntries(lead, { maxPerSource: 40 });
  const primary = collapsePrimaryActivities(merged);
  const recentTouches = primary.slice(0, limit).map(mapTouchEntry);

  const channel = String(lead?.lastTouchChannel || '').trim();
  const channelLabel = formatTouchChannelLabel(channel);
  const badge = engagementBadgeForLead(lead, windowDays, now.getTime());

  const latest = recentTouches[0] || null;
  const fallbackMs = lastActivityMs(lead);
  const lastTouch = latest
    ? {
        at: latest.at,
        atLabel: latest.atLabel,
        channel,
        channelLabel: channelLabel || latest.typeLabel,
        typeLabel: latest.typeLabel,
        text: latest.text,
        summary: [channelLabel || latest.typeLabel, latest.atLabel].filter(Boolean).join(' · '),
      }
    : {
        at: fallbackMs ? new Date(fallbackMs).toISOString() : '',
        atLabel: fallbackMs ? formatTouchWhen(new Date(fallbackMs).toISOString()) : '—',
        channel,
        channelLabel: channelLabel || 'Not set',
        typeLabel: '',
        text: '',
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
    totalCount: primary.length,
  };
}

module.exports = {
  TOUCH_CHANNEL_LABELS,
  formatTouchChannelLabel,
  formatTouchWhen,
  buildLeadTouchPoints,
};
