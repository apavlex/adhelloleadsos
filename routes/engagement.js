/**
 * Engagement inbox — rep-facing signal feed (/engagement).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const {
  buildEngagementInbox,
  DEFAULT_WINDOW_DAYS,
  SIGNAL_TYPES,
} = require('../services/engagementInbox');
const { signalLabel } = require('../services/engagementSignals');

async function visibleBusinessLeads(req) {
  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  return filterBusinessPipelineLeads(visible);
}

function ghlWebhookSetupStatus(ws) {
  const plain = workspaceIntegrations.decryptedFromWorkspace(ws);
  const masks = workspaceIntegrations.integrationMasks(ws);
  const hasWorkspaceToken = !!(masks.ghlWebhookSecret || String(plain.ghlWebhookSecret || '').trim());
  const hasServerToken = !!(
    String(process.env.GHL_WEBHOOK_SECRET || '').trim() ||
    String(process.env.API_INGEST_KEY || '').trim()
  );
  const hasLocation = !!(
    String(plain.ghlLocationId || '').trim() ||
    String(process.env.GHL_LOCATION_ID || '').trim()
  );
  const hasApiKey = !!(masks.ghlApiKey || String(plain.ghlApiKey || '').trim() || process.env.GHL_API_KEY);
  const tokenReady = hasWorkspaceToken || hasServerToken;
  return {
    ghlConfigured: !!(hasApiKey && hasLocation),
    webhookTokenReady: tokenReady,
    locationReady: hasLocation,
    setupComplete: !!(hasApiKey && hasLocation && tokenReady),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const windowDays = parseInt(req.query.days, 10) || DEFAULT_WINDOW_DAYS;
    const signalType = String(req.query.type || '').trim();
    const leads = await visibleBusinessLeads(req);
    const inbox = buildEngagementInbox(leads, { windowDays, signalType });
    const filterOptions = SIGNAL_TYPES.map((id) => ({
      id,
      label: signalLabel(id),
      count: inbox.summary.byType[id] || 0,
    }));
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const ghlWebhookSetup = ghlWebhookSetupStatus(ws);
    const publicBase = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');

    res.render('engagement', {
      title: 'Engagement inbox',
      events: inbox.events,
      summary: inbox.summary,
      windowDays: inbox.windowDays,
      activeType: signalType,
      filterOptions,
      ghlWebhookSetup,
      ghlWebhookUrlHint: publicBase
        ? `${publicBase}/api/webhooks/ghl?token=YOUR_TOKEN`
        : '/api/webhooks/ghl?token=YOUR_TOKEN',
    });
  } catch (e) {
    next(e);
  }
});

router.get('/inbox.json', async (req, res, next) => {
  try {
    const windowDays = parseInt(req.query.days, 10) || DEFAULT_WINDOW_DAYS;
    const signalType = String(req.query.type || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const leads = await visibleBusinessLeads(req);
    const inbox = buildEngagementInbox(leads, { windowDays, signalType, limit });
    res.json({ success: true, ...inbox });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
