/**
 * Google organic web search for listing URLs (SerpAPI + SearchAPI.io).
 * Casts a wide net across the open web when marketplace adapters miss listings.
 */

const SERPAPI_URL = 'https://serpapi.com/search.json';
const SEARCHAPI_URL = 'https://www.searchapi.io/api/v1/search';

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

function serpapiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.SERPAPI_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.SERPAPI_API_KEY || '').trim();
}

function searchapiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.SEARCHAPI_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.SEARCHAPI_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(serpapiKey(integrationEnv) || searchapiKey(integrationEnv));
}

function buildSearchQuery({ city, state, query }) {
  const q = String(query || 'mobile home').trim();
  const loc = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  return loc ? `"${q}" for sale ${loc}` : `"${q}" for sale`;
}

function extractPriceFromText(text) {
  if (!text) return null;
  const m = String(text).match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeOrganicResult(result, { source, city, state, query }) {
  const { normalizeListingRow } = require('../normalize');
  const url = result.link || result.url || '';
  const title = result.title || result.name || url;
  const snippet = result.snippet || result.description || result.snippet_highlighted_words?.join(' ') || '';
  const price = extractPriceFromText(`${title} ${snippet}`);
  const id = String(result.position || result.rank || url || title).trim();

  return normalizeListingRow({
    source,
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

function isLikelyListingUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http')) return false;
  if (LISTING_HOST_HINTS.some((h) => u.includes(h))) return true;
  const saleHints = ['for-sale', 'forsale', 'listing', 'homedetails', '/item/', '/d/', 'marketplace'];
  return saleHints.some((h) => u.includes(h));
}

async function fetchSerpapiOrganic(params, integrationEnv, cap) {
  const key = serpapiKey(integrationEnv);
  if (!key) return [];

  const q = buildSearchQuery(params);
  const url = new URL(SERPAPI_URL);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', q);
  url.searchParams.set('num', String(Math.min(100, Math.max(10, cap))));
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`SerpAPI web search HTTP ${res.status}`);
  const data = await res.json();
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  return organic
    .filter((r) => isLikelyListingUrl(r.link))
    .slice(0, cap)
    .map((r) =>
      normalizeOrganicResult(r, {
        source: 'web_serpapi',
        city: params.city,
        state: params.state,
        query: params.query,
      })
    );
}

async function fetchSearchapiOrganic(params, integrationEnv, cap) {
  const key = searchapiKey(integrationEnv);
  if (!key) return [];

  const q = buildSearchQuery(params);
  const url = new URL(SEARCHAPI_URL);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', q);
  url.searchParams.set('num', String(Math.min(100, Math.max(10, cap))));
  url.searchParams.set('api_key', key);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`SearchAPI.io web search HTTP ${res.status}`);
  const data = await res.json();
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  return organic
    .filter((r) => isLikelyListingUrl(r.link || r.url))
    .slice(0, cap)
    .map((r) =>
      normalizeOrganicResult(r, {
        source: 'web_searchapi',
        city: params.city,
        state: params.state,
        query: params.query,
      })
    );
}

async function searchWebSearch(params) {
  const integrationEnv = params.integrationEnv;
  const cap = Math.max(1, parseInt(params.maxResults, 10) || 20);
  const perProvider = Math.max(5, Math.ceil(cap / 2));
  let rows = [];
  const errors = [];

  if (serpapiKey(integrationEnv)) {
    try {
      const serpRows = await fetchSerpapiOrganic(params, integrationEnv, perProvider);
      rows = require('../normalize').mergeListingResults(rows, serpRows, cap);
    } catch (e) {
      errors.push(`SerpAPI: ${e.message}`);
    }
  }

  if (rows.length < cap && searchapiKey(integrationEnv)) {
    try {
      const need = cap - rows.length;
      const saRows = await fetchSearchapiOrganic(params, integrationEnv, need);
      rows = require('../normalize').mergeListingResults(rows, saRows, cap);
    } catch (e) {
      errors.push(`SearchAPI.io: ${e.message}`);
    }
  }

  if (!rows.length && errors.length) {
    throw new Error(errors.join('; '));
  }

  return rows.slice(0, cap);
}

module.exports = {
  id: 'web_search',
  label: 'Web search (Google)',
  isConfigured,
  search: searchWebSearch,
};
