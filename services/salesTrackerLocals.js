/**
 * Shared locals for Daily Action Tracker / Review today (Today page + Reports tab).
 */
const dbService = require('./database');
const { filterLeadsForRequest, userEmail } = require('./workspaceService');
const {
  buildDayRollup,
  countUniqueLeadsTouchedOnUtcDate,
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
 */
async function loadSalesTrackerReviewCore(req, dateStr) {
  const email = userEmail(req);
  const wid = req.workspaceId;
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const todayRow = await dbService.getDailyTracker(wid, email, today);
  const allLeads = await dbService.getAllLeads(wid);
  const leadsScoped = filterLeadsForRequest(req, allLeads);
  const trackerInferred = inferDailyTouchCountsFromLeads(leadsScoped, today);
  const trackerDisplayToday = displayTouchTotalsForDay(todayRow || null, leadsScoped, today);
  return {
    today,
    todayRow: todayRow || emptyTodayRow(),
    trackerInferred,
    trackerDisplayToday,
    leadsScoped,
  };
}

async function loadSalesTrackerLocals(req) {
  const email = userEmail(req);
  const wid = req.workspaceId;
  const core = await loadSalesTrackerReviewCore(req);
  const { today, todayRow, trackerInferred, trackerDisplayToday, leadsScoped } = core;
  const history = await dbService.listDailyTrackers(wid, email, 14);
  const history60 = await dbService.listDailyTrackers(wid, email, 62);
  const chartSeries = buildDailyChartDisplaySeries(today, history, 14, leadsScoped);
  const streak = computeOutreachStreakWithLeads(history60, today, leadsScoped);
  const checklistWeek = enrichRollupWithLeadInference(buildDayRollup(today, history60, 7), leadsScoped);
  const checklistMonth = enrichRollupWithLeadInference(buildDayRollup(today, history60, 30), leadsScoped);
  const outreachCoach = await buildOutreachCoachSnapshot(req);
  const touchesToday = countUniqueLeadsTouchedOnUtcDate(leadsScoped, today);
  const touchGoal = await loadDailyTouchGoal(req);
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
    trackerReturnTo: `/reports?tab=tracker&scope=${String(req.query.scope || 'workspace')}`,
  };
}

module.exports = {
  emptyTodayRow,
  loadSalesTrackerReviewCore,
  loadSalesTrackerLocals,
};
