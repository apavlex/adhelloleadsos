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
const notificationReview = require('../services/notificationReview');
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

async function historyForRequest(req, { kind, limit } = {}) {
  const wid = req.workspaceId;
  const email = userEmail(req);
  const [leads, allSearches] = await Promise.all([workspaceLeads(req), dbService.getAllSearches()]);
  const history = buildNotificationHistory({
    leads,
    searches: allSearches.filter((s) => (s.workspaceId || 'default') === wid),
    logged: notificationLog.list(wid),
    userEmail: email,
    kind: kind != null ? String(kind) : String(req.query.kind || ''),
    limit: limit || undefined,
  });
  const reviewedAt = notificationReview.getReviewedAt(email);
  const reviewedMs = notificationReview.getReviewedMs(email);
  const unreadItems = history.items.filter((n) => {
    const at = Date.parse(String(n.at || ''));
    return Number.isFinite(at) && at > reviewedMs;
  });
  return { ...history, reviewedAt, unreadCount: unreadItems.length, unreadItems };
}

router.get('/', async (req, res, next) => {
  try {
    const history = await historyForRequest(req);
    res.render('notifications', {
      title: 'Notifications',
      activePage: 'notifications',
      ...history,
    });
  } catch (e) {
    next(e);
  }
});

/** Recent items for the navbar bell (since last Mark reviewed). */
router.get('/recent.json', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const history = await historyForRequest(req, { kind: 'all', limit: 40 });
    const items = (history.unreadCount ? history.unreadItems : history.items).slice(0, 12);
    res.json({
      success: true,
      items,
      unreadCount: history.unreadCount,
      reviewedAt: history.reviewedAt,
      caughtUp: history.unreadCount === 0,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Mark notifications reviewed for this user (all workspaces they use this device in).
 * Advances the watermark, marks the latest search bell read, and lets the client clear OS tray alerts.
 */
router.post('/reviewed', express.json({ limit: '4kb' }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in required.' });
    const requestedAt = parseInt(req.body && req.body.at, 10);
    const { reviewedAt } = notificationReview.markReviewed(email, requestedAt);
    try {
      await dbService.markNotificationRead(req.workspaceId || undefined);
    } catch (_) {
      /* ignore — search bell may already be clear */
    }
    res.json({ success: true, reviewedAt });
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
