/**
 * Public Directory API (no session) — AI Studio / external sites fetch listings.
 *   GET /api/public/directory/:token/feed.json
 *   GET /api/public/directory/:token/businesses/:slug.json
 */
const express = require('express');
const directoryPublic = require('../services/directoryPublic');

const router = express.Router();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=60');
}

router.options('/api/public/directory/:token/feed.json', (req, res) => {
  cors(res);
  return res.sendStatus(204);
});

router.options('/api/public/directory/:token/businesses/:slug.json', (req, res) => {
  cors(res);
  return res.sendStatus(204);
});

router.get('/api/public/directory/:token/feed.json', async (req, res) => {
  cors(res);
  try {
    const feed = await directoryPublic.getPublicFeed(req.params.token);
    return res.json({ success: true, ...feed });
  } catch (err) {
    const code = err && err.code;
    const status = code === 'UNAUTHORIZED' ? 401 : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Feed failed' });
  }
});

router.get('/api/public/directory/:token/businesses/:slug.json', async (req, res) => {
  cors(res);
  try {
    const detail = await directoryPublic.getPublicBusiness(req.params.token, req.params.slug);
    return res.json({ success: true, ...detail });
  } catch (err) {
    const code = err && err.code;
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Detail failed' });
  }
});

module.exports = router;
