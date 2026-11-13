/**
 * Shared locals for Daily Action Tracker / Review today (Today page + Reports tab).
 */
const dbService = require('./database');
const { filterLeadsForRequest, userEmail } = require('./workspaceService');
const {
  buildDayRollup,
  countUniqueLeadsTouchedToday,
} = require('./trackerStats');
const { loadDailyTouchGoal } = require('./touchGoalPrefs');
const {
  inferDailyTouchCountsFromLeads,
  displayTouchTotalsForDay,
  buildDailyChartDisplaySeries,
  enrichRollupWithLeadInference,
  computeOutreachStreakWithLeads,
} = require('./trackerAutoFill');
const { buildOutreachCoachSnapshot } = require('./outreachCoachSnapshot');
const { buildConversionSnapshot } = require('./conversionMetrics');
const { filterBusinessPipelineLeads } = require('./leadListFilters');

function countOverdueSequences(leads) {
  const now = Date.now();
  return leads.filter((l) => {
    const st = l.sequenceState;
    if (!st || st.status !== 'active' || !st.nextDueAt) return false;
    return Date.parse(st.nextDueAt) < now;
  }).length;
}

function emptyTodayRow() {
  return {
    coldEmails: 0,
    coldDms: 0,
    coldCalls: 0,
    upworkBids: 0,
    socialPosts: 0,
    adCreatives: 0,
    notes: '',
    callNotes: '',
  };
}

/**
 * Core review-today fields (form + today's picture) — single source for sync.
 * @param {{ allowColdScan?: boolean }} [opts]
 *   allowColdScan false (Reports HTML): use warm cache only; never start a cold
 *   getAllLeads that freezes Reviews / Q&A behind SQLite busy_timeout.
 */
async function loadSalesTrackerReviewCore(req, dateStr, opts = {}) {
  const email = userEmail(req);
  const wid = req.workspaceId;
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const todayRow = await dbService.getDailyTracker(wid, email, today);
  const allowColdScan = opts.allowColdScan !== false;
  let allLeads = [];
  const warm =
    typeof dbService.peekCachedLeads === 'function' ? dbService.peekCachedLeads(wid) : null;
  if (Array.isArray(warm) && warm.length > 0) {
    allLeads = warm;
  } else if (allowColdScan) {
    allLeads = await dbService.getAllLeads(wid);
  } else {
    // Never kick a cold scan from Reports HTML — even fire-and-forget blocked the
    // event loop (sync SQLite) and frosted Reviews / Q&A until pageshow.
    allLeads = [];
  }
  const leadsScoped = filterLeadsForRequest(req, allLeads);
  const trackerInferred = inferDailyTouchCountsFromLeads(leadsScoped, today);
  const trackerDisplayToday = displayTouchTotalsForDay(todayRow || null, leadsScoped, today);
  return {
    today,
    todayRow: todayRow || emptyTodayRow(),
    trackerInferred,
    trackerDisplayToday,
    leadsScoped,
    leadsWarm: Array.isArray(warm) && warm.length > 0,
  };
}

async function loadSalesTrackerLocals(req, opts = {}) {
  const email = userEmail(req);
  const wid = req.workspaceId;
  const core = await loadSalesTrackerReviewCore(req, null, opts);
  const { today, todayRow, trackerInferred, trackerDisplayToday, leadsScoped } = core;
  const history = await dbService.listDailyTrackers(wid, email, 14);
  const history60 = await dbService.listDailyTrackers(wid, email, 62);
  const chartSeries = buildDailyChartDisplaySeries(today, history, 14, leadsScoped);
  const streak = computeOutreachStreakWithLeads(history60, today, leadsScoped);
  const checklistWeek = enrichRollupWithLeadInference(buildDayRollup(today, history60, 7), leadsScoped);
  const checklistMonth = enrichRollupWithLeadInference(buildDayRollup(today, history60, 30), leadsScoped);
  // Skip coach when there is no warm lead list — listSchedules + stage seed still hit SQLite.
  const outreachCoach = core.leadsWarm
    ? await buildOutreachCoachSnapshot(req, {
        leads: leadsScoped,
        history: history60,
        workspace: req.workspace || null,
      })
    : null;
  const workspaceDoc = req.workspace || (await dbService.getWorkspace(wid));
  const touchesToday = countUniqueLeadsTouchedToday(leadsScoped, workspaceDoc);
  const touchGoal = await loadDailyTouchGoal(req);
  const conversionSnapshot = buildConversionSnapshot(leadsScoped, workspaceDoc);
  const businessLeads = filterBusinessPipelineLeads(leadsScoped);
  const overdueFollowUps = countOverdueSequences(businessLeads);
  return {
    today,
    todayRow,
    chartSeries,
    streak,
    checklistWeek,
    checklistMonth,
    outreachCoach,
    trackerInferred,
    trackerDisplayToday,
    touchesToday,
    touchGoal,
    conversionSnapshot,
    overdueFollowUps,
    trackerLeadsPending: !core.leadsWarm && opts.allowColdScan === false,
    trackerReturnTo: `/reports?tab=tracker&scope=${String(req.query.scope || 'workspace')}`,
  };
}

module.exports = {
  emptyTodayRow,
  loadSalesTrackerReviewCore,
  loadSalesTrackerLocals,
};
