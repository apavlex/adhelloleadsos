const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

router.get('/', async (req, res) => {
  const leads = await dbService.getAllLeads();
  res.render('index', {
    title: 'Google Maps Lead Agent',
    activePage: 'search',
    savedLeadsCount: leads.length
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
