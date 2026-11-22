/**
 * Public Directory API (no session) — AI Studio / external sites fetch listings
 * and post profile lead forms into the Reviews app.
 *   GET  /api/public/directory/:token/feed.json
 *   GET  /api/public/directory/:token/businesses/:slug.json
 *   POST /api/public/directory/:token/businesses/:slug/leads
 */
const express = require('express');
const directoryPublic = require('../services/directoryPublic');
const directoryLeadIntake = require('../services/directoryLeadIntake');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || (req.connection && req.connection.remoteAddress) || '';
}

function cors(res, { methods = 'GET, OPTIONS' } = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
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

router.options('/api/public/directory/:token/businesses/:slug/leads', (req, res) => {
  cors(res, { methods: 'POST, OPTIONS' });
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
    const detail = await directoryPublic.getPublicBusiness(req.params.token, req.params.slug, {
      origin: getPublicBaseUrl(req),
    });
    return res.json({ success: true, ...detail });
  } catch (err) {
    const code = err && err.code;
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Detail failed' });
  }
});

router.post('/api/public/directory/:token/businesses/:slug/leads', async (req, res) => {
  cors(res, { methods: 'POST, OPTIONS' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await directoryLeadIntake.submitDirectoryLead(
      req.params.token,
      req.params.slug,
      req.body || {},
      { ip: clientIp(req), origin: getPublicBaseUrl(req) },
    );
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    const code = err && err.code;
    const status =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'NOT_FOUND'
          ? 404
          : code === 'RATE_LIMIT'
            ? 429
            : code === 'INVALID'
              ? 400
              : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Submit failed' });
  }
});

module.exports = router;
