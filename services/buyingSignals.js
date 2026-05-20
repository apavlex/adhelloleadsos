/**
 * Buying Signal Detector
 *
 * Enriches leads with buying signals that indicate they're more likely to buy:
 * - Hiring signals (job postings = growing business)
 * - Website freshness (new website = recent investment)
 * - Google Ads presence (running ads = marketing budget)
 * - Review velocity (getting reviews = active business)
 * - Social media activity
 *
 * Each signal adds to a "buying score" 0-100 that prioritizes outreach.
 */

const dbService = require('./database');

// ── Signal Detection ──────────────────────────────────────────────────────────

/**
 * Detect buying signals for a business based on available data.
 * Returns an array of signal objects with type, description, and strength (1-3).
 */
function detectSignals(lead, enrichedData = {}) {
  const signals = [];

  // 1. Review velocity signal
  const reviews = lead.reviewsCount || 0;
  if (reviews > 0 && reviews < 10) {
    signals.push({
      type: 'reviews_low',
      label: 'Low review count',
      description: `Only ${reviews} reviews — room for improvement`,
      strength: 2,
      category: 'opportunity',
    });
  } else if (reviews >= 10 && reviews < 50) {
    signals.push({
      type: 'reviews_growing',
      label: 'Growing review profile',
      description: `${reviews} reviews — actively getting feedback`,
      strength: 1,
      category: 'positive',
    });
  }

  // 2. Rating signal
  const rating = lead.totalScore || 0;
  if (rating > 0 && rating < 4.0) {
    signals.push({
      type: 'rating_low',
      label: 'Below-average rating',
      description: `${rating} stars — reputation management opportunity`,
      strength: 3,
      category: 'opportunity',
    });
  } else if (rating >= 4.5) {
    signals.push({
      type: 'rating_high',
      label: 'Strong rating',
      description: `${rating} stars — well-established reputation`,
      strength: 1,
      category: 'positive',
    });
  }

  // 3. Website signal
  if (!lead.website || lead.website === 'N/A') {
    signals.push({
      type: 'no_website',
      label: 'No website',
      description: 'No website listed on Google Business Profile',
      strength: 3,
      category: 'opportunity',
    });
  }

  // 4. Phone signal
  if (!lead.phone || lead.phone === 'N/A') {
    signals.push({
      type: 'no_phone',
      label: 'No phone listed',
      description: 'No phone number on GBP — hard to contact',
      strength: 2,
      category: 'opportunity',
    });
  }

  // 5. Social media signals
  let socialCount = 0;
  if (lead.facebook && lead.facebook !== 'N/A') socialCount++;
  if (lead.instagram && lead.instagram !== 'N/A') socialCount++;
  if (lead.twitter && lead.twitter !== 'N/A') socialCount++;

  if (socialCount === 0) {
    signals.push({
      type: 'no_social',
      label: 'No social media links',
      description: 'No social media profiles linked to GBP',
      strength: 2,
      category: 'opportunity',
    });
  }

  // 6. Category signal
  if (!lead.categoryName || lead.categoryName === 'N/A') {
    signals.push({
      type: 'no_category',
      label: 'No business category',
      description: 'Business category not set on GBP',
      strength: 2,
      category: 'opportunity',
    });
  }

  // 7. Email signal
  if (!lead.email || lead.email === 'N/A') {
    signals.push({
      type: 'no_email',
      label: 'No email found',
      description: 'No email address available for outreach',
      strength: 1,
      category: 'contact',
    });
  } else {
    signals.push({
      type: 'has_email',
      label: 'Email available',
      description: `Email: ${lead.email}`,
      strength: 1,
      category: 'contact',
    });
  }

  // 8. Enriched data signals (from web enrichment)
  if (enrichedData.hasJobPostings) {
    signals.push({
      type: 'hiring',
      label: '🚀 Hiring detected',
      description: 'Business has active job postings — growing and spending',
      strength: 3,
      category: 'buying_signal',
    });
  }

  if (enrichedData.hasGoogleAds) {
    signals.push({
      type: 'google_ads',
      label: '💰 Running Google Ads',
      description: 'Business is paying for Google Ads — has marketing budget',
      strength: 3,
      category: 'buying_signal',
    });
  }

  if (enrichedData.websiteAge && enrichedData.websiteAge < 365) {
    signals.push({
      type: 'new_website',
      label: '🆕 New website',
      description: `Website is less than 1 year old — recently invested in online presence`,
      strength: 2,
      category: 'buying_signal',
    });
  }

  if (enrichedData.domainAuthority && enrichedData.domainAuthority < 20) {
    signals.push({
      type: 'low_da',
      label: 'Low domain authority',
      description: 'Website has low authority — SEO opportunity',
      strength: 2,
      category: 'opportunity',
    });
  }

  return signals;
}

/**
 * Calculate a buying score from 0-100 based on detected signals.
 * Higher score = more likely to be a good prospect.
 */
function calculateBuyingScore(signals) {
  let score = 30; // Base score

  for (const signal of signals) {
    if (signal.category === 'buying_signal') {
      score += signal.strength * 8; // Strongest signals
    } else if (signal.category === 'opportunity') {
      score += signal.strength * 5; // Opportunities = they need help
    } else if (signal.category === 'contact') {
      score += signal.strength * 3; // Contact info available
    } else if (signal.category === 'positive') {
      score += signal.strength * 2; // Positive signals
    }
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Get a priority label based on buying score.
 */
function getPriority(score) {
  if (score >= 80) return '🔥 HOT';
  if (score >= 60) return '⚡ WARM';
  if (score >= 40) return '📋 QUALIFIED';
  return '❄️ COLD';
}

/**
 * Enrich a lead with buying signals and score.
 */
function enrichLeadWithSignals(lead, enrichedData = {}) {
  const signals = detectSignals(lead, enrichedData);
  const buyingScore = calculateBuyingScore(signals);
  const priority = getPriority(buyingScore);

  return {
    ...lead,
    signals,
    buyingScore,
    priority,
    signalCount: signals.length,
    opportunityCount: signals.filter(s => s.category === 'opportunity').length,
    buyingSignalCount: signals.filter(s => s.category === 'buying_signal').length,
  };
}

/**
 * Sort leads by buying score (highest first).
 */
function sortByBuyingScore(leads) {
  return [...leads].sort((a, b) => (b.buyingScore || 0) - (a.buyingScore || 0));
}

module.exports = {
  detectSignals,
  calculateBuyingScore,
  getPriority,
  enrichLeadWithSignals,
  sortByBuyingScore,
};
