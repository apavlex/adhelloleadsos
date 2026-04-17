const { clampPipelineStage } = require('./pipelineConstants');

/**
 * Acquisition channels beyond Google Maps + Apify — taxonomy for product + `/api/leads/signal-ingest`.
 * Status describes what ships in-repo today vs planned connectors (Apify actors, official APIs).
 */

const CHANNELS = [
  {
    id: 'google_maps_apify',
    label: 'Google Maps + Apify',
    audience: 'Local SMB',
    status: 'live',
    notes: 'Default cold engine — niches like plumbers and dentists.',
    env: ['APIFY_API_TOKEN', 'APIFY_GOOGLE_MAPS_ACTOR_ID'],
  },
  {
    id: 'tech_stack_html',
    label: 'Website tech detection',
    audience: 'SaaS, e‑com, B2B',
    status: 'live',
    notes:
      'Lightweight HTML signals (CMS/builder + chat widgets) layered on Firecrawl extract — flags “Wix but no chatbot” style gaps. Swap in BuiltWith/Wappalyzer APIs later.',
    env: ['FIRECRAWL_API_KEY'],
  },
  {
    id: 'jobs_indeed_linkedin',
    label: 'Job boards (Indeed / LinkedIn jobs)',
    audience: 'B2B, SaaS hiring motion',
    status: 'planned',
    notes:
      'Hiring marketers, SDRs, or “AI specialist” roles are budget signals. Implement via Apify actors or licensed job APIs — respect robots + ToS.',
    env: ['APIFY_JOBS_ACTOR_ID'],
  },
  {
    id: 'ads_library',
    label: 'Meta / Google Ads transparency',
    audience: 'Anyone already spending on ads',
    status: 'planned',
    notes:
      'Companies running ads have budget + marketing function. Prefer official Transparency / Ads Library APIs or compliant Apify actors.',
    env: ['APIFY_META_ADS_ACTOR_ID'],
  },
  {
    id: 'community_intent',
    label: 'Reddit / Facebook groups intent',
    audience: 'High-intent services',
    status: 'planned',
    notes:
      'Match phrases like “looking for a marketing agency”. Requires platform APIs or manual exports — scraping may violate ToS.',
    env: [],
  },
  {
    id: 'reviews_listening',
    label: 'Reviews listening (1–3★)',
    audience: 'Competitor displacement',
    status: 'partial',
    notes:
      'Increase Apify Maps review depth via APIFY_MAPS_MAX_REVIEWS; add Yelp/Facebook/Trustpilot actors separately.',
    env: ['APIFY_MAPS_MAX_REVIEWS'],
  },
  {
    id: 'creator_outreach',
    label: 'YouTube / TikTok creators',
    audience: 'Influencer / niche plays',
    status: 'planned',
    notes:
      'Discovery via platform search APIs or curated lists — bridge into same lead record shape as other channels.',
    env: [],
  },
];

function summaryForApi() {
  return CHANNELS.map((c) => ({
    id: c.id,
    label: c.label,
    audience: c.audience,
    status: c.status,
    notes: c.notes,
    env: c.env,
  }));
}

/**
 * Normalize inbound programmatic leads (jobs, ads, intent posts) before saveLead.
 */
function hostnameFromWebsite(website) {
  if (!website || website === 'N/A') return '';
  try {
    const u = String(website).trim().startsWith('http')
      ? String(website).trim()
      : `https://${String(website).trim()}`;
    const h = new URL(u).hostname.replace(/^www\./i, '');
    return h || '';
  } catch {
    return '';
  }
}

function normalizeSignalLead(body) {
  const title =
    String(body.title || body.company_name || '').trim() || hostnameFromWebsite(body.website);
  const website = body.website ? String(body.website).trim() : 'N/A';
  const email = body.email ? String(body.email).trim() : 'N/A';

  const buyingSignals = Array.isArray(body.buyingSignals)
    ? body.buyingSignals.map(String)
    : body.buyingSignal
      ? [String(body.buyingSignal)]
      : [];

  const signalMeta = body.signalMetadata && typeof body.signalMetadata === 'object' ? body.signalMetadata : {};

  return {
    title: title || 'Untitled prospect',
    website,
    email,
    phone: body.phone || 'N/A',
    city: body.city || '',
    state: body.state || '',
    categoryName: body.categoryName || body.role_title || 'Signal lead',
    source: body.source || 'signal_ingest',
    sourceChannel: body.sourceChannel || body.channel || 'unknown',
    buyingSignals,
    signalMetadata: signalMeta,
    url: body.url || '',
    totalScore: parseFloat(body.totalScore) || 0,
    reviewsCount: parseInt(body.reviewsCount, 10) || 0,
    pipelineStage:
      body.pipelineStage != null && body.pipelineStage !== ''
        ? clampPipelineStage(body.pipelineStage)
        : 1,
  };
}

module.exports = {
  CHANNELS,
  summaryForApi,
  normalizeSignalLead,
};
