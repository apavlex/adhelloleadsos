/**
 * Step 1 — Google Maps lead list.
 * Auto / default chain: RapidAPI → SearchAPI → SerpAPI → Oxylabs → Outscraper → Apify.
 * RapidAPI mode: RapidAPI → Outscraper only.
 * Forced single-provider modes still available via SEARCH_MAPS_PRIMARY / mapsProvider.
 * Monid is no longer used for Maps.
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
    outscraper.isConfigured(integrationEnv) ||
    searchapiConfigured(integrationEnv) ||
    serpapiConfigured(integrationEnv) ||
    apifyConfigured(integrationEnv) ||
    oxylabsConfigured(integrationEnv)
  );
}

function resolvePrimary(integrationEnv) {
  const fromWs = String((integrationEnv && integrationEnv.SEARCH_MAPS_PRIMARY) || '').toLowerCase().trim();
  const fromEnv = String(process.env.SEARCH_MAPS_PRIMARY || '').toLowerCase().trim();
  let v = fromWs || fromEnv;
  // Monid Maps retired — treat legacy preference as Auto (full fallback chain).
  if (v === 'monid') v = 'auto';
  if (
    v === 'rapidapi' ||
    v === 'searchapi' ||
    v === 'serpapi' ||
    v === 'apify' ||
    v === 'outscraper' ||
    v === 'oxylabs' ||
    v === 'auto'
  )
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

/**
 * Run Maps providers in order until enough results are collected.
 * @param {{ continueOnNoResults?: boolean }} [opts]
 */
async function runProviderChain(params, integrationEnv, providers, opts = {}) {
  const continueOnNoResults = opts.continueOnNoResults !== false;
  const cap = maxResultsCap(params);
  let accumulated = [];
  let lastAutoError = null;

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
          `[mapsSearch] ${prov.label} added ${accumulated.length - before} place(s); total ${accumulated.length}/${cap}.`,
        );
      }
      if (accumulated.length >= cap) break;
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      const isNoResultsError =
        msg.includes('returned no businesses') ||
        msg.includes('returned 0') ||
        msg.includes('no places found') ||
        msg.includes('no results');
      if (isNoResultsError && !continueOnNoResults) {
        console.warn(`[mapsSearch] ${prov.label} found no results for this query; stopping provider chain.`);
        break;
      }
      if (isNoResultsError) {
        console.warn(`[mapsSearch] ${prov.label} found no results; trying next provider.`);
        continue;
      }
      lastAutoError = e;
      console.warn(`[mapsSearch] ${prov.label} failed, trying next:`, e.message);
    }
  }

  if (accumulated.length > 0) {
    if (accumulated.length < cap) {
      console.log(
        `[mapsSearch] Found ${accumulated.length} of ${cap} requested for "${params.keyword}" in ${params.city}, ${params.state} (no more listings from configured providers).`,
      );
    }
    return accumulated;
  }

  const providerStatus = Object.fromEntries(providers.map((p) => [p.id || p.label, p.configured()]));
  const envKeys = Object.keys(integrationEnv || {}).filter((k) => k.includes('API') || k.includes('TOKEN'));
  const envStatus = {};
  envKeys.forEach((k) => {
    envStatus[k] = (integrationEnv[k] || '').length > 0 ? 'SET' : 'EMPTY';
  });

  if (lastAutoError) {
    throw new Error(
      `Maps search failed (last provider error): ${lastAutoError.message}. Providers: ${JSON.stringify(providerStatus)}. Env: ${JSON.stringify(envStatus)}`,
    );
  }
  throw new Error(
    `No Maps search results found for "${params.keyword}" in ${params.city}, ${params.state}. Providers: ${JSON.stringify(providerStatus)}. Env keys: ${JSON.stringify(envStatus)}. Configure a Maps provider under Workspace → Integrations (RapidAPI, SearchAPI, SerpAPI, Oxylabs, Outscraper, or Apify).`,
  );
}

/** Short chain: RapidAPI → Outscraper. */
function preferredProviders(integrationEnv) {
  return [
    {
      id: 'rapidapi',
      label: 'RapidAPI',
      configured: () => rapidapi.isConfigured(integrationEnv),
      search: (p) => rapidapi.searchGoogleMaps(p),
    },
    {
      id: 'outscraper',
      label: 'Outscraper',
      configured: () => outscraper.isConfigured(integrationEnv),
      search: (p) => outscraper.searchGoogleMaps(p),
    },
  ];
}

/** Full Auto chain used by folder Run search / scheduled jobs / mapsProvider=auto. */
function autoProviders(integrationEnv) {
  return [
    {
      id: 'rapidapi',
      label: 'RapidAPI',
      configured: () => rapidapi.isConfigured(integrationEnv),
      search: (p) => rapidapi.searchGoogleMaps(p),
    },
    {
      id: 'searchapi',
      label: 'SearchAPI.io',
      configured: () => searchapiConfigured(integrationEnv),
      search: (p) => searchapi.searchGoogleMaps(p),
    },
    {
      id: 'serpapi',
      label: 'SerpAPI',
      configured: () => serpapiConfigured(integrationEnv),
      search: (p) => serpapi.searchGoogleMaps(p),
    },
    {
      id: 'oxylabs',
      label: 'Oxylabs',
      configured: () => oxylabsConfigured(integrationEnv),
      search: (p) => oxylabsGoogleLocal.searchGoogleMaps(p),
    },
    {
      id: 'outscraper',
      label: 'Outscraper',
      configured: () => outscraper.isConfigured(integrationEnv),
      search: (p) => outscraper.searchGoogleMaps(p),
    },
    {
      id: 'apify',
      label: 'Apify',
      configured: () => apifyConfigured(integrationEnv),
      search: (p) => apify.searchGoogleMaps(p),
    },
  ];
}

/** RapidAPI → Outscraper only. */
async function runRapidapiOutscraperMapsSearch(params, integrationEnv) {
  const providers = preferredProviders(integrationEnv);
  if (!providers.some((p) => p.configured())) {
    throw new Error(
      'Maps search needs RapidAPI or Outscraper. Add RAPIDAPI_KEY and/or OUTSCRAPER_API_KEY under Workspace → Integrations.',
    );
  }
  return runProviderChain(params, integrationEnv, providers, { continueOnNoResults: true });
}

/** Auto: RapidAPI → SearchAPI → SerpAPI → Oxylabs → Outscraper → Apify. */
async function runAutoMapsSearch(params, integrationEnv) {
  const providers = autoProviders(integrationEnv);
  if (!providers.some((p) => p.configured())) {
    throw new Error(
      'Maps search needs at least one provider key. Add RapidAPI, SearchAPI, SerpAPI, Oxylabs, Outscraper, or Apify under Workspace → Integrations.',
    );
  }
  return runProviderChain(params, integrationEnv, providers, { continueOnNoResults: true });
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string>, mapsProvider?: string }} params
 * @returns {Promise<object[]>} same shape as apify.searchGoogleMaps
 */
async function searchGoogleMaps(params) {
  const integrationEnv = params.integrationEnv || null;
  const override = String(params.mapsProvider || '').toLowerCase().trim();
  // Honor explicit mapsProvider (including "auto"). Only fall back to workspace primary when unset.
  let primary = override || resolvePrimary(integrationEnv);
  if (primary === 'monid') primary = 'auto';

  if (primary === 'auto') {
    return runAutoMapsSearch(params, integrationEnv);
  }

  if (primary === 'rapidapi') {
    return runRapidapiOutscraperMapsSearch(params, integrationEnv);
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
      label: 'RapidAPI (Auto #1)',
      configured: rapidapi.isConfigured(integrationEnv),
    },
    {
      id: 'searchapi',
      label: 'SearchAPI.io (Auto #2)',
      configured: searchapiConfigured(integrationEnv),
    },
    {
      id: 'serpapi',
      label: 'SerpAPI (Auto #3)',
      configured: serpapiConfigured(integrationEnv),
    },
    {
      id: 'oxylabs',
      label: 'Oxylabs (Auto #4)',
      configured: oxylabsConfigured(integrationEnv),
    },
    {
      id: 'outscraper',
      label: 'Outscraper (Auto #5)',
      configured: outscraper.isConfigured(integrationEnv),
    },
    {
      id: 'apify',
      label: 'Apify (Auto #6)',
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
  runRapidapiOutscraperMapsSearch,
  runAutoMapsSearch,
};
