/**
 * Session-authenticated prospecting outreach APIs (enroll, call queue, auto-pool).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const { resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');
const { enrollLeadsBulk, enrollLeadInAutoOutreach, AUTO_OUTREACH_TAG_NAME } = require('../services/prospectingEnroll');
const { buildCallQueue, DEFAULT_WINDOW_DAYS } = require('../services/callQueue');
const {
  runAutoPool,
  loadAutoPoolFromWorkspace,
  normalizeAutoPoolSettings,
} = require('../services/prospectingAutoPool');
const teamActivity = require('../services/teamActivity');

function recordEnrollActivity(req, result, scopeLabel) {
  const enrolled = Number(result && result.enrolled) || 0;
  if (!enrolled) return;
  const keys = (Array.isArray(result.results) ? result.results : [])
    .filter((r) => r && r.enrolled && r.leadKey)
    .map((r) => r.leadKey);
  teamActivity.record(req, {
    category: 'outreach',
    action: 'prospecting_enroll',
    summary: `Enrolled ${enrolled} lead${enrolled === 1 ? '' : 's'} in auto-outreach${scopeLabel ? ` (${scopeLabel})` : ''}${
      result.skipped ? ` · ${result.skipped} skipped` : ''
    }`,
    leadKeys: keys,
    leadCount: enrolled,
  });
}

async function visibleBusinessLeads(req) {
  const all = await dbService.getAllLeads(req.workspaceId);
  const visible = filterLeadsForRequest(req, all);
  return filterBusinessPipelineLeads(visible);
}

/** POST /api/prospecting/enroll */
router.post('/enroll', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const reEnroll = body.reEnroll === true;
    let leadKeys = Array.isArray(body.leadKeys) ? body.leadKeys : [];

    if (!leadKeys.length && (body.folderKey || body.tagKey)) {
      const filter = { ...(body.filter && typeof body.filter === 'object' ? body.filter : {}) };
      if (body.folderKey) filter.folderKey = String(body.folderKey).trim();
      if (body.tagKey) filter.tagKey = String(body.tagKey).trim();
      const result = await enrollLeadsBulk({
        workspaceId: req.workspaceId,
        filter,
        reEnroll,
        tag: body.tag !== false,
      });
      recordEnrollActivity(req, result, body.folderKey ? 'folder' : 'tag');
      return res.json({ success: true, ...result });
    }

    if (leadKeys.length) {
      const visible = await visibleBusinessLeads(req);
      const matched = await resolveLeadsBySelectedKeys({
        dbService,
        workspaceId: req.workspaceId,
        visibleLeads: visible,
        keyOrder: leadKeys,
      });
      leadKeys = matched.map((l) => l.key);
    }

    if (!leadKeys.length && body.filter && typeof body.filter === 'object') {
      const result = await enrollLeadsBulk({
        workspaceId: req.workspaceId,
        filter: body.filter,
        reEnroll,
        tag: body.tag !== false,
      });
      recordEnrollActivity(req, result, 'filtered list');
      return res.json({ success: true, ...result });
    }

    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys or filter is required.' });
    }

    const result = await enrollLeadsBulk({
      workspaceId: req.workspaceId,
      leadKeys,
      reEnroll,
      tag: body.tag !== false,
      findContacts: body.findContacts !== false,
    });
    recordEnrollActivity(req, result, '');
    return res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/** GET /api/prospecting/call-queue */
router.get('/call-queue', async (req, res, next) => {
  try {
    const windowDays = parseInt(req.query.windowDays, 10) || DEFAULT_WINDOW_DAYS;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const leads = await visibleBusinessLeads(req);
    const queue = buildCallQueue(leads, { windowDays, limit });
    return res.json({ success: true, count: queue.length, windowDays, queue });
  } catch (e) {
    next(e);
  }
});

/** POST /api/prospecting/auto-pool/run */
router.post('/auto-pool/run', express.json(), async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can run auto-pool.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const settings = body.settings
      ? normalizeAutoPoolSettings(body.settings)
      : loadAutoPoolFromWorkspace(ws);
    const result = await runAutoPool({
      workspaceId: req.workspaceId,
      settings,
      maxLeads: body.maxLeads,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/** GET /api/prospecting/auto-pool/settings */
router.get('/auto-pool/settings', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    return res.json({
      success: true,
      autoPool: loadAutoPoolFromWorkspace(ws),
      tagName: AUTO_OUTREACH_TAG_NAME,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
