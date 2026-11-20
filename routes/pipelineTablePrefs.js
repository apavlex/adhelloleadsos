const express = require('express');
const { userEmail } = require('../services/workspaceService');
const {
  loadPipelineTablePrefs,
  savePipelineTablePrefs,
  buildEffectivePipelineTablePrefs,
} = require('../services/pipelineTablePrefs');
const { resolveWorkspacePipelineColumnDefaults } = require('../services/pipelineColumnPresets');

const router = express.Router();

function activeWorkspaceId(req) {
  return String(
    (req.workspace && req.workspace.id) ||
      req.workspaceId ||
      (req.session && (req.session.activeWorkspaceId || req.session.workspaceId)) ||
      '',
  ).trim();
}

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in to load table settings.' });
    const wid = activeWorkspaceId(req);
    const saved = await loadPipelineTablePrefs(email, wid);
    const prefs = buildEffectivePipelineTablePrefs(req.workspace || null, saved);
    res.json({
      success: true,
      prefs,
      workspaceDefaults: resolveWorkspacePipelineColumnDefaults(req.workspace || null),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in to save table settings.' });
    const wid = activeWorkspaceId(req) || String((req.body && req.body.workspaceId) || '').trim();
    const prefs = await savePipelineTablePrefs(email, req.body, wid);
    if (!prefs) return res.status(400).json({ success: false, error: 'Invalid table settings.' });
    res.json({ success: true, prefs });
  } catch (e) {
    next(e);
  }
});

function needsPipelineTablePrefs(req) {
  const path = String(req.path || '');
  const original = String(req.originalUrl || '').split('?')[0];
  const navHint = String((req.res && req.res.locals && req.res.locals.navPrimary) || '');
  return (
    navHint === 'prospecting' ||
    navHint === 'find' ||
    path.startsWith('/pipeline') ||
    path.startsWith('/leads') ||
    path.startsWith('/prospecting') ||
    original.startsWith('/pipeline') ||
    original.startsWith('/leads') ||
    original.startsWith('/prospecting')
  );
}

/** Exposes effective table setup (workspace defaults + per-workspace overrides) to pipeline views. */
async function attachPipelineTablePrefs(req, res, next) {
  if (req.method !== 'GET') return next();
  if (!needsPipelineTablePrefs(req)) {
    res.locals.pipelineTablePrefs = null;
    res.locals.workspacePipelineColumnDefaults = null;
    return next();
  }
  try {
    const email = userEmail(req);
    const wid = activeWorkspaceId(req);
    const saved = email ? await loadPipelineTablePrefs(email, wid) : null;
    const ws = req.workspace || res.locals.workspace || null;
    res.locals.workspacePipelineColumnDefaults = resolveWorkspacePipelineColumnDefaults(ws);
    res.locals.pipelineTablePrefs = buildEffectivePipelineTablePrefs(ws, saved);
  } catch (_) {
    res.locals.pipelineTablePrefs = null;
    res.locals.workspacePipelineColumnDefaults = null;
  }
  next();
}

module.exports = router;
module.exports.attachPipelineTablePrefs = attachPipelineTablePrefs;
