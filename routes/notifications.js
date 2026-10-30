/**
 * Notifications: bell inbound feed, browser bell log, and the full history page.
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { pendingInboundItems, listGhlCallSmsItems, GHL_ACTIVITY_TYPES } = require('../services/inboundEvents');
const { buildNotificationHistory } = require('../services/notificationHistory');
const notificationLog = require('../services/notificationLog');
const notificationReview = require('../services/notificationReview');
const ghlNotificationPrefs = require('../services/ghlNotificationPrefs');
const { catchUpReviewed } = require('../services/taskPushReminders');
const workspaceIntegrations = require('../services/workspaceIntegrations');

/** Bell / inbound / GHL activity only need leads that already carry inboundEvents. */
async function workspaceInboundLeads(req) {
  return filterLeadsForRequest(req, await dbService.listLeadsWithInboundEvents(req.workspaceId));
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
  // Inbound history only reads inboundEvents — do not load every prospect on each bell poll.
  const [leads, allSearches] = await Promise.all([
    workspaceInboundLeads(req),
    dbService.getAllSearches(),
  ]);
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
    const reviewedMs = Date.parse(reviewedAt) || Date.now();
    try {
      await dbService.markNotificationRead(req.workspaceId || undefined);
    } catch (_) {
      /* ignore — search bell may already be clear */
    }
    try {
      await catchUpReviewed(email, reviewedMs, {
        workspaceIds: req.workspaceId ? [req.workspaceId] : [],
      });
    } catch (_) {
      /* ignore — client still stamps local task reminders */
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
    const email = userEmail(req);
    const ghlPaused = ghlNotificationPrefs.isPaused(email);
    let items = pendingInboundItems(await workspaceInboundLeads(req), ghl);
    if (ghlPaused) {
      items = items.filter((it) => !it || !GHL_ACTIVITY_TYPES.has(it.type));
    }
    res.json({
      success: true,
      items,
      ghlActivityUrl: '/notifications/ghl',
      ghlNotificationsPaused: ghlPaused,
      ghlNotificationsEnabled: !ghlPaused,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Pause or resume GHL call & text notifications for this signed-in user
 * (phone push + inbound bell rows). Form/ad lead alerts stay on.
 */
router.post('/ghl-alerts', express.json({ limit: '4kb' }), (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in required.' });
    const body = req.body || {};
    let paused;
    if (Object.prototype.hasOwnProperty.call(body, 'paused')) paused = !!body.paused;
    else if (Object.prototype.hasOwnProperty.call(body, 'enabled')) paused = !body.enabled;
    else return res.status(400).json({ success: false, error: 'paused or enabled is required.' });
    const result = ghlNotificationPrefs.setPaused(email, paused);
    res.json({
      success: true,
      ghlNotificationsPaused: result.paused,
      ghlNotificationsEnabled: result.enabled,
    });
  } catch (e) {
    next(e);
  }
});

/** Full GHL missed calls + SMS (includes handled); Call opens Lead Connector. */
router.get('/ghl', async (req, res, next) => {
  try {
    const ghl = await ghlLinkContext(req.workspaceId);
    const items = listGhlCallSmsItems(await workspaceInboundLeads(req), ghl);
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
      items: listGhlCallSmsItems(await workspaceInboundLeads(req), ghl),
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
