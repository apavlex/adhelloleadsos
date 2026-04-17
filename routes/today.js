/**
 * Today — daily landing (same data as legacy /sales hub; /sales now redirects here).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { PIPELINE_STAGES, PERSONAS } = require('../services/salesConstants');
const { computeOutreachStreak, buildDailyChartSeries } = require('../services/trackerStats');
const { getCoachPayload } = require('../services/flowCoach');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const workspaceLeads = filterLeadsForRequest(req, all);
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = workspaceLeads.filter((l) => {
      const t = new Date(l.createdAt || l.savedAt || 0).getTime();
      return t && now - t < weekMs;
    }).length;
    const pipelineCounts = {};
    for (let i = 1; i <= 10; i += 1) pipelineCounts[i] = 0;
    workspaceLeads.forEach((l) => {
      const ps =
        typeof l.pipelineStage === 'number' && l.pipelineStage >= 1 && l.pipelineStage <= 10
          ? l.pipelineStage
          : 1;
      pipelineCounts[ps] += 1;
    });
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
    const chartSeries = buildDailyChartSeries(today, history, 14);
    const flowCoach = await getCoachPayload(req);

    res.render('sales-hub', {
      title: 'Today | Agency OS',
      activePage: 'today',
      activeSales: 'hub',
      stages: PIPELINE_STAGES,
      personas: PERSONAS,
      flowCoach,
      hubStats: {
        totalWorkspace: workspaceLeads.length,
        newThisWeek,
        pipelineCounts,
        streak,
        touchesToday,
        chartSeries,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
