const express = require('express');
const router = express.Router();
const tregSearchMode = require('../services/tregSearchMode');
const tregClient = require('../services/tregClient');

function payload(req) {
  const demo = !!(req.workspace && req.workspace.isDemo);
  const mode = demo ? 'default' : tregSearchMode.getMode(req.workspaceId);
  const last = tregClient.lastUsage(req.workspaceId);
  return {
    success: true,
    mode,
    ready: tregClient.isConfigured(),
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

router.get('/', (req, res) => {
  if (!req.workspaceId) {
    return res.status(403).json({ success: false, error: 'No workspace.' });
  }
  return res.json(payload(req));
});

router.post('/', (req, res) => {
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
  if (mode === 'treg' && !tregClient.isConfigured()) {
    return res.status(409).json({
      success: false,
      error: 'Treg is not set up on this server yet. Add TREG_TOKEN, then turn it on.',
    });
  }
  tregSearchMode.setMode(req.workspaceId, mode);
  return res.json(payload(req));
});

module.exports = router;
