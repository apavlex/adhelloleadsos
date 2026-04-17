/**
 * Phase 1 IA: canonical paths → existing routes (no page deletes).
 * /find, /pipeline, /outreach, /insights are aliases until tabbed pages ship.
 */
const express = require('express');

const router = express.Router();

router.get('/find', (req, res) => {
  res.redirect(302, '/');
});

router.get('/pipeline', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const q = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, `/leads${q}`);
});

router.get('/outreach', (req, res) => {
  res.redirect(302, '/sales/tracker#tracker');
});

router.get('/insights', (req, res) => {
  res.redirect(302, '/analytics');
});

module.exports = router;
