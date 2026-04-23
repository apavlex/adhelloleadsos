/**
 * Infer daily tracker-style counts from lead activity logs (UTC calendar day).
 * Used to surface softphone / sequence / cadence signals without manual entry.
 */

const { utcCalendarDayPrefix, touchesForRow } = require('./trackerStats');

const CALL_LOG_TYPES = new Set(['call_outbound', 'call_browser_handoff', 'voicemail_drop']);

/**
 * @param {Array<object>} leads Workspace leads (already permission-filtered).
 * @param {string} dateStr YYYY-MM-DD (UTC day boundary, same convention as daily tracker keys).
 * @returns {{ coldCalls: number, coldEmails: number, coldDms: number, upworkBids: number, socialPosts: number, adCreatives: number }}
 */
function inferDailyTouchCountsFromLeads(leads, dateStr) {
  let coldCalls = 0;
  let coldEmails = 0;
  let coldDms = 0;
  for (const lead of leads || []) {
    const logs = Array.isArray(lead.logs) ? lead.logs : [];
    for (const log of logs) {
      if (!log || utcCalendarDayPrefix(log.timestamp) !== dateStr) continue;
      const typ = String(log.type || '');
      if (CALL_LOG_TYPES.has(typ)) {
        coldCalls += 1;
        continue;
      }
      if (typ === 'sequence_step') {
        const ch = String((log.meta && log.meta.channel) || '').toLowerCase();
        if (ch === 'email') coldEmails += 1;
        else if (ch === 'linkedin' || ch === 'li' || ch === 'dm') coldDms += 1;
        else if (ch === 'task') coldCalls += 1;
      }
    }
  }
  return {
    coldCalls,
    coldEmails,
    coldDms,
    upworkBids: 0,
    socialPosts: 0,
    adCreatives: 0,
  };
}

function inferredTouchesTotal(inf) {
  if (!inf) return 0;
  return (
    (inf.coldCalls || 0) +
    (inf.coldEmails || 0) +
    (inf.coldDms || 0) +
    (inf.upworkBids || 0) +
    (inf.socialPosts || 0) +
    (inf.adCreatives || 0)
  );
}

/**
 * Per-channel max(saved manual, inferred from lead logs) so charts and streaks
 * reflect CRM activity without double-counting when reps also saved the same totals.
 */
function displayTouchTotalsForDay(row, leads, dateStr) {
  const emails = parseInt(row && row.coldEmails, 10) || 0;
  const dms = parseInt(row && row.coldDms, 10) || 0;
  const calls = parseInt(row && row.coldCalls, 10) || 0;
  const bids = parseInt(row && row.upworkBids, 10) || 0;
  const socialPosts = parseInt(row && row.socialPosts, 10) || 0;
  const adCreatives = parseInt(row && row.adCreatives, 10) || 0;
  const inf = inferDailyTouchCountsFromLeads(leads, dateStr);
  const e = Math.max(emails, inf.coldEmails || 0);
  const d = Math.max(dms, inf.coldDms || 0);
  const c = Math.max(calls, inf.coldCalls || 0);
  const b = Math.max(bids, inf.upworkBids || 0);
  const s = Math.max(socialPosts, inf.socialPosts || 0);
  const a = Math.max(adCreatives, inf.adCreatives || 0);
  return {
    emails: e,
    dms: d,
    calls: c,
    bids: b,
    socialPosts: s,
    adCreatives: a,
    total: e + d + c + b + s + a,
  };
}

function buildDailyChartDisplaySeries(todayStr, rows, days, leads) {
  const ls = Array.isArray(leads) ? leads : [];
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r && r.date) map.set(r.date, r);
  });
  const out = [];
  const end = new Date(`${todayStr}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const t = displayTouchTotalsForDay(map.get(key) || null, ls, key);
    out.push({ date: key, total: t.total });
  }
  return out;
}

function enrichRollupWithLeadInference(rollup, leads) {
  if (!rollup || !Array.isArray(rollup.days)) return rollup;
  const ls = Array.isArray(leads) ? leads : [];
  const days = rollup.days.map((day) => {
    const row = {
      coldEmails: day.emails,
      coldDms: day.dms,
      coldCalls: day.calls,
      upworkBids: day.bids,
      socialPosts: day.socialPosts,
      adCreatives: day.adCreatives,
    };
    const t = displayTouchTotalsForDay(row, ls, day.date);
    return {
      ...day,
      emails: t.emails,
      dms: t.dms,
      calls: t.calls,
      bids: t.bids,
      socialPosts: t.socialPosts,
      adCreatives: t.adCreatives,
      total: t.total,
    };
  });
  const sumTotal = days.reduce((s, x) => s + x.total, 0);
  const daysWithActivity = days.filter((x) => x.total > 0).length;
  return { days, sumTotal, daysWithActivity };
}

function computeOutreachStreakWithLeads(rows, todayStr, leads) {
  const ls = Array.isArray(leads) ? leads : [];
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r && r.date) map.set(r.date, r);
  });
  let streak = 0;
  const start = new Date(`${todayStr}T12:00:00Z`);
  for (let i = 0; i < 120; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    const t = ls.length
      ? displayTouchTotalsForDay(row || null, ls, key).total
      : touchesForRow(row);
    if (t > 0) streak += 1;
    else break;
  }
  return streak;
}

module.exports = {
  inferDailyTouchCountsFromLeads,
  inferredTouchesTotal,
  displayTouchTotalsForDay,
  buildDailyChartDisplaySeries,
  enrichRollupWithLeadInference,
  computeOutreachStreakWithLeads,
};
