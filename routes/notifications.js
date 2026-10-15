/**
 * Notifications: bell inbound feed, browser bell log, and the full history page.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { pendingInboundItems, listGhlCallSmsItems } = require('../services/inboundEvents');
const { buildNotificationHistory } = require('../services/notificationHistory');
const notificationLog = require('../services/notificationLog');
const workspaceIntegrations = require('../services/workspaceIntegrations');

async function workspaceLeads(req) {
  return filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
}

async function ghlLinkContext(workspaceId) {
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);
  return {
    locationId: String((env && env.GHL_LOCATION_ID) || '').trim(),
    dashboardUrl: String((env && env.GHL_DASHBOARD_URL) || process.env.GHL_DASHBOARD_URL || '').trim(),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const [leads, allSearches] = await Promise.all([workspaceLeads(req), dbService.getAllSearches()]);
    const history = buildNotificationHistory({
      leads,
      searches: allSearches.filter((s) => (s.workspaceId || 'default') === wid),
      logged: notificationLog.list(wid),
      userEmail: userEmail(req),
      kind: String(req.query.kind || ''),
    });
    res.render('notifications', {
      title: 'Notifications',
      activePage: 'notifications',
      ...history,
    });
  } catch (e) {
    next(e);
  }
});

/** Open inbound items for the bell (same rows the Today feed used). */
router.get('/inbound', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const ghl = await ghlLinkContext(req.workspaceId);
    res.json({
      success: true,
      items: pendingInboundItems(await workspaceLeads(req), ghl),
      ghlActivityUrl: '/notifications/ghl',
    });
  } catch (e) {
    next(e);
  }
});

/** Full GHL missed calls + SMS (includes handled); Call opens Lead Connector. */
router.get('/ghl', async (req, res, next) => {
  try {
    const ghl = await ghlLinkContext(req.workspaceId);
    const items = listGhlCallSmsItems(await workspaceLeads(req), ghl);
    const openCount = items.filter((i) => !i.handled).length;
    res.render('ghl_activity', {
      title: 'GHL calls & texts',
      activePage: 'notifications',
      items,
      openCount,
      totalCount: items.length,
      ghlLinked: !!ghl.locationId,
    });
  } catch (e) {
    next(e);
  }
});

/** JSON for the GHL activity list (same data as /notifications/ghl). */
router.get('/ghl.json', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const ghl = await ghlLinkContext(req.workspaceId);
    res.json({
      success: true,
      items: listGhlCallSmsItems(await workspaceLeads(req), ghl),
      locationId: ghl.locationId || '',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/log', express.json({ limit: '8kb' }), (req, res) => {
  const entry = notificationLog.add(req.workspaceId, req.body || {}, userEmail(req));
  if (!entry) return res.status(400).json({ success: false, error: 'headline is required.' });
  return res.json({ success: true, id: entry.id });
});

module.exports = router;
