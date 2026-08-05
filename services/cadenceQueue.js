const { getTemplate } = require('./sequenceTemplates');
const { expandCadenceText } = require('./cadenceTokens');
const phoneLineType = require('./phoneLineType');

function endOfTodayMs() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
}

/**
 * Leads with an active cadence whose next step is due by end of today (includes overdue).
 * Buckets by channel for the Today command center.
 */
function buildCadenceQueue(leads, baseUrl) {
  const endToday = endOfTodayMs();
  const now = Date.now();
  const buckets = {
    calls: [],
    emails: [],
    texts: [],
    linkedin: [],
    other: [],
  };
  let overdueCount = 0;

  for (const lead of leads || []) {
    const st = lead.sequenceState;
    if (!st || st.status !== 'active' || !st.nextDueAt) continue;
    const due = Date.parse(st.nextDueAt);
    if (!Number.isFinite(due)) continue;
    if (due > endToday) continue;

    const tpl = getTemplate(st.templateId);
    const idx = typeof st.stepIndex === 'number' ? st.stepIndex : 0;
    if (!tpl || !tpl.steps || !tpl.steps[idx]) continue;

    const step = tpl.steps[idx];
    const title = String(step.title || '').trim();
    const rawHint = [step.hint || '', step.bodyHint || ''].filter(Boolean).join(' — ');
    const hint = expandCadenceText(rawHint, lead, { baseUrl });
    const phone = lead.phone && String(lead.phone).trim() && lead.phone !== 'N/A' ? String(lead.phone).trim() : '';

    const item = {
      leadKey: lead.key,
      title: String(lead.title || lead.company || 'Lead').slice(0, 120),
      phone,
      channel: String(step.channel || 'task').toLowerCase(),
      stepTitle: expandCadenceText(title, lead, { baseUrl }),
      stepHint: hint,
      templateId: st.templateId,
      nextDueAt: st.nextDueAt,
      overdue: due < now,
    };
    if (item.overdue) overdueCount += 1;

    const ch = item.channel;
    const callFirst = phoneLineType.prefersCallFirst(lead);
    if ((ch === 'sms' || ch === 'text') && callFirst) {
      buckets.calls.push({ ...item, channel: 'call', callFirstOverride: true });
      continue;
    }
    if (ch === 'call' || ch === 'phone' || ch === 'voicemail') buckets.calls.push(item);
    else if (ch === 'email') buckets.emails.push(item);
    else if (ch === 'sms' || ch === 'text') buckets.texts.push(item);
    else if (ch === 'linkedin') buckets.linkedin.push(item);
    else buckets.other.push(item);
  }

  const sortDue = (a, b) => Date.parse(a.nextDueAt) - Date.parse(b.nextDueAt);
  Object.values(buckets).forEach((arr) => arr.sort(sortDue));

  return { ...buckets, overdueCount, totalDue: Object.values(buckets).reduce((n, a) => n + a.length, 0) };
}

module.exports = {
  buildCadenceQueue,
};
