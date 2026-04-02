const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

router.get('/', async (req, res) => {
  const leads = await dbService.getAllLeads();
  const adhelloLeads = leads.filter(l => l.source && l.source.startsWith('adhello_'));
  res.render('index', {
    title: 'Agency OS | Agent',
    activePage: 'search',
    savedLeadsCount: adhelloLeads.length
  });
});

// GET /schedules — View active autopilot jobs
router.get('/schedules', async (req, res) => {
  const schedules = await dbService.listSchedules();
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
