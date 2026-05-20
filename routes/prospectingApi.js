/**
 * Prospecting Enrichment API
 *
 * Combines buying signals, GBP audit, and outreach generation
 * into a single prospecting workflow.
 *
 * Endpoints:
 * POST /api/prospecting/enrich — enrich a lead with buying signals + audit + outreach
 * POST /api/prospecting/batch   — enrich multiple leads and sort by buying score
 * GET  /api/prospecting/demo    — generate a demo URL for a business
 */

const express = require('express');
const router = express.Router();
const mapsSearch = require('../services/mapsSearch');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const buyingSignals = require('../services/buyingSignals');
const demoGenerator = require('../services/demoGenerator');
const outreachGenerator = require('../services/outreachGenerator');
const dbService = require('../services/database');

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

// ── POST /api/prospecting/enrich ──────────────────────────────────────────────

/**
 * Enrich a single lead with buying signals, GBP audit score, and outreach.
 *
 * Body: { businessName, city, state, category?, demoType?, channel? }
 * - businessName: name of the business to look up
 * - city, state: location
 * - category: optional business category (plumber, HVAC, etc.)
 * - demoType: leadQualifier | customerService | appointmentScheduler
 * - channel: email | linkedin | phone | all
 */
router.post('/enrich', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const businessName = String(req.body.businessName || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const category = String(req.body.category || '').trim() || null;
    const demoType = req.body.demoType || 'leadQualifier';
    const channel = req.body.channel || 'all';

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

    // 1. Search for the business
    const searchQuery = category ? `${businessName} ${category}` : businessName;
    const results = await mapsSearch.searchGoogleMaps({
      keyword: searchQuery, city, state, maxResults: 5, integrationEnv,
    });

    const target = results.find(r =>
      r.title.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(r.title.toLowerCase())
    ) || results[0];

    if (!target) {
      return res.status(404).json({
        success: false,
        error: `Could not find "${businessName}" in ${city}, ${state}.`,
      });
    }

    // 2. Get competitors for GBP audit scoring
    const competitorQuery = category || businessName.split(' ')[0];
    const competitorResults = await mapsSearch.searchGoogleMaps({
      keyword: `${competitorQuery} ${city}`, city, state, maxResults: 10, integrationEnv,
    });
    const competitors = competitorResults.filter(c =>
      c.placeId !== target.placeId && c.title.toLowerCase() !== target.title.toLowerCase()
    ).slice(0, 5);

    // 3. Detect buying signals
    const enriched = buyingSignals.enrichLeadWithSignals(target);

    // 4. Generate outreach package
    const demoUrl = demoGenerator.generateDemoUrl(
      process.env.BASE_URL || 'https://adhelloleadsos.onrender.com',
      target, demoType
    );

    const outreach = outreachGenerator.generateOutreachPackage(target, {
      signals: enriched.signals,
      demoUrl,
      channel,
      template: enriched.signals.some(s => s.category === 'buying_signal') ? 'signalBased' : 'problemFirst',
    });

    res.json({
      success: true,
      prospect: {
        business: {
          title: target.title,
          phone: target.phone,
          website: target.website,
          email: target.email,
          address: target.address,
          city: target.city,
          state: target.state,
          categoryName: target.categoryName,
          rating: target.totalScore,
          reviewsCount: target.reviewsCount,
          mapsUrl: target.url,
        },
        buyingScore: enriched.buyingScore,
        priority: enriched.priority,
        signals: enriched.signals,
        outreach,
        demoUrl,
        competitorCount: competitors.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/prospecting/batch ───────────────────────────────────────────────

/**
 * Enrich multiple leads from a search and sort by buying score.
 *
 * Body: { keyword, city, state, maxResults?, minScore? }
 * Returns leads sorted by buying score (highest first).
 */
router.post('/batch', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const keyword = String(req.body.keyword || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const maxResults = Math.min(parseInt(req.body.maxResults, 10) || 20, 50);
    const minScore = parseInt(req.body.minScore, 10) || 0;

    if (!keyword || !city || !state) {
      return res.status(400).json({
        success: false,
        error: 'keyword, city, and state are required.',
      });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'Maps search not configured.',
      });
    }

    // Search for businesses
    const results = await mapsSearch.searchGoogleMaps({
      keyword, city, state, maxResults, integrationEnv,
    });

    // Enrich each with buying signals
    const enriched = results.map(r => buyingSignals.enrichLeadWithSignals(r));

    // Filter by minimum score and sort
    const filtered = enriched
      .filter(l => l.buyingScore >= minScore)
      .sort((a, b) => b.buyingScore - a.buyingScore);

    res.json({
      success: true,
      total: results.length,
      filtered: filtered.length,
      prospects: filtered.map(l => ({
        title: l.title,
        phone: l.phone,
        website: l.website,
        email: l.email,
        city: l.city,
        state: l.state,
        categoryName: l.categoryName,
        rating: l.totalScore,
        reviewsCount: l.reviewsCount,
        buyingScore: l.buyingScore,
        priority: l.priority,
        topSignals: l.signals.slice(0, 3).map(s => s.label),
        mapsUrl: l.url,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/prospecting/demo ─────────────────────────────────────────────────

/**
 * Generate a demo URL for a business.
 *
 * Query: business, category, city, state, type
 */
router.get('/demo', apiKeyAuth, async (req, res, next) => {
  try {
    const business = {
      title: req.query.business || 'Your Business',
      categoryName: req.query.category || 'Home Service',
      city: req.query.city || '',
      state: req.query.state || '',
      phone: req.query.phone || '',
      website: req.query.website || '',
    };

    const demoType = req.query.type || 'leadQualifier';
    const baseUrl = process.env.BASE_URL || 'https://adhelloleadsos.onrender.com';

    const demo = demoGenerator.generateDemo(business, demoType);
    const demoUrl = demoGenerator.generateDemoUrl(baseUrl, business, demoType);

    res.json({
      success: true,
      demo,
      demoUrl,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
