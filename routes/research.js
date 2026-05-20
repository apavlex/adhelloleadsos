/**
 * Prospect Research API
 *
 * POST /api/research — run a complete prospect research
 * GET  /research — research page (HTML)
 */

const express = require('express');
const router = express.Router();
const mapsSearch = require('../services/mapsSearch');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const prospectResearch = require('../services/prospectResearch');

// ── Auth ──────────────────────────────────────────────────────────────────────

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  const expected = process.env.API_INGEST_KEY || 'adhello_secret_123';
  if (!key || key !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

function workspaceId(req) {
  return String(req.headers['x-workspace-id'] || req.query.workspaceId || 'default').trim() || 'default';
}

// ── POST /api/research ────────────────────────────────────────────────────────

/**
 * Run a complete prospect research.
 *
 * Body: { businessName, city, state, category? }
 * Returns: full research brief with signals, outreach, demo URL
 */
router.post('/', apiKeyAuth, express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const businessName = String(req.body.businessName || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const category = String(req.body.category || '').trim() || null;

    if (!businessName || !city || !state) {
      return res.status(400).json({
        success: false,
        error: 'businessName, city, and state are required.',
      });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'Maps search not configured. Set RAPIDAPI_KEY or similar.',
      });
    }

    const brief = await prospectResearch.researchProspect(
      businessName, city, state, category, { integrationEnv }
    );

    res.json({
      success: true,
      research: brief,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
