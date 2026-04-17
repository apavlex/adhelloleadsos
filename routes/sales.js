const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { PIPELINE_STAGES, SCRIPT_LIBRARY, PERSONAS } = require('../services/salesConstants');

function userEmail(req) {
  return (req.user && req.user.emails && req.user.emails[0] && req.user.emails[0].value) || 'unknown';
}

router.get('/', (req, res) => {
  res.render('sales-hub', {
    title: 'Command Center | Sales Engine',
    activePage: 'sales',
    activeSales: 'hub',
    stages: PIPELINE_STAGES,
    personas: PERSONAS,
  });
});

router.get('/workflow', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const leads = all.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    const counts = {};
    for (let i = 1; i <= 8; i += 1) counts[i] = 0;
    leads.forEach((l) => {
      const ps = l.pipelineStage;
      if (typeof ps === 'number' && ps >= 1 && ps <= 8) counts[ps] += 1;
    });
    res.render('sales-workflow', {
      title: '8-Step Workflow',
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
    const stage = Math.min(8, Math.max(1, parseInt(pipelineStage, 10) || 1));
    await dbService.updateLead(key, {
      pipelineStage: stage,
      pipelineStageUpdatedAt: new Date().toISOString(),
    });
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
