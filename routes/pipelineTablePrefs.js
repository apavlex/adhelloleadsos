const express = require('express');
const { userEmail } = require('../services/workspaceService');
const { loadPipelineTablePrefs, savePipelineTablePrefs } = require('../services/pipelineTablePrefs');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in to load table settings.' });
    res.json({ success: true, prefs: await loadPipelineTablePrefs(email) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) return res.status(401).json({ success: false, error: 'Sign in to save table settings.' });
    const prefs = await savePipelineTablePrefs(email, req.body);
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

/** Exposes saved table setup to pipeline views only (skip Today and other HTML GETs). */
async function attachPipelineTablePrefs(req, res, next) {
  if (req.method !== 'GET') return next();
  if (!needsPipelineTablePrefs(req)) {
    res.locals.pipelineTablePrefs = null;
    return next();
  }
  try {
    const email = userEmail(req);
    res.locals.pipelineTablePrefs = email ? await loadPipelineTablePrefs(email) : null;
  } catch (_) {
    res.locals.pipelineTablePrefs = null;
  }
  next();
}

module.exports = router;
module.exports.attachPipelineTablePrefs = attachPipelineTablePrefs;
