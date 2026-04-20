const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const allLeads = await dbService.getAllLeads();
    const leads = filterLeadsForRequest(req, allLeads);
    const adhelloLeads = leads.filter((l) => l.source && l.source.startsWith('adhello_'));
    const workspaceLeads = leads;
    const mapCenterRaw = (process.env.GOOGLE_MAPS_DEFAULT_CENTER || '45.5152,-122.6784').trim();
    const mapCenterParts = mapCenterRaw.split(',').map((s) => parseFloat(String(s).trim(), 10));
    const mapDefaultLat = Number.isFinite(mapCenterParts[0]) ? mapCenterParts[0] : 45.5152;
    const mapDefaultLng = Number.isFinite(mapCenterParts[1]) ? mapCenterParts[1] : -122.6784;
    const mapDefaultZoom = Math.max(
      3,
      Math.min(18, parseInt(process.env.GOOGLE_MAPS_DEFAULT_ZOOM || '11', 10) || 11)
    );

    const allSchedules = await dbService.listSchedules();
    const wid = req.workspaceId || 'default';
    const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);

    res.render('index', {
      title: 'Agency OS | Daily Leads',
      activePage: 'search',
      savedLeadsCount: adhelloLeads.length,
      workspaceLeadsCount: workspaceLeads.length,
      warmInboundCount: adhelloLeads.length,
      totalPipelineCount: leads.length,
      googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || null,
      mapDefaultLat,
      mapDefaultLng,
      mapDefaultZoom,
      schedules,
    });
  } catch (e) {
    next(e);
  }
});

// GET /schedules — View scheduled scrape jobs
router.get('/schedules', async (req, res) => {
  const allSchedules = await dbService.listSchedules();
  const wid = req.workspaceId || 'default';
  const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);
    res.render('schedules', {
      title: 'Scheduled Jobs | Agency OS',
    activePage: 'schedules',
    schedules,
    success: req.query.success === 'true'
  });
});

// POST /schedules/delete — Remove a scheduled job
router.post('/schedules/delete', async (req, res) => {
  const { key, returnTo } = req.body;
  if (key) {
    await dbService.deleteSchedule(key);
  }
  const dest = returnTo === '/' ? '/' : '/schedules';
  res.redirect(dest);
});

module.exports = router;
