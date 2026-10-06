/**
 * Notifications: bell inbound feed, browser bell log, and the full history page.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { pendingInboundItems } = require('../services/inboundEvents');
const { buildNotificationHistory } = require('../services/notificationHistory');
const notificationLog = require('../services/notificationLog');

async function workspaceLeads(req) {
  return filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
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
    res.json({ success: true, items: pendingInboundItems(await workspaceLeads(req)) });
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
