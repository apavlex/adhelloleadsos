/**
 * Monthly action-plan grid — completions per day per activity.
 */

const dbService = require('./database');
const pipelineStagesService = require('./pipelineStagesService');
const { ACTION_PLAN_CATEGORIES, ALL_ACTIVITY_IDS } = require('./actionPlanActivities');

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizeYearMonth(year, month) {
  const y = parseInt(year, 10) || new Date().getFullYear();
  const m = Math.min(12, Math.max(1, parseInt(month, 10) || new Date().getMonth() + 1));
  return { year: y, month: m };
}

function normalizeCompletions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([date, val]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return;
    const ids = Array.isArray(val) ? val : [];
    out[date] = ids.filter((id) => ALL_ACTIVITY_IDS.includes(id));
  });
  return out;
}

async function countClientsAcquiredYtd(workspaceId, leads) {
  const year = new Date().getFullYear();
  const stages = await pipelineStagesService.ensureWorkspaceStagesSeeded(workspaceId || 'default');
  const wonStageIds = new Set(
    (stages || []).filter((s) => s && s.isWon).map((s) => String(s.id)),
  );
  const wonIndexes = new Set(
    (stages || [])
      .map((s, i) => (s && s.isWon ? i + 1 : null))
      .filter((n) => n != null),
  );

  let count = 0;
  for (const lead of leads || []) {
    const stageId = lead.stageId ? String(lead.stageId) : '';
    const ps = parseInt(lead.pipelineStage, 10);
    const onWon =
      (stageId && wonStageIds.has(stageId)) ||
      (Number.isFinite(ps) && wonIndexes.has(ps)) ||
      /\b(won|client|closed)\b/i.test(String(lead.status || ''));
    if (!onWon) continue;
    const ts = Date.parse(lead.updatedAt || lead.createdAt || '');
    if (!Number.isFinite(ts)) continue;
    if (new Date(ts).getFullYear() === year) count += 1;
  }
  return count;
}

function buildDailyTotals(completions, year, month) {
  const dim = daysInMonth(year, month);
  const totals = {};
  for (let d = 1; d <= dim; d += 1) {
    const key = dateKey(year, month, d);
    const ids = completions[key] || [];
    totals[key] = ids.length;
  }
  return totals;
}

function monthlyTotal(completions, year, month) {
  const dim = daysInMonth(year, month);
  let sum = 0;
  for (let d = 1; d <= dim; d += 1) {
    const key = dateKey(year, month, d);
    sum += (completions[key] || []).length;
  }
  return sum;
}

/**
 * @param {{ workspaceId: string, email: string, year?: number, month?: number, leads?: object[] }} opts
 */
async function loadMonthView(opts) {
  const { year, month } = normalizeYearMonth(opts.year, opts.month);
  const wid = opts.workspaceId || 'default';
  const email = opts.email || 'anon';
  const stored = await dbService.getActionPlanMonth(wid, email, year, month);
  const completions = normalizeCompletions(stored && stored.completions);
  const clientGoal =
    stored && stored.clientGoal != null ? parseInt(stored.clientGoal, 10) || 5 : 5;
  const dim = daysInMonth(year, month);
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const clientsAcquiredYtd = await countClientsAcquiredYtd(
    wid,
    opts.leads || (await dbService.getAllLeads(wid)),
  );

  return {
    year,
    month,
    monthLabel: `${MONTH_NAMES[month - 1].toUpperCase()} ${year}`,
    monthShort: MONTH_SHORT[month - 1],
    daysInMonth: dim,
    days: Array.from({ length: dim }, (_, i) => i + 1),
    categories: ACTION_PLAN_CATEGORIES,
    completions,
    dailyTotals: buildDailyTotals(completions, year, month),
    monthlyTotal: monthlyTotal(completions, year, month),
    clientGoal,
    clientsAcquiredYtd,
    todayKey,
    todayDay: today.getDate(),
    isCurrentMonth: today.getFullYear() === year && today.getMonth() + 1 === month,
  };
}

async function toggleCell({ workspaceId, email, date, activityId }) {
  const dateStr = String(date || '').trim();
  const act = String(activityId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Invalid date');
  if (!ALL_ACTIVITY_IDS.includes(act)) throw new Error('Invalid activity');

  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const wid = workspaceId || 'default';
  const stored = await dbService.getActionPlanMonth(wid, email, year, month);
  const completions = normalizeCompletions(stored && stored.completions);
  const cur = new Set(completions[dateStr] || []);
  if (cur.has(act)) cur.delete(act);
  else cur.add(act);
  completions[dateStr] = [...cur];

  await dbService.saveActionPlanMonth(wid, email, year, month, {
    ...(stored || {}),
    completions,
  });

  return {
    date: dateStr,
    activityId: act,
    checked: cur.has(act),
    dayTotal: cur.size,
    monthlyTotal: monthlyTotal(completions, year, month),
    dailyTotals: buildDailyTotals(completions, year, month),
  };
}

module.exports = {
  loadMonthView,
  toggleCell,
  MONTH_SHORT,
};
