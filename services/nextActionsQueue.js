/**
 * Unified "Next Actions" queue for /today — tasks, cadence, nextActionAt, report opens.
 * Dedupes by leadKey (task > cadence > nextActionAt > report_open).
 */

const { buildCadenceQueue } = require('./cadenceQueue');

const KIND_PRIORITY = {
  task: 1,
  cadence: 2,
  next_action: 3,
  report_open: 4,
};

function endOfTodayMs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
}

function focusHref(leadKey) {
  const short = String(leadKey || '').replace(/^lead:/i, '');
  return short ? `/focus?lead=${encodeURIComponent(short)}` : '/pipeline';
}

function pipelineHref(leadKey) {
  return leadKey ? `/pipeline?focusLead=${encodeURIComponent(leadKey)}` : '/pipeline';
}

/**
 * @param {object} opts
 * @param {object[]} opts.tasks — enriched user tasks
 * @param {object[]} opts.leads — workspace-visible leads
 * @param {object} [opts.cadenceQueue] — output of buildCadenceQueue (optional; built if omitted)
 * @param {object[]} [opts.reportsOpened24h]
 * @param {string} [opts.baseUrl]
 * @param {Date} [opts.now]
 * @param {number} [opts.limit]
 */
function buildNextActionsQueue(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const endToday = endOfTodayMs(now);
  const nowMs = now.getTime();
  const leads = Array.isArray(opts.leads) ? opts.leads : [];
  const leadMap = Object.fromEntries(leads.map((l) => [l.key, l]));
  const baseUrl = String(opts.baseUrl || '').replace(/\/$/, '');
  const cadenceQueue = opts.cadenceQueue || buildCadenceQueue(leads, baseUrl);
  const byLead = new Map();

  function upsert(item) {
    const key = item.leadKey;
    if (!key) return;
    const existing = byLead.get(key);
    if (!existing) {
      byLead.set(key, item);
      return;
    }
    const existingPri = KIND_PRIORITY[existing.kind] || 99;
    const newPri = KIND_PRIORITY[item.kind] || 99;
    if (newPri < existingPri) {
      byLead.set(key, item);
      return;
    }
    if (newPri === existingPri) {
      const a = Date.parse(item.scheduledAt || '') || 0;
      const b = Date.parse(existing.scheduledAt || '') || 0;
      if (a < b) byLead.set(key, item);
    }
  }

  for (const t of opts.tasks || []) {
    if (!t || t.column === 'done') continue;
    const ts = Date.parse(t.scheduledAt || '');
    if (!Number.isFinite(ts) || ts > endToday) continue;
    const L = t.leadKey && leadMap[t.leadKey];
    upsert({
      kind: 'task',
      leadKey: t.leadKey || null,
      leadTitle: t.leadTitle || (L ? String(L.title || L.company || 'Lead').slice(0, 120) : null),
      scheduledAt: t.scheduledAt,
      title: String(t.title || 'Follow-up task').slice(0, 200),
      href: t.leadKey ? pipelineHref(t.leadKey) : '/tasks',
      overdue: ts < nowMs,
      kindLabel: 'Task',
    });
  }

  const cadenceBuckets = ['calls', 'emails', 'texts', 'linkedin', 'other'];
  for (const bucket of cadenceBuckets) {
    for (const item of cadenceQueue[bucket] || []) {
      if (!item || !item.leadKey) continue;
      upsert({
        kind: 'cadence',
        leadKey: item.leadKey,
        leadTitle: item.title,
        scheduledAt: item.nextDueAt,
        title: item.stepTitle || 'Cadence step',
        href: focusHref(item.leadKey),
        overdue: !!item.overdue,
        kindLabel: 'Cadence',
      });
    }
  }

  for (const lead of leads) {
    if (!lead || !lead.key || !lead.nextActionAt) continue;
    const ts = Date.parse(lead.nextActionAt);
    if (!Number.isFinite(ts) || ts > endToday) continue;
    upsert({
      kind: 'next_action',
      leadKey: lead.key,
      leadTitle: String(lead.title || lead.company || 'Lead').slice(0, 120),
      scheduledAt: lead.nextActionAt,
      title: 'Scheduled follow-up',
      href: focusHref(lead.key),
      overdue: ts < nowMs,
      kindLabel: 'Follow-up',
    });
  }

  for (const row of opts.reportsOpened24h || []) {
    if (!row || !row.leadKey) continue;
    const viewed = row.lastViewedAt || new Date(nowMs).toISOString();
    upsert({
      kind: 'report_open',
      leadKey: row.leadKey,
      leadTitle: row.leadTitle || 'Lead',
      scheduledAt: viewed,
      title: 'Opened site audit report',
      href: row.focusLeadParam
        ? `/focus?lead=${encodeURIComponent(row.focusLeadParam)}`
        : focusHref(row.leadKey),
      overdue: false,
      kindLabel: 'Audit open',
    });
  }

  const limit = typeof opts.limit === 'number' ? opts.limit : 30;
  return [...byLead.values()]
    .sort((a, b) => {
      const aOver = a.overdue ? 0 : 1;
      const bOver = b.overdue ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return Date.parse(a.scheduledAt || 0) - Date.parse(b.scheduledAt || 0);
    })
    .slice(0, limit);
}

module.exports = {
  buildNextActionsQueue,
  endOfTodayMs,
};
