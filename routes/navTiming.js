/**
 * Client menu-hop timing intake. Proves whether opens are fast with real numbers.
 */
const express = require('express');
const router = express.Router();
const navTimingStore = require('../lib/navTimingStore');
const { userEmail } = require('../services/workspaceService');

router.post('/nav-timing.json', express.json({ limit: '8kb' }), (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const entry = navTimingStore.push({
      ...body,
      email: userEmail(req),
      workspaceId: req.workspaceId || '',
      ua: String(req.get('user-agent') || '').slice(0, 160),
    });
    if (entry && entry.clickToPageshowMs != null && entry.clickToPageshowMs >= 1500) {
      console.warn(
        '[nav-timing] slow pageshow',
        entry.path,
        entry.clickToPageshowMs + 'ms',
        entry.email || '',
      );
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e && e.message) || 'timing failed' });
  }
});

router.get('/nav-timing/recent.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.canManageWorkspace) {
    return res.status(403).json({ success: false, error: 'Owners/admins only.' });
  }
  return res.json({ success: true, ...navTimingStore.summary(60) });
});

module.exports = router;
