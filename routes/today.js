/**
 * Today — daily operator landing (Phase 2 dashboard).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const {
  countUniqueLeadsTouchedOnUtcDate,
} = require('../services/trackerStats');
const { loadDailyTouchGoal } = require('../services/touchGoalPrefs');
const { computeOutreachStreakWithLeads } = require('../services/trackerAutoFill');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const activationService = require('../services/activationService');
const { buildOutreachCoachSnapshot } = require('../services/outreachCoachSnapshot');
const { buildConversionSnapshot } = require('../services/conversionMetrics');
const { buildWeekReview } = require('../services/weekReview');
const { getWorkspaceIcp } = require('../services/workspaceIcp');
const { buildCadenceQueue } = require('../services/cadenceQueue');
const { buildTodayContactQueue } = require('../services/todayContactQueue');
const { resolveDialRetryPrefs } = require('../services/dialRetryPrefs');
const { buildNextActionsQueue } = require('../services/nextActionsQueue');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const { dedupeOpenLeadTasks } = require('../services/userTasks');
const actionPlanTracker = require('../services/actionPlanTracker');
function firstNameFromUser(user) {
  const raw =
    (user && user.displayName) ||
    (user && user.emails && user.emails[0] && user.emails[0].value) ||
    'there';
  return String(raw).trim().split(/\s+/)[0] || 'there';
}

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function countReplySignals(leads) {
  return leads.filter((l) => {
    const logs = l.logs || [];
    return logs.some((log) => {
      const blob = `${log.type || ''} ${log.message || ''}`.toLowerCase();
      return (
        blob.includes('reply') ||
        blob.includes('inbound') ||
        blob.includes('replied')
      );
    });
  }).length;
}

function countQueueNeedingAction(leads) {
  return leads.filter((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    return n <= 2;
  }).length;
}

function enrichTasksWithLeadsForToday(tasks, leads) {
  const leadMap = Object.fromEntries(leads.map((l) => [l.key, l]));
  return tasks.map((t) => {
    const L = t.leadKey && leadMap[t.leadKey];
    const leadTitle = L ? String(L.title || L.company || L.email || 'Lead').slice(0, 120) : null;
    return { ...t, leadTitle };
  });
}

/** Scheduled follow-ups not marked done: overdue or due before end of today (server local calendar). */
function followUpTasksNeedingAttention(tasksEnriched) {
  const now = new Date();
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return tasksEnriched
    .filter((t) => {
      if (!t.scheduledAt || t.column === 'done') return false;
      const ts = Date.parse(t.scheduledAt);
      if (!Number.isFinite(ts)) return false;
      return ts < endToday;
    })
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, 15);
}

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const workspaceLeads = filterLeadsForRequest(req, all);
    const businessLeads = filterBusinessPipelineLeads(workspaceLeads);
    const email = userEmail(req);
    const today = new Date().toISOString().slice(0, 10);
    const history = await dbService.listDailyTrackers(req.workspaceId, email, 60);
    const streak = computeOutreachStreakWithLeads(history, today, workspaceLeads);
    const touchesToday = countUniqueLeadsTouchedOnUtcDate(workspaceLeads, today);
    const touchGoal = await loadDailyTouchGoal(req);
    const repliesWaiting = countReplySignals(businessLeads);
    const queueNeedingAction = countQueueNeedingAction(businessLeads);

    const activation = await activationService.getState(email);
    const seededNotice = req.query.demo === '1' || req.query.seeded === '1';
    const searchInProgressNotice = req.query.searchInProgress === '1';
    const scheduleSavedNotice = req.query.scheduleSaved === '1';
    const outreachCoach = await buildOutreachCoachSnapshot(req, { businessesOnly: true });

    const workspaceDoc = await dbService.getWorkspace(req.workspaceId);
    const conversionSnapshot = buildConversionSnapshot(workspaceLeads, workspaceDoc);
    const weekReview = buildWeekReview(workspaceLeads, conversionSnapshot);
    const icp = getWorkspaceIcp(workspaceDoc);
    const icpCityState = [icp.city, icp.state].filter(Boolean).join(', ');
    const icpLabelParts = [icp.keyword, icpCityState].filter((s) => s && String(s).trim());
    const icpLabel =
      icpLabelParts.length > 0 ? icpLabelParts.join(' · ') : 'Set your ICP';

    const wsCreatedMs =
      workspaceDoc && workspaceDoc.createdAt ? Date.parse(workspaceDoc.createdAt) : NaN;
    const daysSinceWsCreated =
      Number.isFinite(wsCreatedMs) ? (Date.now() - wsCreatedMs) / 86400000 : null;
    const activationComplete = activation.progress >= (activation.total || 7);
    const activationAutoHide =
      (daysSinceWsCreated != null && daysSinceWsCreated >= 7) ||
      activation.progress >= 5;
    const showActivationRibbon = !activationComplete && !activationAutoHide;

    await dedupeOpenLeadTasks(req.workspaceId, email);
    const rawTasks = await dbService.listUserTasks(req.workspaceId, email);
    const followUpTasksToday = followUpTasksNeedingAttention(
      enrichTasksWithLeadsForToday(rawTasks, workspaceLeads),
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
    const cadenceQueue = buildCadenceQueue(businessLeads, baseUrl);
    const dialRetry = resolveDialRetryPrefs(workspaceDoc && workspaceDoc.telephony);
    const contactQueue = buildTodayContactQueue(businessLeads, baseUrl, 20, {
      queueMode: dialRetry.queueMode,
    });
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const reportViewsRaw = await dbService.listReportViewsForWorkspaceSince(req.workspaceId, since24, 600);
    const byLead = new Map();
    for (const v of reportViewsRaw) {
      const prev = byLead.get(v.lead_id);
      if (!prev || Date.parse(v.viewed_at || '') > Date.parse(prev.viewed_at || '')) {
        byLead.set(v.lead_id, v);
      }
    }
    const dedupedViews = [...byLead.values()].sort(
      (a, b) => Date.parse(b.viewed_at || 0) - Date.parse(a.viewed_at || 0),
    );
    const leadMapForViews = Object.fromEntries(workspaceLeads.map((l) => [l.key, l]));
    const reportsOpened24h = dedupedViews.slice(0, 25).map((v) => {
      const L = leadMapForViews[v.lead_id];
      const short = String(v.lead_id || '').replace(/^lead:/i, '');
      return {
        leadKey: v.lead_id,
        focusLeadParam: short,
        leadTitle: L ? String(L.title || L.company || L.email || 'Lead').slice(0, 120) : short || 'Lead',
        lastViewedAt: v.viewed_at,
        durationSeconds: Number(v.duration_seconds) || 0,
      };
    });

    const tasksEnriched = enrichTasksWithLeadsForToday(rawTasks, workspaceLeads);
    const nextActions = buildNextActionsQueue({
      tasks: tasksEnriched,
      leads: businessLeads,
      cadenceQueue,
      reportsOpened24h,
      baseUrl,
      limit: 30,
    });

    const apYear = parseInt(req.query.actionPlanYear, 10) || new Date().getFullYear();
    const apMonth = parseInt(req.query.actionPlanMonth, 10) || new Date().getMonth() + 1;
    const actionPlan = await actionPlanTracker.loadMonthView({
      workspaceId: req.workspaceId,
      email,
      year: apYear,
      month: apMonth,
      leads: workspaceLeads,
    });
    const navYear = new Date().getFullYear();
    const actionPlanMonthNav = actionPlanTracker.MONTH_SHORT.map((short, i) => ({
      short,
      month: i + 1,
      year: navYear,
      active: navYear === actionPlan.year && i + 1 === actionPlan.month,
    }));

    res.render('today', {
      title: 'Today | Agency OS',
      activePage: 'today',
      greetingWord: greetingWord(),
      firstName: firstNameFromUser(req.user),
      dateLabel: new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      touchesToday,
      touchGoal,
      streak,
      repliesWaiting,
      queueNeedingAction,
      totalLeads: businessLeads.length,
      outreachCoach,
      activation,
      activationComplete,
      activationAutoHide,
      showActivationRibbon,
      conversionSnapshot,
      weekReview,
      icpLabel,
      icpForm: icp,
      seededNotice,
      searchInProgressNotice,
      scheduleSavedNotice,
      followUpTasksToday,
      nextActions,
      cadenceQueue,
      contactQueue,
      reportsOpened24h,
      actionPlan,
      actionPlanMonthNav,
    });
  } catch (e) {
    next(e);
  }
});

/** Toggle a single action-plan cell (monthly checkbox grid). */
router.post('/action-plan/toggle', express.json(), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await actionPlanTracker.toggleCell({
      workspaceId: req.workspaceId,
      email,
      date: body.date,
      activityId: body.activityId,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(400).json({ success: false, error: e && e.message ? e.message : 'toggle_failed' });
  }
});

/** Load the user's action-plan activity catalog (categories + client goal). */
router.get('/action-plan/catalog', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const catalog = await actionPlanTracker.loadCatalog(req.workspaceId, email);
    return res.json({ success: true, catalog });
  } catch (e) {
    return res.status(500).json({ success: false, error: e && e.message ? e.message : 'catalog_load_failed' });
  }
});

/** Save or reset the action-plan activity catalog. */
router.put('/action-plan/catalog', express.json(), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const catalog = await actionPlanTracker.saveCatalog(req.workspaceId, email, body);
    return res.json({ success: true, catalog });
  } catch (e) {
    return res.status(400).json({ success: false, error: e && e.message ? e.message : 'catalog_save_failed' });
  }
});

/** Load sample leads for empty-state onboarding (workspace-scoped). */
router.post('/seed-demo', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const ts = Date.now();
    const rows = [
      {
        title: 'Sample Dental Studio',
        city: 'Denver',
        state: 'CO',
        email: `demo-dental-${ts}@sample.invalid`,
        phone: '303-555-0100',
        website: 'https://example.com',
        categoryName: 'Dental',
        pipelineStage: 1,
        totalScore: 4.2,
        reviewsCount: 120,
        source: 'demo_seed',
        status: 'Not Contacted',
      },
      {
        title: 'Sample HVAC Pros',
        city: 'Austin',
        state: 'TX',
        email: `demo-hvac-${ts}@sample.invalid`,
        phone: '512-555-0101',
        website: 'https://example.org',
        categoryName: 'HVAC',
        pipelineStage: 2,
        totalScore: 4.5,
        reviewsCount: 89,
        source: 'demo_seed',
        status: 'Lead Captured',
      },
      {
        title: 'Sample Bistro East',
        city: 'Miami',
        state: 'FL',
        email: `demo-bistro-${ts}@sample.invalid`,
        phone: '305-555-0102',
        website: 'N/A',
        categoryName: 'Restaurant',
        pipelineStage: 1,
        totalScore: 4.0,
        reviewsCount: 210,
        source: 'demo_seed',
        status: 'Not Contacted',
      },
      {
        title: 'Sample Gym Collective',
        city: 'Phoenix',
        state: 'AZ',
        email: `demo-gym-${ts}@sample.invalid`,
        phone: '602-555-0103',
        website: 'https://example.net',
        categoryName: 'Fitness',
        pipelineStage: 3,
        totalScore: 4.7,
        reviewsCount: 340,
        source: 'demo_seed',
        status: 'Discovery Done',
      },
      {
        title: 'Sample Law Group',
        city: 'Seattle',
        state: 'WA',
        email: `demo-law-${ts}@sample.invalid`,
        phone: '206-555-0104',
        website: 'https://example.com/law',
        categoryName: 'Legal',
        pipelineStage: 2,
        totalScore: 4.8,
        reviewsCount: 56,
        source: 'demo_seed',
        status: 'Lead Captured',
      },
    ];

    for (const row of rows) {
      await dbService.saveLead({ ...row, workspaceId: wid });
    }

    res.redirect('/today?demo=1');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
