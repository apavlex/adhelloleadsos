const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { PIPELINE_STAGES, SCRIPT_LIBRARY, PERSONAS } = require('../services/salesConstants');
const { computeOutreachStreak, buildDailyChartSeries, buildDayRollup } = require('../services/trackerStats');
const activationService = require('../services/activationService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');

// Legacy Command Center URL → Today (hub lives at GET /today)
router.get('/', (req, res) => {
  res.redirect(302, '/today');
});

router.get('/workflow', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const leads = filterLeadsForRequest(req, all);
    const counts = {};
    for (let i = 1; i <= 10; i += 1) counts[i] = 0;
    leads.forEach((l) => {
      const ps =
        typeof l.pipelineStage === 'number' && l.pipelineStage >= 1 && l.pipelineStage <= 10
          ? l.pipelineStage
          : 1;
      counts[ps] += 1;
    });
    res.render('sales-workflow', {
      title: '10-Stage Workflow',
      activePage: 'sales',
      activeSales: 'workflow',
      stages: PIPELINE_STAGES,
      leads,
      counts,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/workflow/stage', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const { leadKey, pipelineStage } = req.body;
    if (!leadKey) return res.redirect('/sales/workflow');
    const key = leadKey.startsWith('lead:') ? leadKey : `lead:${leadKey}`;
    const stage = Math.min(10, Math.max(1, parseInt(pipelineStage, 10) || 1));
    await dbService.updateLead(key, {
      pipelineStage: stage,
      pipelineStageUpdatedAt: new Date().toISOString(),
    });
    if (stage >= 2) {
      await activationService.recordEvent(userEmail(req), 'pipeline_advanced');
    }
    res.redirect('/sales/workflow');
  } catch (e) {
    next(e);
  }
});

router.post('/workflow/cqi', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const { leadKey, monthlyRevenue, marketingSpend, cqiNotes } = req.body;
    if (!leadKey) return res.redirect('/sales/workflow');
    const key = leadKey.startsWith('lead:') ? leadKey : `lead:${leadKey}`;
    await dbService.updateLead(key, {
      cqi: {
        monthlyRevenue: (monthlyRevenue || '').trim(),
        marketingSpend: (marketingSpend || '').trim(),
        notes: (cqiNotes || '').trim(),
        recordedAt: new Date().toISOString(),
      },
    });
    res.redirect('/sales/workflow');
  } catch (e) {
    next(e);
  }
});

router.get('/tracker', async (req, res, next) => {
  try {
    const email = userEmail(req);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = await dbService.getDailyTracker(email, today);
    const history = await dbService.listDailyTrackers(email, 14);
    const history60 = await dbService.listDailyTrackers(email, 62);
    const chartSeries = buildDailyChartSeries(today, history, 14);
    const streak = computeOutreachStreak(history60, today);
    const checklistWeek = buildDayRollup(today, history60, 7);
    const checklistMonth = buildDayRollup(today, history60, 30);
    res.render('sales-tracker', {
      title: 'Daily Action Tracker',
      activePage: 'sales',
      activeSales: 'tracker',
      today,
      todayRow: todayRow || {
        coldEmails: 0,
        coldDms: 0,
        coldCalls: 0,
        upworkBids: 0,
        notes: '',
        callNotes: '',
      },
      history,
      chartSeries,
      streak,
      checklistWeek,
      checklistMonth,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tracker', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const dateStr = (req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    await dbService.saveDailyTracker(email, dateStr, {
      coldEmails: parseInt(req.body.coldEmails, 10) || 0,
      coldDms: parseInt(req.body.coldDms, 10) || 0,
      coldCalls: parseInt(req.body.coldCalls, 10) || 0,
      upworkBids: parseInt(req.body.upworkBids, 10) || 0,
      notes: req.body.notes || '',
      callNotes: req.body.callNotes || '',
    });
    const touches =
      (parseInt(req.body.coldEmails, 10) || 0) +
      (parseInt(req.body.coldDms, 10) || 0) +
      (parseInt(req.body.coldCalls, 10) || 0) +
      (parseInt(req.body.upworkBids, 10) || 0);
    if (touches > 0) {
      await activationService.recordEvent(email, 'outreach_logged');
    }
    res.redirect('/sales/tracker');
  } catch (e) {
    next(e);
  }
});

router.get('/personas', (req, res) => {
  res.render('sales-personas', {
    title: 'AI Personas & Scripts',
    activePage: 'sales',
    activeSales: 'personas',
    SCRIPT_LIBRARY,
    PERSONAS,
  });
});

module.exports = router;
