/**
 * Today — daily operator landing (Phase 2 dashboard).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { computeOutreachStreak, buildDailyChartSeries } = require('../services/trackerStats');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const activationService = require('../services/activationService');

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

function countOverdueSequences(leads) {
  const now = Date.now();
  return leads.filter((l) => {
    const st = l.sequenceState;
    if (!st || st.status !== 'active' || !st.nextDueAt) return false;
    return Date.parse(st.nextDueAt) < now;
  }).length;
}

/** Leads that likely need outreach / stage movement (early pipeline). */
function countQueueNeedingAction(leads) {
  return leads.filter((l) => {
    const ps = parseInt(l.pipelineStage, 10);
    const n = !Number.isNaN(ps) && ps >= 1 && ps <= 10 ? ps : 1;
    return n <= 2;
  }).length;
}

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const workspaceLeads = filterLeadsForRequest(req, all);
    const email = userEmail(req);
    const today = new Date().toISOString().slice(0, 10);
    const history = await dbService.listDailyTrackers(email, 60);
    const streak = computeOutreachStreak(history, today);
    const todayRow = await dbService.getDailyTracker(email, today);
    const touchesToday =
      (parseInt(todayRow?.coldEmails, 10) || 0) +
      (parseInt(todayRow?.coldDms, 10) || 0) +
      (parseInt(todayRow?.coldCalls, 10) || 0) +
      (parseInt(todayRow?.upworkBids, 10) || 0);

    const touchGoal = Math.max(1, parseInt(process.env.DAILY_TOUCH_GOAL || '50', 10) || 50);
    const repliesWaiting = countReplySignals(workspaceLeads);
    const overdueFollowUps = countOverdueSequences(workspaceLeads);
    const queueNeedingAction = countQueueNeedingAction(workspaceLeads);

    const activation = await activationService.getState(email);
    const seededNotice = req.query.demo === '1' || req.query.seeded === '1';

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
      overdueFollowUps,
      queueNeedingAction,
      totalLeads: workspaceLeads.length,
      activation,
      activationComplete: activation.progress >= (activation.total || 7),
      seededNotice,
    });
  } catch (e) {
    next(e);
  }
});

/** Load sample leads for empty-state onboarding (workspace-scoped). */
router.post('/seed-demo', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const wid = req.workspaceId || 'default';
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
