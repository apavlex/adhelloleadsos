/**
 * Multi-source listing search — Craigslist, Facebook Marketplace, Zillow, etc.
 * Same pattern as mapsSearch: run configured sources, merge + dedupe.
 */

const { mergeListingResults, applyPriceFilters } = require('./normalize');
const craigslist = require('./sources/craigslist');
const facebookMarketplace = require('./sources/facebookMarketplace');
const zillow = require('./sources/zillow');
const mhvillage = require('./sources/mhvillage');
const offerup = require('./sources/offerup');
const realtor = require('./sources/realtor');
const redfin = require('./sources/redfin');
const ebay = require('./sources/ebay');
const webSearch = require('./sources/webSearch');
const oxylabs = require('./sources/oxylabs');

const ALL_SOURCES = [
  craigslist,
  facebookMarketplace,
  offerup,
  mhvillage,
  zillow,
  realtor,
  redfin,
  ebay,
  webSearch,
  oxylabs,
];

const SOURCE_BY_ID = ALL_SOURCES.reduce((acc, s) => {
  acc[s.id] = s;
  return acc;
}, {});

function maxResultsCap(params) {
  return Math.min(500, Math.max(1, parseInt(params.maxResults, 10) || 20));
}

function parseSourcesList(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s) => String(s).trim().toLowerCase()).filter((s) => SOURCE_BY_ID[s]);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,|\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => SOURCE_BY_ID[s]);
  }
  return ALL_SOURCES.map((s) => s.id);
}

function parseSourcesFromBody(body) {
  const raw = body && body.sources;
  if (Array.isArray(raw)) return parseSourcesList(raw);
  if (typeof raw === 'string' && raw.trim()) return parseSourcesList(raw);
  const checked = [];
  if (String(body?.source_craigslist || '').toLowerCase() === 'on') checked.push('craigslist');
  if (String(body?.source_facebook_marketplace || '').toLowerCase() === 'on') {
    checked.push('facebook_marketplace');
  }
  if (String(body?.source_offerup || '').toLowerCase() === 'on') checked.push('offerup');
  if (String(body?.source_mhvillage || '').toLowerCase() === 'on') checked.push('mhvillage');
  if (String(body?.source_zillow || '').toLowerCase() === 'on') checked.push('zillow');
  if (String(body?.source_realtor || '').toLowerCase() === 'on') checked.push('realtor');
  if (String(body?.source_redfin || '').toLowerCase() === 'on') checked.push('redfin');
  if (String(body?.source_ebay || '').toLowerCase() === 'on') checked.push('ebay');
  if (String(body?.source_web_search || '').toLowerCase() === 'on') checked.push('web_search');
  if (String(body?.source_oxylabs || '').toLowerCase() === 'on') checked.push('oxylabs');
  return checked.length ? checked : ALL_SOURCES.map((s) => s.id);
}

function sourceLabel(sourceId) {
  const hit = SOURCE_BY_ID[String(sourceId || '').trim().toLowerCase()];
  return hit ? hit.label : String(sourceId || '');
}

function isConfigured(integrationEnv) {
  return ALL_SOURCES.some((s) => s.isConfigured(integrationEnv));
}

function listSources() {
  return ALL_SOURCES.map((s) => ({ id: s.id, label: s.label }));
}

/**
 * @param {Object} params
 * @param {string} params.city
 * @param {string} params.state
 * @param {string} [params.query] - default "mobile home"
 * @param {string[]|string} [params.sources]
 * @param {number} [params.maxResults]
 * @param {Record<string,string>} [params.integrationEnv]
 */
async function searchListings(params) {
  const integrationEnv = params.integrationEnv;
  const anyConfigured = ALL_SOURCES.some((s) => s.isConfigured(integrationEnv));
  if (!anyConfigured) {
    throw new Error(
      'No listing sources configured. Add APIFY_API_TOKEN and/or SERPAPI_API_KEY / SEARCHAPI_API_KEY under Workspace → API integrations.'
    );
  }

  const cap = maxResultsCap(params);
  const sourceIds = parseSourcesList(params.sources);
  const searchParams = {
    city: params.city,
    state: params.state,
    query: String(params.query || 'mobile home').trim() || 'mobile home',
    maxResults: cap,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    integrationEnv,
  };

  let accumulated = [];
  const perSourceCap = Math.max(5, Math.ceil(cap / Math.max(1, sourceIds.length)));
  const errors = [];

  for (const sourceId of sourceIds) {
    if (accumulated.length >= cap) break;
    const adapter = SOURCE_BY_ID[sourceId];
    if (!adapter || !adapter.isConfigured(integrationEnv)) {
      console.warn(`[listingSearch] Skipping ${sourceId} — not configured.`);
      continue;
    }

    try {
      const need = cap - accumulated.length;
      const rows = await adapter.search({ ...searchParams, maxResults: Math.min(perSourceCap, need) });
      if (!rows || !rows.length) {
        console.warn(`[listingSearch] ${adapter.label} returned 0 listings.`);
        continue;
      }
      const before = accumulated.length;
      accumulated = mergeListingResults(accumulated, rows, cap);
      console.log(
        `[listingSearch] ${adapter.label} +${accumulated.length - before} (total ${accumulated.length}/${cap})`
      );
    } catch (err) {
      errors.push(`${adapter.label}: ${err.message}`);
      console.error(`[listingSearch] ${adapter.label} failed:`, err.message);
    }
  }

  accumulated = applyPriceFilters(accumulated, searchParams);

  if (!accumulated.length) {
    const detail = errors.length ? ` Errors: ${errors.join('; ')}` : '';
    throw new Error(
      `No listings found across ${sourceIds.join(', ')} for "${searchParams.query}" in ${searchParams.city}, ${searchParams.state}.${detail}`
    );
  }

  return accumulated.slice(0, cap);
}

module.exports = {
  isConfigured,
  listSources,
  searchListings,
  parseSourcesList,
  parseSourcesFromBody,
  sourceLabel,
  ALL_SOURCES,
};
