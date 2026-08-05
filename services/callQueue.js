/**
 * Call queue for engaged leads (replies, clicks, audit/email opens).
 */
const {
  normalizeEngagementSignals,
  signalPriorityForLead,
  signalLabel,
  isClosedOrConnected,
} = require('./engagementSignals');

const DEFAULT_WINDOW_DAYS = 7;

function focusHref(leadKey) {
  const short = String(leadKey || '').replace(/^lead:/i, '');
  return short ? `/focus?lead=${encodeURIComponent(short)}&channel=call` : '/focus?channel=call';
}

function hasRecentSignal(lead, windowDays, nowMs) {
  const s = normalizeEngagementSignals(lead && lead.engagementSignals);
  const cutoff = nowMs - windowDays * 86400000;
  const stamps = [
    s.smsRepliedAt,
    s.emailRepliedAt,
    s.linkClickedAt,
    s.auditOpenedAt,
    s.emailOpenedAt,
    s.lastSignalAt,
  ]
    .map((x) => Date.parse(x || ''))
    .filter(Number.isFinite);
  return stamps.some((ts) => ts >= cutoff);
}

function primarySignalType(lead) {
  const s = normalizeEngagementSignals(lead && lead.engagementSignals);
  if (s.smsRepliedAt) return 'sms_reply';
  if (s.emailRepliedAt) return 'email_reply';
  if (s.linkClickedAt) return 'link_click';
  if (s.auditOpenedAt) return 'audit_open';
  if (s.emailOpenedAt) return 'email_open';
  return s.lastSignalType || 'engagement';
}

/**
 * @param {object[]} leads
 * @param {{ windowDays?: number, limit?: number, now?: Date }} [opts]
 */
function buildCallQueue(leads, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const nowMs = now.getTime();
  const windowDays =
    typeof opts.windowDays === 'number' ? opts.windowDays : DEFAULT_WINDOW_DAYS;
  const limit = typeof opts.limit === 'number' ? opts.limit : 50;

  return (Array.isArray(leads) ? leads : [])
    .filter((lead) => {
      if (!lead || !lead.key) return false;
      if (isClosedOrConnected(lead)) return false;
      return hasRecentSignal(lead, windowDays, nowMs);
    })
    .map((lead) => {
      const signalType = primarySignalType(lead);
      const s = normalizeEngagementSignals(lead.engagementSignals);
      const signalAt = s.lastSignalAt || null;
      return {
        leadKey: lead.key,
        leadTitle: String(lead.title || lead.company || lead.email || 'Lead').slice(0, 120),
        signalType,
        signalLabel: signalLabel(signalType),
        signalAt: signalAt || s.lastSignalAt,
        priority: signalPriorityForLead(lead),
        href: focusHref(lead.key),
        prospecting: lead.prospecting || null,
      };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return Date.parse(b.signalAt || 0) - Date.parse(a.signalAt || 0);
    })
    .slice(0, limit);
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  buildCallQueue,
  focusHref,
  hasRecentSignal,
  primarySignalType,
};
