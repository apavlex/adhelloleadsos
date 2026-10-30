/**
 * Public SEO Q&A API (no session) — sites fetch published Q&As and post new questions.
 *   GET  /api/public/seo-qa/:token/feed.json
 *   POST /api/public/seo-qa/:token/questions
 */
const express = require('express');
const seoQaPublic = require('../services/seoQaPublic');

const router = express.Router();
const jsonParser = express.json({ limit: '32kb' });

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || (req.connection && req.connection.remoteAddress) || '';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=60');
}

router.options('/api/public/seo-qa/:token/feed.json', (req, res) => {
  cors(res);
  return res.sendStatus(204);
});

router.options('/api/public/seo-qa/:token/questions', (req, res) => {
  cors(res);
  return res.sendStatus(204);
});

router.get('/api/public/seo-qa/:token/feed.json', async (req, res) => {
  cors(res);
  try {
    const feed = await seoQaPublic.getPublicFeed(req.params.token);
    return res.json({ success: true, ...feed });
  } catch (err) {
    const code = err && err.code;
    const status = code === 'UNAUTHORIZED' ? 401 : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Feed failed' });
  }
});

router.post('/api/public/seo-qa/:token/questions', jsonParser, async (req, res) => {
  cors(res);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await seoQaPublic.submitPublicQuestion(req.params.token, req.body || {}, {
      ip: clientIp(req),
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    const code = err && err.code;
    const status =
      code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMIT' ? 429 : code === 'INVALID' ? 400 : 400;
    return res.status(status).json({ success: false, error: (err && err.message) || 'Submit failed' });
  }
});

module.exports = router;
