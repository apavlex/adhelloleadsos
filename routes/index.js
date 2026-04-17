const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { getCoachPayload } = require('../services/flowCoach');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const activationService = require('../services/activationService');

router.get('/', async (req, res, next) => {
  try {
    const allLeads = await dbService.getAllLeads();
    const leads = filterLeadsForRequest(req, allLeads);
    const adhelloLeads = leads.filter((l) => l.source && l.source.startsWith('adhello_'));
    const workspaceLeads = leads;
    const flowCoach = await getCoachPayload(req);
    const activation = await activationService.getState(userEmail(req));
    res.render('index', {
      title: 'Agency OS | Daily Leads',
      activePage: 'search',
      savedLeadsCount: adhelloLeads.length,
      workspaceLeadsCount: workspaceLeads.length,
      warmInboundCount: adhelloLeads.length,
      totalPipelineCount: leads.length,
      flowCoach,
      activation,
    });
  } catch (e) {
    next(e);
  }
});

// GET /schedules — View active autopilot jobs
router.get('/schedules', async (req, res) => {
  const allSchedules = await dbService.listSchedules();
  const wid = req.workspaceId || 'default';
  const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);
  res.render('schedules', {
    title: 'Scheduled Jobs | Autopilot',
    activePage: 'schedules',
    schedules,
    success: req.query.success === 'true'
  });
});

// POST /schedules/delete — Remove an autopilot job
router.post('/schedules/delete', async (req, res) => {
  const { key } = req.body;
  if (key) {
    await dbService.deleteSchedule(key);
  }
  res.redirect('/schedules');
});

module.exports = router;
