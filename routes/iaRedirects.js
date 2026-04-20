/**
 * Phase 1 IA: canonical paths → existing routes.
 * /find → home; /pipeline → /prospecting?tab=pipeline; /outreach → /prospecting (preserves query).
 */
const express = require('express');

const router = express.Router();

router.get('/find', (req, res) => {
  res.redirect(302, '/');
});

router.get('/pipeline', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const raw = i >= 0 ? req.originalUrl.slice(i + 1) : '';
  const params = new URLSearchParams(raw);
  params.set('tab', 'pipeline');
  res.redirect(302, `/prospecting?${params.toString()}`);
});

router.get('/insights', (req, res) => {
  res.redirect(302, '/analytics');
});

router.get('/reports', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const q = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, `/analytics${q}`);
});

module.exports = router;
