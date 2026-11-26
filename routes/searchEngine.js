const express = require('express');
const router = express.Router();
const tregSearchMode = require('../services/tregSearchMode');
const tregClient = require('../services/tregClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');

async function tregReady(req) {
  if (req.workspace && req.workspace.isDemo) return false;
  if (tregClient.isConfigured()) return true;
  if (!req.workspaceId) return false;
  const env = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
  return tregClient.isConfigured({ integrationEnv: env });
}

async function payload(req) {
  const demo = !!(req.workspace && req.workspace.isDemo);
  const mode = demo ? 'default' : tregSearchMode.getMode(req.workspaceId);
  const last = tregClient.lastUsage(req.workspaceId);
  return {
    success: true,
    mode,
    ready: await tregReady(req),
    demo,
    last: last
      ? {
          feature: last.feature || '',
          costMicro: Number(last.costMicro) || 0,
          at: last.at || '',
          status: last.status || 0,
        }
      : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!req.workspaceId) {
      return res.status(403).json({ success: false, error: 'No workspace.' });
    }
    return res.json(await payload(req));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.workspaceId) {
      return res.status(403).json({ success: false, error: 'No workspace.' });
    }
    const mode = String((req.body && req.body.mode) || '').trim().toLowerCase();
    if (mode !== 'default' && mode !== 'treg') {
      return res.status(400).json({ success: false, error: 'Choose Default builds or Treg.' });
    }
    if (req.workspace && req.workspace.isDemo && mode === 'treg') {
      return res.status(403).json({
        success: false,
        error: 'Demo workspaces stay on the built-in search providers.',
      });
    }
    if (mode === 'treg' && !(await tregReady(req))) {
      return res.status(409).json({
        success: false,
        error: 'Add a Treg API key under Workspace → Integrations, then turn it on.',
        settingsUrl: '/workspace/integrations#integration-treg',
      });
    }
    tregSearchMode.setMode(req.workspaceId, mode);
    return res.json(await payload(req));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
