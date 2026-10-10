/**
 * Agent ops — role bots API (run jobs, settings, dashboard JSON).
 */
const express = require('express');
const router = express.Router();
const { userEmail } = require('../services/workspaceService');
const agentOps = require('../services/agentOps');

router.get('/status', (req, res) => {
  const wid = req.workspaceId;
  if (!wid) return res.status(400).json({ success: false, error: 'No workspace.' });
  const dash = agentOps.dashboardForWorkspace(wid);
  return res.json({ success: true, ...dash });
});

router.get('/roles', (req, res) => {
  return res.json({ success: true, roles: agentOps.listRoles() });
});

router.get('/runs', (req, res) => {
  const wid = req.workspaceId;
  if (!wid) return res.status(400).json({ success: false, error: 'No workspace.' });
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return res.json({ success: true, runs: agentOps.listRecentRuns(wid, limit) });
});

router.post('/settings', express.json(), (req, res) => {
  const wid = req.workspaceId;
  if (!wid) return res.status(400).json({ success: false, error: 'No workspace.' });
  const body = req.body || {};
  const patch = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.roles && typeof body.roles === 'object') {
    patch.roles = {};
    for (const [id, cfg] of Object.entries(body.roles)) {
      if (!cfg || typeof cfg !== 'object') continue;
      patch.roles[id] = {};
      if (typeof cfg.enabled === 'boolean') patch.roles[id].enabled = cfg.enabled;
      if (typeof cfg.autoTick === 'boolean') patch.roles[id].autoTick = cfg.autoTick;
    }
  }
  const settings = agentOps.saveSettings(wid, patch);
  return res.json({ success: true, settings });
});

router.post('/run', express.json(), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    if (!wid) return res.status(400).json({ success: false, error: 'No workspace.' });
    const type = String((req.body && req.body.type) || '').trim();
    if (!type) return res.status(400).json({ success: false, error: 'type is required.' });
    const role = agentOps.roleForJob(type);
    if (!role) return res.status(400).json({ success: false, error: `Unknown job type: ${type}` });
    const email = userEmail(req) || '';
    const out = await agentOps.enqueueAndRun(wid, type, {
      onBehalfOf: email,
      payload: (req.body && req.body.payload) || {},
      triggeredBy: email || 'user',
    });
    if (!out.ok) {
      return res.status(400).json({
        success: false,
        error: out.error || 'Job failed',
        job: out.job || null,
        result: out.result || null,
      });
    }
    return res.json({
      success: true,
      job: out.job,
      result: out.result,
      dashboard: agentOps.dashboardForWorkspace(wid),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tick', express.json(), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    if (!wid) return res.status(400).json({ success: false, error: 'No workspace.' });
    const email = userEmail(req) || '';
    const out = await agentOps.tickWorkspace(wid, {
      force: !!(req.body && req.body.force),
      onBehalfOf: email,
    });
    return res.json({ success: true, ...out, dashboard: agentOps.dashboardForWorkspace(wid) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
