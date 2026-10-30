/**
 * Below-the-fold Today panels — loaded after first paint so switch→Today TTFB stays light.
 */
const dbService = require('./database');
const { filterLeadsForRequest, userEmail, canAssignWork, roleForEmail } = require('./workspaceService');
const { buildOutreachCoachSnapshot } = require('./outreachCoachSnapshot');
const actionPlanTracker = require('./actionPlanTracker');
const { buildConversionSnapshot } = require('./conversionMetrics');
const { buildWeekReview } = require('./weekReview');
const { filterBusinessPipelineLeads } = require('./leadListFilters');
const { buildOpportunityBoard, selectPipeline } = require('./opportunityBoards');
const { buildCallQueue } = require('./callQueue');
const { buildCadenceQueue } = require('./cadenceQueue');
const { buildNextActionsQueue } = require('./nextActionsQueue');
const { countWarmReplyLeads, DEFAULT_WINDOW_DAYS: ENGAGEMENT_WINDOW_DAYS } = require('./engagementInbox');
const workspaceLeadOverview = require('./workspaceLeadOverview');
const appointmentPackages = require('./appointmentPackages');
const networkStore = require('./networkStore');
const teamFieldWork = require('./teamFieldWork');
const { buildBestRoiActivity } = require('./bestRoiActivity');
const { dedupeOpenLeadTasks } = require('./userTasks');

function countQueueNeedingAction(leads) {
  return (Array.isArray(leads) ? leads : []).filter((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    return n <= 2;
  }).length;
}

function enrichTasksWithLeadsForToday(tasks, leads) {
  const leadMap = Object.fromEntries(
    (Array.isArray(leads) ? leads : []).filter((l) => l && l.key).map((l) => [l.key, l]),
  );
  return (Array.isArray(tasks) ? tasks : []).map((t) => {
    const L = t && t.leadKey && leadMap[t.leadKey];
    const leadTitle = L ? String(L.title || L.company || L.email || 'Lead').slice(0, 120) : null;
    return { ...t, leadTitle };
  });
}

function followUpTasksNeedingAttention(tasksEnriched) {
  const now = new Date();
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return (Array.isArray(tasksEnriched) ? tasksEnriched : [])
    .filter((t) => {
      if (!t.scheduledAt || t.column === 'done') return false;
      const ts = Date.parse(t.scheduledAt);
      if (!Number.isFinite(ts)) return false;
      return ts < endToday;
    })
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, 15);
}

/**
 * Heavy panels skipped on Today SSR — coach, action plan, sources, network, opportunity board, week review.
 * @param {object} req
 * @param {{
 *   leads?: object[],
 *   workspaceLeads?: object[],
 *   businessLeads?: object[],
 *   touchGoal?: number,
 *   history?: object[],
 *   apYear?: number,
 *   apMonth?: number,
 *   pipelineQuery?: string,
 * }} [opts]
 */
async function loadTodayDeferredPanels(req, opts = {}) {
  const email = userEmail(req);
  const wid = req.workspaceId;
  const workspaceDoc = req.workspace || null;
  const apYear = opts.apYear || new Date().getFullYear();
  const apMonth = opts.apMonth || new Date().getMonth() + 1;

  let all = opts.leads;
  if (!Array.isArray(all)) {
    all = await dbService.getAllLeads(wid);
  }
  const workspaceLeads = Array.isArray(opts.workspaceLeads)
    ? opts.workspaceLeads
    : filterLeadsForRequest(req, all);
  const businessLeads = Array.isArray(opts.businessLeads)
    ? opts.businessLeads
    : filterBusinessPipelineLeads(workspaceLeads);

  const touchGoal = opts.touchGoal;
  const history = Array.isArray(opts.history) ? opts.history : [];
  const baseUrl = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');

  let outreachCoach = null;
  let actionPlan = null;
  let rawTasks = [];
  let opportunityTags = [];
  try {
    [outreachCoach, actionPlan, rawTasks, opportunityTags] = await Promise.all([
      buildOutreachCoachSnapshot(req, {
        businessesOnly: true,
        leads: all,
        workspace: workspaceDoc,
        touchGoal,
        history,
      }).catch(() => null),
      actionPlanTracker
        .loadMonthView({
          workspaceId: wid,
          email,
          year: apYear,
          month: apMonth,
          leads: workspaceLeads,
        })
        .catch(() => null),
      dedupeOpenLeadTasks(wid, email)
        .then(() => dbService.listUserTasks(wid, email))
        .catch(() => []),
      dbService.listTags(wid).catch(() => []),
    ]);
  } catch (_) {
    /* keep nulls */
  }
  if (!Array.isArray(rawTasks)) rawTasks = [];

  const tasksEnriched = enrichTasksWithLeadsForToday(rawTasks, workspaceLeads);
  const followUpTasksToday = followUpTasksNeedingAttention(tasksEnriched);

  let opportunityBoard = null;
  try {
    const selectedBoards = selectPipeline(
      workspaceDoc && workspaceDoc.opportunityBoards,
      opts.pipelineQuery,
    );
    if (selectedBoards.changed && workspaceDoc) {
      workspaceDoc.opportunityBoards = selectedBoards.boards;
      await dbService.saveWorkspace(wid, workspaceDoc);
    }
    opportunityBoard = buildOpportunityBoard({
      boards: (workspaceDoc && workspaceDoc.opportunityBoards) || selectedBoards.boards,
      leads: businessLeads,
      tasks: rawTasks,
      pipelineId: opts.pipelineQuery,
      compactLimit: 2,
    });
  } catch (_) {
    opportunityBoard = null;
  }

  const conversionSnapshot = buildConversionSnapshot(workspaceLeads, workspaceDoc);
  const weekReview = buildWeekReview(workspaceLeads, conversionSnapshot);
  const cadenceQueue = buildCadenceQueue(businessLeads, baseUrl);
  const callWarmQueue = buildCallQueue(businessLeads, { limit: 20 });
  const nextActions = buildNextActionsQueue({
    tasks: tasksEnriched,
    leads: businessLeads,
    cadenceQueue,
    reportsOpened24h: [],
    engagementQueue: callWarmQueue,
    baseUrl,
    limit: 30,
  });

  let leadSources = null;
  try {
    const apptView = await appointmentPackages.loadTodayView(wid);
    leadSources = await workspaceLeadOverview.buildOverview({
      workspaceId: wid,
      leads: workspaceLeads,
      apptView,
    });
  } catch (_) {
    leadSources = null;
  }

  let fieldWorkHome = null;
  let networkMemberCount = 0;
  let pendingApplications = 0;
  const role = roleForEmail(req.workspace, email);
  const canSeeFieldWork =
    canAssignWork(role) || req.canAssignWork === true || req.canManageWorkspace === true;
  try {
    const network = await networkStore.getOrCreateNetworkForWorkspace(wid, {
      name: req.workspace && req.workspace.name ? `${req.workspace.name} network` : 'Referral network',
      ownerEmail: email,
    });
    const [members, applications] = await Promise.all([
      networkStore.listMembers(network.id),
      networkStore.listApplications(network.id).catch(() => []),
    ]);
    networkMemberCount = Array.isArray(members) ? members.length : 0;
    pendingApplications = (applications || []).filter((a) => a && a.status === 'pending').length;
    if (canSeeFieldWork) {
      fieldWorkHome = await teamFieldWork.summarizeTeamFieldWork(network.id, members);
    }
  } catch (_) {
    fieldWorkHome = null;
  }

  const repliesWaiting = countWarmReplyLeads(businessLeads, { windowDays: ENGAGEMENT_WINDOW_DAYS });
  const queueNeedingAction = countQueueNeedingAction(businessLeads);
  const bestRoiActivity = buildBestRoiActivity({
    repliesWaiting,
    queueNeedingAction,
    nextActions,
    followUpTasksToday,
    leadSources,
    opportunityBoard,
    fieldWorkHome,
    callWarmQueue,
    networkMemberCount,
    pendingApplications,
  });

  const navYear = new Date().getFullYear();
  const actionPlanMonthNav = actionPlanTracker.MONTH_SHORT.map((short, i) => ({
    short,
    month: i + 1,
    year: navYear,
    active: !!(actionPlan && navYear === actionPlan.year && i + 1 === actionPlan.month),
  }));

  return {
    outreachCoach,
    actionPlan,
    actionPlanMonthNav,
    opportunityBoard,
    opportunityTags,
    conversionSnapshot,
    weekReview,
    leadSources,
    fieldWorkHome,
    bestRoiActivity,
    entrepreneurQuote:
      outreachCoach && outreachCoach.entrepreneurQuote ? outreachCoach.entrepreneurQuote : null,
  };
}

module.exports = {
  loadTodayDeferredPanels,
  countQueueNeedingAction,
  enrichTasksWithLeadsForToday,
  followUpTasksNeedingAttention,
};
