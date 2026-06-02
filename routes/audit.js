/**
 * GBP (Google Business Profile) Audit Generator
 *
 * Generates a scored audit for any home service business by:
 * 1. Searching Google Maps for the target business
 * 2. Pulling competitor data in the same area/category
 * 3. Scoring GBP completeness across 10 dimensions
 * 4. Generating actionable recommendations
 *
 * API key auth: x-api-key header or ?api_key= query param
 */

const express = require('express');
const router = express.Router();
const mapsSearch = require('../services/mapsSearch');
const workspaceIntegrations = require('../services/workspaceIntegrations');

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

// ── GBP Scoring Engine ────────────────────────────────────────────────────────

/**
 * Score a single business's GBP profile based on available data.
 * Returns a score 0-100 and detailed breakdown.
 */
function scoreGBP(business, competitors) {
  const scores = {};
  const recommendations = [];

  // 1. Review Count Score (0-20)
  const reviewCount = business.reviewsCount || 0;
  const avgCompetitorReviews = competitors.length > 0
    ? competitors.reduce((sum, c) => sum + (c.reviewsCount || 0), 0) / competitors.length
    : 0;
  const maxCompetitorReviews = competitors.length > 0
    ? Math.max(...competitors.map(c => c.reviewsCount || 0))
    : 0;

  if (reviewCount >= maxCompetitorReviews) {
    scores.reviews = 20;
  } else if (reviewCount >= avgCompetitorReviews) {
    scores.reviews = Math.round(10 + (reviewCount / maxCompetitorReviews) * 10);
  } else if (reviewCount > 0) {
    scores.reviews = Math.round((reviewCount / avgCompetitorReviews) * 10);
  } else {
    scores.reviews = 0;
  }

  if (reviewCount < avgCompetitorReviews) {
    recommendations.push({
      priority: 'HIGH',
      category: 'Reviews',
      issue: `You have ${reviewCount} reviews vs competitor average of ${Math.round(avgCompetitorReviews)}`,
      action: 'Set up automated review requests after every job. Aim for 5+ new reviews per month.',
      impact: 'More reviews = higher Google ranking and more trust from potential customers.',
    });
  }

  // 2. Rating Score (0-15)
  const rating = business.totalScore || 0;
  if (rating >= 4.5) {
    scores.rating = 15;
  } else if (rating >= 4.0) {
    scores.rating = 10;
  } else if (rating >= 3.5) {
    scores.rating = 5;
  } else if (rating > 0) {
    scores.rating = 2;
  } else {
    scores.rating = 0;
    recommendations.push({
      priority: 'HIGH',
      category: 'Rating',
      issue: 'No Google rating found',
      action: 'Ask your happiest customers to leave Google reviews immediately.',
      impact: 'Businesses with 4.5+ stars get 2x more clicks than those with 3 stars.',
    });
  }

  // 3. Website Score (0-10)
  if (business.website && business.website !== 'N/A') {
    scores.website = 10;
  } else {
    scores.website = 0;
    recommendations.push({
      priority: 'HIGH',
      category: 'Website',
      issue: 'No website listed on Google Business Profile',
      action: 'Add your website URL to your GBP. If you don\'t have one, get a simple landing page.',
      impact: 'Businesses with websites get 3x more customer actions from Google.',
    });
  }

  // 4. Phone Score (0-5)
  if (business.phone && business.phone !== 'N/A') {
    scores.phone = 5;
  } else {
    scores.phone = 0;
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Phone',
      issue: 'No phone number listed',
      action: 'Add a direct phone number to your GBP. Make it easy for customers to call.',
      impact: 'Click-to-call is the #1 action customers take from Google Maps.',
    });
  }

  // 5. Address Completeness (0-5)
  if (business.address && business.address !== 'N/A' && business.city && business.state) {
    scores.address = 5;
  } else {
    scores.address = 0;
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Address',
      issue: 'Incomplete address on GBP',
      action: 'Ensure your full address including city, state, and zip is correct.',
      impact: 'Complete addresses rank higher in local search results.',
    });
  }

  // 6. Category Score (0-10)
  if (business.categoryName && business.categoryName !== 'N/A') {
    scores.category = 10;
  } else {
    scores.category = 0;
    recommendations.push({
      priority: 'HIGH',
      category: 'Categories',
      issue: 'No primary category set',
      action: 'Set the most specific primary category (e.g., "Plumbing Service" not just "Service").',
      impact: 'The right category is the #1 factor in Google Maps ranking.',
    });
  }

  // 7. Social Media Presence (0-10)
  let socialCount = 0;
  if (business.facebook && business.facebook !== 'N/A') socialCount++;
  if (business.instagram && business.instagram !== 'N/A') socialCount++;
  if (business.twitter && business.twitter !== 'N/A') socialCount++;

  const avgCompetitorSocial = competitors.length > 0
    ? competitors.reduce((sum, c) => {
        let s = 0;
        if (c.facebook && c.facebook !== 'N/A') s++;
        if (c.instagram && c.instagram !== 'N/A') s++;
        if (c.twitter && c.twitter !== 'N/A') s++;
        return sum + s;
      }, 0) / competitors.length
    : 0;

  scores.social = Math.min(10, socialCount * 3);

  if (socialCount < avgCompetitorSocial) {
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Social Media',
      issue: `You have ${socialCount} social links vs competitor average of ${avgCompetitorSocial.toFixed(1)}`,
      action: 'Add Facebook, Instagram, and Twitter links to your GBP.',
      impact: 'Social signals improve local SEO and give customers more ways to engage.',
    });
  }

  // 8. Google Maps URL / Place ID (0-5)
  if (business.url && business.url !== 'N/A') {
    scores.mapsPresence = 5;
  } else {
    scores.mapsPresence = 2;
    recommendations.push({
      priority: 'LOW',
      category: 'Maps Presence',
      issue: 'Google Maps listing may not be fully optimized',
      action: 'Claim and verify your Google Business Profile if you haven\'t already.',
      impact: 'Verified listings appear more prominently in search results.',
    });
  }

  // 9. Email (0-5)
  if (business.email && business.email !== 'N/A') {
    scores.email = 5;
  } else {
    scores.email = 0;
    recommendations.push({
      priority: 'LOW',
      category: 'Email',
      issue: 'No email address listed',
      action: 'Add a business email to your GBP for customer inquiries.',
      impact: 'Some customers prefer email over phone calls.',
    });
  }

  // 10. Competitor Position Score (0-10)
  if (competitors.length > 0) {
    const allRatings = [business, ...competitors].filter(b => b.totalScore > 0).sort((a, b) => b.totalScore - a.totalScore);
    const position = allRatings.findIndex(b => b.placeId === business.placeId || b.title === business.title) + 1;
    const totalRanked = allRatings.length;

    if (position === 1) {
      scores.position = 10;
    } else if (position <= Math.ceil(totalRanked / 3)) {
      scores.position = 7;
    } else if (position <= Math.ceil(totalRanked * 2 / 3)) {
      scores.position = 4;
    } else {
      scores.position = 1;
      recommendations.push({
        priority: 'HIGH',
        category: 'Competitive Position',
        issue: `You rank #${position} out of ${totalRanked} competitors in your area`,
        action: 'Focus on getting more reviews and completing your GBP profile to climb the rankings.',
        impact: 'Top 3 Google Maps results get 70% of all clicks.',
      });
    }
  } else {
    scores.position = 5;
  }

  // Calculate total score
  const totalScore = Object.values(scores).reduce((sum, v) => sum + v, 0);

  // Sort recommendations by priority
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    totalScore,
    maxScore: 100,
    grade: totalScore >= 90 ? 'A' : totalScore >= 75 ? 'B' : totalScore >= 60 ? 'C' : totalScore >= 40 ? 'D' : 'F',
    scores,
    recommendations,
    competitorCount: competitors.length,
    avgCompetitorReviews: Math.round(avgCompetitorReviews),
    maxCompetitorReviews,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/audit/gbp
 * Body: { businessName, city, state, category? }
 * Returns a full GBP audit with scoring and recommendations.
 */
router.post('/gbp', apiKeyAuth, express.json(), async (req, res, next) => {
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

    // 1. Search for the target business
    const searchQuery = category
      ? `${businessName} ${category}`
      : businessName;

    const targetResults = await mapsSearch.searchGoogleMaps({
      keyword: searchQuery,
      city,
      state,
      maxResults: 5,
      integrationEnv,
    });

    // Find the best match for the target business
    const target = targetResults.find(r => {
      const nameMatch = r.title.toLowerCase().includes(businessName.toLowerCase()) ||
        businessName.toLowerCase().includes(r.title.toLowerCase());
      const cityMatch = r.city && r.city.toLowerCase().includes(city.toLowerCase());
      return nameMatch || cityMatch;
    }) || targetResults[0];

    if (!target) {
      return res.status(404).json({
        success: false,
        error: `Could not find "${businessName}" in ${city}, ${state}. Try a more specific name.`,
      });
    }

    // 2. Search for competitors in the same area
    const competitorQuery = category || businessName.split(' ')[0]; // Use category or first word
    const competitorResults = await mapsSearch.searchGoogleMaps({
      keyword: `${competitorQuery} ${city}`,
      city,
      state,
      maxResults: 10,
      integrationEnv,
    });

    // Filter out the target business from competitors
    const competitors = competitorResults.filter(c => {
      const isTarget = c.placeId === target.placeId ||
        c.title.toLowerCase() === target.title.toLowerCase();
      return !isTarget;
    }).slice(0, 5);

    // 3. Score the target business
    const audit = scoreGBP(target, competitors);

    res.json({
      success: true,
      audit: {
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
          facebook: target.facebook,
          instagram: target.instagram,
          twitter: target.twitter,
          mapsUrl: target.url,
          placeId: target.placeId,
        },
        ...audit,
        competitors: competitors.map(c => ({
          title: c.title,
          rating: c.totalScore,
          reviewsCount: c.reviewsCount,
          website: c.website,
          categoryName: c.categoryName,
        })),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/gbp/quick
 * Query: businessName, city, state, category?
 * Quick audit via GET for simple use cases.
 */
router.get('/gbp/quick', apiKeyAuth, async (req, res, next) => {
  try {
    req.body = {
      businessName: req.query.businessName,
      city: req.query.city,
      state: req.query.state,
      category: req.query.category,
    };
    // Reuse the POST handler logic
    const wid = workspaceId(req);
    const businessName = String(req.query.businessName || '').trim();
    const city = String(req.query.city || '').trim();
    const state = String(req.query.state || '').trim();
    const category = String(req.query.category || '').trim() || null;

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
        error: 'Maps search not configured.',
      });
    }

    const searchQuery = category ? `${businessName} ${category}` : businessName;
    const targetResults = await mapsSearch.searchGoogleMaps({
      keyword: searchQuery, city, state, maxResults: 5, integrationEnv,
    });

    const target = targetResults.find(r =>
      r.title.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(r.title.toLowerCase())
    ) || targetResults[0];

    if (!target) {
      return res.status(404).json({
        success: false,
        error: `Could not find "${businessName}" in ${city}, ${state}.`,
      });
    }

    const competitorQuery = category || businessName.split(' ')[0];
    const competitorResults = await mapsSearch.searchGoogleMaps({
      keyword: `${competitorQuery} ${city}`, city, state, maxResults: 10, integrationEnv,
    });

    const competitors = competitorResults.filter(c =>
      c.placeId !== target.placeId && c.title.toLowerCase() !== target.title.toLowerCase()
    ).slice(0, 5);

    const audit = scoreGBP(target, competitors);

    res.json({
      success: true,
      audit: {
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
          facebook: target.facebook,
          instagram: target.instagram,
          twitter: target.twitter,
          mapsUrl: target.url,
        },
        ...audit,
        competitors: competitors.map(c => ({
          title: c.title,
          rating: c.totalScore,
          reviewsCount: c.reviewsCount,
          website: c.website,
        })),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.scoreGBP = scoreGBP;
