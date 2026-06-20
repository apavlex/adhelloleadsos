/**
 * Mobile home / listing discovery via Oxylabs google_search organic results.
 */

const oxylabs = require('../../oxylabsClient');
const { normalizeListingRow, mergeListingResults } = require('../normalize');

const LISTING_HOST_HINTS = [
  'craigslist.org',
  'facebook.com/marketplace',
  'offerup.com',
  'mhvillage.com',
  'zillow.com',
  'realtor.com',
  'redfin.com',
  'homes.com',
  'trulia.com',
  'landwatch.com',
  'landandfarm.com',
  'ebay.com',
  'mobilehomes.com',
  'manufacturedhousing.com',
];

function isLikelyListingUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http')) return false;
  if (LISTING_HOST_HINTS.some((h) => u.includes(h))) return true;
  const saleHints = ['for-sale', 'forsale', 'listing', 'homedetails', '/item/', '/d/', 'marketplace'];
  return saleHints.some((h) => u.includes(h));
}

function extractPriceFromText(text) {
  if (!text) return null;
  const m = String(text).match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildSearchQuery({ city, state, query }) {
  const q = String(query || 'mobile home').trim();
  const loc = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  return loc ? `"${q}" for sale ${loc}` : `"${q}" for sale`;
}

function normalizeOrganicResult(result, { city, state, query }) {
  const url = result.url || result.link || '';
  const title = result.title || result.name || url;
  const snippet = result.desc || result.description || result.snippet || '';
  const price = extractPriceFromText(`${title} ${snippet}`);
  const id = String(result.pos || result.position || url || title).trim();

  return normalizeListingRow({
    source: 'oxylabs_web',
    sourceId: id,
    title,
    price,
    url,
    description: snippet,
    city,
    state,
    propertyType: 'mobile_home',
    postedAt: result.date || '',
  });
}

function isConfigured(integrationEnv) {
  return oxylabs.isConfigured(integrationEnv);
}

async function searchOxylabsListings(params) {
  const integrationEnv = params.integrationEnv;
  const cap = Math.max(1, parseInt(params.maxResults, 10) || 20);
  const q = buildSearchQuery(params);

  const payload = {
    source: 'google_search',
    query: q,
    domain: 'com',
    geo_location: oxylabs.geoLocationForCityState(params.city, params.state),
    parse: true,
    pages: Math.min(5, Math.max(1, Math.ceil(cap / 10))),
    limit: 10,
  };

  const data = await oxylabs.postQuery(payload, integrationEnv, { timeoutMs: 90000 });
  const resultRows = oxylabs.resultRows(data);
  let accumulated = [];

  for (const row of resultRows) {
    const content = oxylabs.extractContent(row);
    const parsed = oxylabs.parsedGoogleResults(content);
    const organic = parsed && Array.isArray(parsed.organic) ? parsed.organic : [];
    const mapped = organic
      .filter((r) => isLikelyListingUrl(r.url || r.link))
      .map((r) =>
        normalizeOrganicResult(r, {
          city: params.city,
          state: params.state,
          query: params.query,
        })
      );
    accumulated = mergeListingResults(accumulated, mapped, cap);
    if (accumulated.length >= cap) break;
  }

  if (!accumulated.length) {
    throw new Error(`Oxylabs web search returned no listing URLs for "${q}".`);
  }

  return accumulated.slice(0, cap);
}

module.exports = {
  id: 'oxylabs',
  label: 'Oxylabs (Google)',
  isConfigured,
  search: searchOxylabsListings,
};
