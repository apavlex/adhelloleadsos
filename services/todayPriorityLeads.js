const { isManualSource } = require('./leadListFilters');
const { normalizeEngagementSignals, signalLabel } = require('./engagementSignals');
const { isManualUserTask } = require('./userTasks');

const PREVIEW_LIMIT = 5;

function leadTitle(lead) {
  return String((lead && (lead.title || lead.company || lead.email)) || 'Lead').slice(0, 80);
}

function focusHref(lead) {
  const short = String((lead && lead.key) || '').replace(/^lead:/i, '');
  return `/focus?lead=${encodeURIComponent(short)}`;
}

function createdMs(lead) {
  const t = Date.parse((lead && (lead.createdAt || lead.addedAt || lead.savedAt)) || '');
  return Number.isFinite(t) ? t : 0;
}

function tagBlob(lead) {
  const tags = Array.isArray(lead && lead.tags) ? lead.tags : [];
  return tags
    .map((tag) => {
      if (tag && typeof tag === 'object') return `${tag.key || ''} ${tag.name || ''} ${tag.label || ''}`;
      return String(tag || '');
    })
    .join(' ');
}

function isReferralLead(lead) {
  const blob = [
    lead && lead.source,
    lead && lead.sourceChannel,
    lead && lead.sourceType,
    lead && lead.categoryName,
    tagBlob(lead),
  ]
    .join(' ')
    .toLowerCase();
  return /\breferral/.test(blob);
}

function replyMeta(lead) {
  const signals = normalizeEngagementSignals(lead && lead.engagementSignals);
  const sms = Date.parse(signals.smsRepliedAt || '');
  const email = Date.parse(signals.emailRepliedAt || '');
  if (Number.isFinite(sms) || Number.isFinite(email)) {
    const smsMs = Number.isFinite(sms) ? sms : 0;
    const emailMs = Number.isFinite(email) ? email : 0;
    const at = Math.max(smsMs, emailMs);
    const type = smsMs >= emailMs ? 'sms_reply' : 'email_reply';
    return { at, label: signalLabel(type) };
  }
  const logs = Array.isArray(lead && lead.logs)
    ? lead.logs
    : Array.isArray(lead && lead.updates)
      ? lead.updates
      : [];
  let best = 0;
  for (let i = Math.max(0, logs.length - 24); i < logs.length; i += 1) {
    const log = logs[i] || {};
    const blob = `${log.type || ''} ${log.message || ''} ${log.value || ''}`.toLowerCase();
    if (!blob.includes('reply') && !blob.includes('replied') && !blob.includes('inbound')) continue;
    const at = Date.parse(log.timestamp || log.at || '') || 0;
    if (at > best) best = at;
  }
  if (!best) return null;
  return { at: best, label: 'Replied' };
}

function isFollowUpTask(task) {
  if (!task || task.column === 'done' || !task.leadKey) return false;
  const source = String(task.source || '').trim().toLowerCase();
  if (source === 'cadence' || source === 'engagement' || source === 'routing') return false;
  if (source === 'disposition' || isManualUserTask(task)) return true;
  return false;
}

function placeLine(lead) {
  return [lead && lead.city, lead && lead.state].filter(Boolean).join(', ');
}

function toRow(lead, detail) {
  return {
    key: String((lead && lead.key) || ''),
    title: leadTitle(lead),
    detail: String(detail || '').trim(),
    href: focusHref(lead),
  };
}

function pack(items, href) {
  return {
    count: items.length,
    items: items.slice(0, PREVIEW_LIMIT),
    href,
  };
}

/**
 * Personal lead buckets for the Today page.
 * @param {{ leads?: object[], tasks?: object[] }} input
 */
function buildTodayPriorityLeads(input) {
  const leads = Array.isArray(input && input.leads) ? input.leads : [];
  const tasks = Array.isArray(input && input.tasks) ? input.tasks : [];
  const byKey = new Map();
  leads.forEach((lead) => {
    if (lead && lead.key) byKey.set(lead.key, lead);
  });

  const added = leads
    .filter(isManualSource)
    .sort((a, b) => createdMs(b) - createdMs(a))
    .map((lead) => toRow(lead, placeLine(lead) || 'Added by you'));

  const followSeen = new Set();
  const followUp = tasks
    .filter(isFollowUpTask)
    .slice()
    .sort((a, b) => (Date.parse(a.scheduledAt || '') || Infinity) - (Date.parse(b.scheduledAt || '') || Infinity))
    .filter((task) => {
      if (followSeen.has(task.leadKey) || !byKey.has(task.leadKey)) return false;
      followSeen.add(task.leadKey);
      return true;
    })
    .map((task) => {
      const lead = byKey.get(task.leadKey);
      const when = task.scheduledAt
        ? new Date(task.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Follow-up';
      return toRow(lead, when);
    });

  const responded = leads
    .map((lead) => ({ lead, reply: replyMeta(lead) }))
    .filter((row) => row.reply)
    .sort((a, b) => b.reply.at - a.reply.at)
    .map((row) => toRow(row.lead, row.reply.label));

  const referrals = leads
    .filter(isReferralLead)
    .sort((a, b) => createdMs(b) - createdMs(a))
    .map((lead) => toRow(lead, placeLine(lead) || 'Referral'));

  return {
    added: pack(added, '/prospecting?tab=pipeline&origin=manual'),
    followUp: pack(followUp, '/tasks'),
    responded: pack(responded, '/engagement'),
    referrals: pack(referrals, '/prospecting?tab=pipeline&q=referral'),
  };
}

module.exports = {
  buildTodayPriorityLeads,
  isReferralLead,
  isFollowUpTask,
};
