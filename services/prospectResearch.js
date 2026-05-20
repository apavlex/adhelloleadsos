/**
 * Prospect Research Engine
 *
 * Combines multiple data sources to build a complete research profile:
 * 1. Google Maps data (GBP profile, rating, reviews, competitors)
 * 2. Website analysis (tech stack, modernity, SEO signals, chatbot)
 * 3. Web search (news, job postings, press releases, social activity)
 * 4. Buying signals (from all sources)
 * 5. Outreach recommendations (personalized based on findings)
 */

const mapsSearch = require('./mapsSearch');
const workspaceIntegrations = require('./workspaceIntegrations');
const buyingSignals = require('./buyingSignals');
const outreachGenerator = require('./outreachGenerator');
const demoGenerator = require('./demoGenerator');
const firecrawl = require('./firecrawl');

// ── Website Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze a business website for signals.
 */
async function analyzeWebsite(url, integrationEnv) {
  if (!url || url === 'N/A') {
    return null;
  }

  try {
    const data = await firecrawl.enrichLead(url, { integrationEnv });

    return {
      url,
      hasWebsite: true,
      // Tech signals
      cmsPlatform: data.cms_platform || 'unknown',
      techStack: data.tech_stack_tags || [],
      hasSchemaMarkup: data.has_schema_markup || false,
      hasChatbot: data.has_chatbot || false,
      hasClickToCall: data.has_click_to_call || false,
      isMobileFriendly: data.is_mobile_friendly || false,
      isOutdated: data.is_outdated || false,
      visualModernityScore: data.visual_modernity_score || 0,
      aeoScore: data.aeo_score || 0,
      // Contact info from website
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      // Social links
      facebook: data.facebook || null,
      instagram: data.instagram || null,
      twitter: data.twitter || null,
      linkedin: data.linkedin || null,
      googlePlaces: data.google_places || null,
      yelp: data.yelp || null,
      // Reviews
      totalScore: data.total_score || null,
      reviewsCount: data.reviews_count || null,
      reviewSnippets: data.review_snippets || [],
      // Audit
      auditSummary: data.audit_summary || null,
      geoGaps: data.geo_gaps || null,
      competitorName: data.competitor_name || null,
      competitorGap: data.competitor_gap || null,
    };
  } catch (err) {
    console.warn(`[ProspectResearch] Website analysis failed for ${url}:`, err.message);
    return { url, hasWebsite: true, error: err.message };
  }
}

// ── Web Search ────────────────────────────────────────────────────────────────

/**
 * Search the web for news, job postings, and other signals about a business.
 */
async function searchWeb(businessName, city, state, integrationEnv) {
  const results = {
    news: [],
    jobPostings: [],
    pressReleases: [],
    socialActivity: [],
    reviews: [],
  };

  // Search for recent news
  try {
    const newsQuery = `${businessName} ${city} ${state} news 2025 2026`;
    const newsResults = await firecrawl.searchBusiness(newsQuery, integrationEnv);
    results.news = newsResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || r.snippet || '',
    }));
  } catch (err) {
    console.warn('[ProspectResearch] News search failed:', err.message);
  }

  // Search for job postings (hiring signal)
  try {
    const jobsQuery = `${businessName} ${city} ${state} hiring jobs careers`;
    const jobsResults = await firecrawl.searchBusiness(jobsQuery, integrationEnv);
    results.jobPostings = jobsResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || r.snippet || '',
    }));
  } catch (err) {
    console.warn('[ProspectResearch] Job search failed:', err.message);
  }

  // Search for press releases
  try {
    const prQuery = `${businessName} ${city} ${state} press release announcement`;
    const prResults = await firecrawl.searchBusiness(prQuery, integrationEnv);
    results.pressReleases = prResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || r.snippet || '',
    }));
  } catch (err) {
    console.warn('[ProspectResearch] PR search failed:', err.message);
  }

  // Search for social media activity
  try {
    const socialQuery = `${businessName} ${city} ${state} facebook instagram linkedin`;
    const socialResults = await firecrawl.searchBusiness(socialQuery, integrationEnv);
    results.socialActivity = socialResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || r.snippet || '',
    }));
  } catch (err) {
    console.warn('[ProspectResearch] Social search failed:', err.message);
  }

  // Search for reviews on other platforms
  try {
    const reviewQuery = `${businessName} ${city} ${state} reviews yelp bbb`;
    const reviewResults = await firecrawl.searchBusiness(reviewQuery, integrationEnv);
    results.reviews = reviewResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || r.snippet || '',
    }));
  } catch (err) {
    console.warn('[ProspectResearch] Review search failed:', err.message);
  }

  return results;
}

// ── Compile Research Brief ────────────────────────────────────────────────────

/**
 * Compile a complete research brief from all data sources.
 */
function compileResearchBrief(business, mapsData, websiteData, webSearch, competitors) {
  const signals = buyingSignals.enrichLeadWithSignals(mapsData, {
    hasJobPostings: webSearch.jobPostings.length > 0,
    hasGoogleAds: false, // Would need ad library API
    websiteAge: websiteData?.isOutdated ? 3650 : 180, // Rough estimate
  });

  // Additional signals from web search
  if (webSearch.jobPostings.length > 0) {
    signals.signals.push({
      type: 'hiring',
      label: '🚀 Hiring detected',
      description: `Found ${webSearch.jobPostings.length} job posting(s) — business is growing`,
      strength: 3,
      category: 'buying_signal',
    });
  }

  if (webSearch.news.length > 0) {
    signals.signals.push({
      type: 'in_news',
      label: '📰 Recent news coverage',
      description: `Found ${webSearch.news.length} recent news mention(s)`,
      strength: 2,
      category: 'buying_signal',
    });
  }

  if (webSearch.pressReleases.length > 0) {
    signals.signals.push({
      type: 'press_release',
      label: '📢 Press release found',
      description: `Found ${webSearch.pressReleases.length} press release(s) — active PR`,
      strength: 2,
      category: 'buying_signal',
    });
  }

  // Website signals
  if (websiteData) {
    if (websiteData.isOutdated) {
      signals.signals.push({
        type: 'outdated_website',
        label: '🕸️ Outdated website',
        description: `Website design appears outdated (modernity score: ${websiteData.visualModernityScore}/10)`,
        strength: 3,
        category: 'opportunity',
      });
    }

    if (!websiteData.hasSchemaMarkup) {
      signals.signals.push({
        type: 'no_schema',
        label: '📊 No schema markup',
        description: 'Website lacks structured data for local SEO',
        strength: 2,
        category: 'opportunity',
      });
    }

    if (!websiteData.hasChatbot) {
      signals.signals.push({
        type: 'no_chatbot',
        label: '💬 No chatbot detected',
        description: 'No AI chatbot or live chat on website — missing leads after hours',
        strength: 2,
        category: 'opportunity',
      });
    }

    if (!websiteData.isMobileFriendly) {
      signals.signals.push({
        type: 'not_mobile_friendly',
        label: '📱 Not mobile-friendly',
        description: 'Website may not work well on mobile devices',
        strength: 2,
        category: 'opportunity',
      });
    }

    if (websiteData.aeoScore && websiteData.aeoScore < 3) {
      signals.signals.push({
        type: 'low_aeo',
        label: '🔍 Low AEO score',
        description: `Answer Engine Optimization score: ${websiteData.aeoScore}/5 — content not structured for AI search`,
        strength: 2,
        category: 'opportunity',
      });
    }
  }

  // Recalculate score with new signals
  signals.buyingScore = buyingSignals.calculateBuyingScore(signals.signals);
  signals.priority = buyingSignals.getPriority(signals.buyingScore);

  return {
    business: {
      title: mapsData.title,
      phone: mapsData.phone,
      website: mapsData.website,
      email: mapsData.email || websiteData?.email,
      address: mapsData.address,
      city: mapsData.city,
      state: mapsData.state,
      categoryName: mapsData.categoryName,
      rating: mapsData.totalScore,
      reviewsCount: mapsData.reviewsCount,
      mapsUrl: mapsData.url,
    },
    website: websiteData ? {
      url: websiteData.url,
      cms: websiteData.cmsPlatform,
      techStack: websiteData.techStack,
      modernityScore: websiteData.visualModernityScore,
      aeoScore: websiteData.aeoScore,
      hasSchema: websiteData.hasSchemaMarkup,
      hasChatbot: websiteData.hasChatbot,
      isMobileFriendly: websiteData.isMobileFriendly,
      isOutdated: websiteData.isOutdated,
      auditSummary: websiteData.auditSummary,
    } : null,
    webSearch: {
      newsCount: webSearch.news.length,
      jobPostingsCount: webSearch.jobPostings.length,
      pressReleasesCount: webSearch.pressReleases.length,
      socialLinksFound: webSearch.socialActivity.length,
      reviewSites: webSearch.reviews.length,
      topNews: webSearch.news.slice(0, 3),
      topJobPostings: webSearch.jobPostings.slice(0, 3),
    },
    competitors: competitors.slice(0, 5).map(c => ({
      title: c.title,
      rating: c.totalScore,
      reviewsCount: c.reviewsCount,
      website: c.website,
    })),
    signals: signals.signals,
    buyingScore: signals.buyingScore,
    priority: signals.priority,
  };
}

// ── Main Research Function ────────────────────────────────────────────────────

/**
 * Run a complete prospect research.
 */
async function researchProspect(businessName, city, state, category, options = {}) {
  const integrationEnv = options.integrationEnv || {};

  // 1. Search Google Maps for the business
  const searchQuery = category ? `${businessName} ${category}` : businessName;
  const mapsResults = await mapsSearch.searchGoogleMaps({
    keyword: searchQuery, city, state, maxResults: 5, integrationEnv,
  });

  const target = mapsResults.find(r =>
    r.title.toLowerCase().includes(businessName.toLowerCase()) ||
    businessName.toLowerCase().includes(r.title.toLowerCase())
  ) || mapsResults[0];

  if (!target) {
    throw new Error(`Could not find "${businessName}" in ${city}, ${state}.`);
  }

  // 2. Get competitors
  const competitorQuery = category || businessName.split(' ')[0];
  const competitorResults = await mapsSearch.searchGoogleMaps({
    keyword: `${competitorQuery} ${city}`, city, state, maxResults: 10, integrationEnv,
  });
  const competitors = competitorResults.filter(c =>
    c.placeId !== target.placeId && c.title.toLowerCase() !== target.title.toLowerCase()
  ).slice(0, 5);

  // 3. Analyze website (if they have one)
  let websiteData = null;
  if (target.website && target.website !== 'N/A') {
    websiteData = await analyzeWebsite(target.website, integrationEnv);
  }

  // 4. Search the web for news, jobs, etc.
  const webSearch = await searchWeb(target.title, city, state, integrationEnv);

  // 5. Compile research brief
  const brief = compileResearchBrief(target, target, websiteData, webSearch, competitors);

  // 6. Generate outreach package
  const demoUrl = demoGenerator.generateDemoUrl(
    process.env.BASE_URL || 'https://adhelloleadsos.onrender.com',
    target, 'leadQualifier'
  );

  brief.outreach = outreachGenerator.generateOutreachPackage(target, {
    signals: brief.signals,
    demoUrl,
    channel: 'all',
    template: brief.signals.some(s => s.category === 'buying_signal') ? 'signalBased' : 'problemFirst',
  });

  brief.demoUrl = demoUrl;
  brief.generatedAt = new Date().toISOString();

  return brief;
}

module.exports = {
  researchProspect,
  analyzeWebsite,
  searchWeb,
  compileResearchBrief,
};
