/** Delivery milestones that imply a personalized outreach touch was made */
const PERSONALIZED_TOUCH_STATUSES = new Set([
  'Email Sent',
  'Called Lead',
  'Follow-up',
  'Video Recorded',
  'Closed - Won',
  'Closed - Lost',
]);

function utcCalendarDayPrefix(iso) {
  if (!iso || typeof iso !== 'string') return '';
  return iso.slice(0, 10);
}

/**
 * Whether this lead had at least one qualifying outreach signal on the given UTC calendar day.
 * Each lead counts at most once per day (multiple notes / status changes same day still = 1).
 */
function leadHasPersonalizedTouchOnUtcDate(lead, dateStr) {
  const updates = Array.isArray(lead.updates) ? lead.updates : [];
  for (const u of updates) {
    if (utcCalendarDayPrefix(u.timestamp) !== dateStr) continue;
    if (u.type === 'note' && String(u.value || '').trim()) return true;
    if (
      u.type === 'status_change' &&
      PERSONALIZED_TOUCH_STATUSES.has(String(u.value || '').trim())
    ) {
      return true;
    }
  }
  const logs = Array.isArray(lead.logs) ? lead.logs : [];
  for (const log of logs) {
    if (utcCalendarDayPrefix(log.timestamp) !== dateStr) continue;
    if (String(log.type || '') === 'sequence_step') return true;
  }
  return false;
}

/**
 * Unique leads in the workspace with ≥1 personalized touch logged on dateStr (UTC YYYY-MM-DD).
 */
function countUniqueLeadsTouchedOnUtcDate(leads, dateStr) {
  let n = 0;
  for (const lead of leads || []) {
    if (leadHasPersonalizedTouchOnUtcDate(lead, dateStr)) n += 1;
  }
  return n;
}

/** Daily goal for personalized (unique-lead) touches — override with DAILY_TOUCH_GOAL */
function dailyPersonalizedTouchGoal() {
  return Math.max(1, parseInt(process.env.DAILY_TOUCH_GOAL || '54', 10) || 54);
}

/**
 * Outreach streak: consecutive calendar days (from today backward) with any logged activity.
 * @param {Array<{ date?: string, coldEmails?: number, coldDms?: number, coldCalls?: number, upworkBids?: number }>} rows
 * @param {string} todayStr YYYY-MM-DD
 */
function touchesForRow(row) {
  if (!row) return 0;
  return (
    (parseInt(row.coldEmails, 10) || 0) +
    (parseInt(row.coldDms, 10) || 0) +
    (parseInt(row.coldCalls, 10) || 0) +
    (parseInt(row.upworkBids, 10) || 0) +
    (parseInt(row.socialPosts, 10) || 0) +
    (parseInt(row.adCreatives, 10) || 0)
  );
}

function computeOutreachStreak(rows, todayStr) {
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
    const t = touchesForRow(map.get(key));
    if (t > 0) streak += 1;
    else break;
  }
  return streak;
}

/**
 * Last N days for bar chart (oldest first). Fills missing days with 0.
 * @param {string} todayStr
 * @param {Array} rows from listDailyTrackers (any order)
 * @param {number} days
 */
function buildDailyChartSeries(todayStr, rows, days = 14) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r && r.date) map.set(r.date, touchesForRow(r));
  });
  const out = [];
  const end = new Date(`${todayStr}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, total: map.get(key) || 0 });
  }
  return out;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Rolling window of calendar days ending on todayStr (index 0 = today), for checklist UI.
 * @param {string} todayStr YYYY-MM-DD
 * @param {Array} rows from listDailyTrackers
 * @param {number} numDays e.g. 7 or 30
 */
function buildDayRollup(todayStr, rows, numDays) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r && r.date) map.set(r.date, r);
  });
  const end = new Date(`${todayStr}T12:00:00Z`);
  const out = [];
  for (let i = 0; i < numDays; i += 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key) || null;
    const emails = parseInt(row && row.coldEmails, 10) || 0;
    const dms = parseInt(row && row.coldDms, 10) || 0;
    const calls = parseInt(row && row.coldCalls, 10) || 0;
    const bids = parseInt(row && row.upworkBids, 10) || 0;
    const socialPosts = parseInt(row && row.socialPosts, 10) || 0;
    const adCreatives = parseInt(row && row.adCreatives, 10) || 0;
    const total = emails + dms + calls + bids + socialPosts + adCreatives;
    const notes = (row && row.notes && String(row.notes).trim()) || '';
    const callNotes = (row && row.callNotes && String(row.callNotes).trim()) || '';
    const isToday = i === 0;
    out.push({
      date: key,
      label: `${WD[d.getUTCDay()]} · ${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      isToday,
      emails,
      dms,
      calls,
      bids,
      socialPosts,
      adCreatives,
      total,
      hasNotes: !!(notes || callNotes),
      notes,
      callNotes,
    });
  }
  const sumTotal = out.reduce((s, x) => s + x.total, 0);
  const daysWithActivity = out.filter((x) => x.total > 0).length;
  return { days: out, sumTotal, daysWithActivity };
}

module.exports = {
  touchesForRow,
  computeOutreachStreak,
  buildDailyChartSeries,
  buildDayRollup,
  countUniqueLeadsTouchedOnUtcDate,
  dailyPersonalizedTouchGoal,
  leadHasPersonalizedTouchOnUtcDate,
  PERSONALIZED_TOUCH_STATUSES,
  utcCalendarDayPrefix,
};
