/**
 * Step 1 — Google Maps lead list:
 * default auto order: RapidAPI → SearchAPI.io Google Local → SerpAPI Google Local → Outscraper → Apify.
 */

const apify = require('./apify');
const outscraper = require('./outscraperClient');
const rapidapi = require('./rapidapiLocalBusiness');
const searchapi = require('./searchapiGoogleLocal');
const serpapi = require('./serpapiGoogleLocal');
const oxylabsGoogleLocal = require('./oxylabsGoogleLocal');

function apifyConfigured(integrationEnv) {
  const t = (integrationEnv && integrationEnv.APIFY_API_TOKEN) || process.env.APIFY_API_TOKEN;
  return Boolean(String(t || '').trim());
}

function searchapiConfigured(integrationEnv) {
  return searchapi.isConfigured(integrationEnv);
}

function serpapiConfigured(integrationEnv) {
  return serpapi.isConfigured(integrationEnv);
}

function oxylabsConfigured(integrationEnv) {
  return oxylabsGoogleLocal.isConfigured(integrationEnv);
}

function isMapsSearchConfigured(integrationEnv) {
  return (
    rapidapi.isConfigured(integrationEnv) ||
    searchapiConfigured(integrationEnv) ||
    serpapiConfigured(integrationEnv) ||
    outscraper.isConfigured(integrationEnv) ||
    apifyConfigured(integrationEnv) ||
    oxylabsConfigured(integrationEnv)
  );
}

function resolvePrimary(integrationEnv) {
  const fromWs = String((integrationEnv && integrationEnv.SEARCH_MAPS_PRIMARY) || '').toLowerCase().trim();
  const fromEnv = String(process.env.SEARCH_MAPS_PRIMARY || '').toLowerCase().trim();
  const v = fromWs || fromEnv;
  if (v === 'rapidapi' || v === 'searchapi' || v === 'serpapi' || v === 'apify' || v === 'outscraper' || v === 'oxylabs')
    return v;
  return 'auto';
}

function maxResultsCap(params) {
  return Math.min(500, Math.max(1, parseInt(params.maxResults, 10) || 20));
}

function leadDedupeKey(row) {
  const pid = String(row.placeId || row.google_place_id || '').trim();
  if (pid) return `pid:${pid}`;
  return `t:${String(row.title || '').toLowerCase()}|p:${String(row.phone || '').replace(/\D/g, '')}`;
}

function mergeMapsLeadLists(primary, extra, maxTotal) {
  const cap = Math.max(1, parseInt(maxTotal, 10) || 20);
  const merged = [...(Array.isArray(primary) ? primary : [])];
  const seen = new Set(merged.map(leadDedupeKey));
  for (const row of Array.isArray(extra) ? extra : []) {
    const k = leadDedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
    if (merged.length >= cap) break;
  }
  return merged.slice(0, cap);
}

async function runAutoMapsSearch(params, integrationEnv) {
  const cap = maxResultsCap(params);
  let accumulated = [];
  let lastAutoError = null;

  const providers = [
    {
      label: 'RapidAPI',
      configured: () => rapidapi.isConfigured(integrationEnv),
      search: (p) => rapidapi.searchGoogleMaps(p),
    },
    {
      label: 'SearchAPI.io',
      configured: () => searchapiConfigured(integrationEnv),
      search: (p) => searchapi.searchGoogleMaps(p),
    },
    {
      label: 'SerpAPI',
      configured: () => serpapiConfigured(integrationEnv),
      search: (p) => serpapi.searchGoogleMaps(p),
    },
    {
      label: 'Oxylabs',
      configured: () => oxylabsConfigured(integrationEnv),
      search: (p) => oxylabsGoogleLocal.searchGoogleMaps(p),
    },
    {
      label: 'Outscraper',
      configured: () => outscraper.isConfigured(integrationEnv),
      search: (p) => outscraper.searchGoogleMaps(p),
    },
    {
      label: 'Apify',
      configured: () => apifyConfigured(integrationEnv),
      search: (p) => apify.searchGoogleMaps(p),
    },
  ];

  for (const prov of providers) {
    if (accumulated.length >= cap) break;
    if (!prov.configured()) continue;

    try {
      const need = cap - accumulated.length;
      const rows = await prov.search({ ...params, maxResults: need });
      if (!rows || !rows.length) {
        console.warn(`[mapsSearch] ${prov.label} returned 0 places; trying next provider.`);
        continue;
      }
      const before = accumulated.length;
      accumulated = mergeMapsLeadLists(accumulated, rows, cap);
      if (accumulated.length > before) {
        console.log(
          `[mapsSearch] ${prov.label} added ${accumulated.length - before} place(s); total ${accumulated.length}/${cap}.`
        );
      }
      if (accumulated.length >= cap) break;
    } catch (e) {
      // If the provider returned a "no results" style error (search succeeded but
      // nothing matched), don't fall through to other providers — they won't have
      // results either. Only fall through on infrastructure/auth/rate-limit errors.
      const msg = (e.message || '').toLowerCase();
      const isNoResultsError = msg.includes('returned no businesses') || msg.includes('returned 0') || msg.includes('no places found') || msg.includes('no results');
      if (isNoResultsError) {
        console.warn(`[mapsSearch] ${prov.label} found no results for this query; stopping provider chain.`);
        // Don't set lastAutoError — this is a valid "no data" response, not a failure
        break;
      }
      lastAutoError = e;
      console.warn(`[mapsSearch] ${prov.label} failed, trying next:`, e.message);
    }
  }

  if (accumulated.length > 0) {
    if (accumulated.length < cap) {
      console.log(
        `[mapsSearch] Found ${accumulated.length} of ${cap} requested for "${params.keyword}" in ${params.city}, ${params.state} (no more listings from configured providers).`
      );
    }
    return accumulated;
  }

  // Build debug info for error message
  const providerStatus = {
    rapidapi: rapidapi.isConfigured(integrationEnv),
    searchapi: searchapiConfigured(integrationEnv),
    serpapi: serpapiConfigured(integrationEnv),
    oxylabs: oxylabsConfigured(integrationEnv),
    outscraper: outscraper.isConfigured(integrationEnv),
    apify: apifyConfigured(integrationEnv),
  };
  const envKeys = Object.keys(integrationEnv || {}).filter(k => k.includes('API') || k.includes('TOKEN'));
  const envStatus = {};
  envKeys.forEach(k => { envStatus[k] = (integrationEnv[k] || '').length > 0 ? 'SET' : 'EMPTY'; });

  if (lastAutoError) {
    throw new Error(`Maps search failed (last provider error): ${lastAutoError.message}. Providers: ${JSON.stringify(providerStatus)}. Env: ${JSON.stringify(envStatus)}`);
  }
  throw new Error(
    `No Maps search results found for "${params.keyword}" in ${params.city}, ${params.state}. Providers: ${JSON.stringify(providerStatus)}. Env keys: ${JSON.stringify(envStatus)}. If using RapidAPI, verify endpoint URL and that RAPIDAPI_SEARCH_QUERY_PARAM matches your API host.`
  );
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>} same shape as apify.searchGoogleMaps
 */
async function searchGoogleMaps(params) {
  const integrationEnv = params.integrationEnv || null;
  const override = String(params.mapsProvider || '').toLowerCase().trim();
  const primary =
    override && override !== 'auto' ? override : resolvePrimary(integrationEnv);

  if (primary === 'rapidapi') {
    if (!rapidapi.isConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to RapidAPI, but RAPIDAPI_KEY is missing.');
    }
    return rapidapi.searchGoogleMaps(params);
  }

  if (primary === 'searchapi') {
    if (!searchapiConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to SearchAPI.io, but SEARCHAPI_API_KEY is missing.');
    }
    return searchapi.searchGoogleMaps(params);
  }

  if (primary === 'serpapi') {
    if (!serpapiConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to SerpAPI, but SERPAPI_API_KEY is missing.');
    }
    return serpapi.searchGoogleMaps(params);
  }

  if (primary === 'apify') {
    if (!apifyConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Apify, but APIFY_API_TOKEN is missing.');
    }
    return apify.searchGoogleMaps(params);
  }

  if (primary === 'outscraper') {
    if (!outscraper.isConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Outscraper, but OUTSCRAPER_API_KEY is missing.');
    }
    return outscraper.searchGoogleMaps(params);
  }

  if (primary === 'oxylabs') {
    if (!oxylabsConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Oxylabs, but OXYLABS_USERNAME / OXYLABS_PASSWORD are missing.');
    }
    return oxylabsGoogleLocal.searchGoogleMaps(params);
  }

  return runAutoMapsSearch(params, integrationEnv);
}

function filterMapsResults(results, criteria = {}) {
  let out = Array.isArray(results) ? [...results] : [];
  const minRating = parseFloat(criteria.minRating);
  if (Number.isFinite(minRating) && minRating > 0) {
    out = out.filter((r) => parseFloat(r.totalScore) >= minRating);
  }
  const minReviews = parseInt(criteria.minReviews, 10);
  if (Number.isFinite(minReviews) && minReviews > 0) {
    out = out.filter((r) => parseInt(r.reviewsCount, 10) >= minReviews);
  }
  return out;
}

/** Status row for Workspace → Integrations (Auto chain order). */
function getMapsProviderStatusList(integrationEnv) {
  return [
    {
      id: 'rapidapi',
      label: 'RapidAPI',
      configured: rapidapi.isConfigured(integrationEnv),
    },
    {
      id: 'searchapi',
      label: 'SearchAPI.io',
      configured: searchapiConfigured(integrationEnv),
    },
    {
      id: 'serpapi',
      label: 'SerpAPI',
      configured: serpapiConfigured(integrationEnv),
    },
    {
      id: 'oxylabs',
      label: 'Oxylabs',
      configured: oxylabsConfigured(integrationEnv),
    },
    {
      id: 'outscraper',
      label: 'Outscraper',
      configured: outscraper.isConfigured(integrationEnv),
    },
    {
      id: 'apify',
      label: 'Apify',
      configured: apifyConfigured(integrationEnv),
    },
  ];
}

module.exports = {
  searchGoogleMaps,
  isMapsSearchConfigured,
  resolvePrimary,
  getMapsProviderStatusList,
  filterMapsResults,
};
