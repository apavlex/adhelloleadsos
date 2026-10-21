/**
 * Step 1 — Google Maps lead list.
 * Default / Auto: configured primary API → Outscraper fallback.
 * Primary defaults to RapidAPI (Local Business). Override via SEARCH_MAPS_PRIMARY / mapsProvider.
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
  // Monid Maps retired — treat legacy preference as RapidAPI (+ Outscraper fallback).
  if (v === 'monid' || v === 'auto') v = 'rapidapi';
  if (
    v === 'rapidapi' ||
    v === 'searchapi' ||
    v === 'serpapi' ||
    v === 'apify' ||
    v === 'outscraper' ||
    v === 'oxylabs'
  )
    return v;
  return 'rapidapi';
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
    `No Maps search results found for "${params.keyword}" in ${params.city}, ${params.state}. Providers: ${JSON.stringify(providerStatus)}. Env keys: ${JSON.stringify(envStatus)}. Configure your primary Maps API and/or Outscraper under Workspace → Integrations.`,
  );
}

function providerEntry(id, integrationEnv) {
  switch (id) {
    case 'rapidapi':
      return {
        id: 'rapidapi',
        label: 'RapidAPI',
        configured: () => rapidapi.isConfigured(integrationEnv),
        search: (p) => rapidapi.searchGoogleMaps(p),
      };
    case 'searchapi':
      return {
        id: 'searchapi',
        label: 'SearchAPI.io',
        configured: () => searchapiConfigured(integrationEnv),
        search: (p) => searchapi.searchGoogleMaps(p),
      };
    case 'serpapi':
      return {
        id: 'serpapi',
        label: 'SerpAPI',
        configured: () => serpapiConfigured(integrationEnv),
        search: (p) => serpapi.searchGoogleMaps(p),
      };
    case 'oxylabs':
      return {
        id: 'oxylabs',
        label: 'Oxylabs',
        configured: () => oxylabsConfigured(integrationEnv),
        search: (p) => oxylabsGoogleLocal.searchGoogleMaps(p),
      };
    case 'outscraper':
      return {
        id: 'outscraper',
        label: 'Outscraper',
        configured: () => outscraper.isConfigured(integrationEnv),
        search: (p) => outscraper.searchGoogleMaps(p),
      };
    case 'apify':
      return {
        id: 'apify',
        label: 'Apify',
        configured: () => apifyConfigured(integrationEnv),
        search: (p) => apify.searchGoogleMaps(p),
      };
    default:
      return null;
  }
}

/**
 * Primary API platform, then Outscraper fallback (unless primary is already Outscraper).
 * Used by Auto / default automated folder search.
 */
function primaryThenOutscraperProviders(primaryId, integrationEnv) {
  const primary = providerEntry(primaryId, integrationEnv);
  const fallback = providerEntry('outscraper', integrationEnv);
  if (!primary) return [fallback].filter(Boolean);
  if (primaryId === 'outscraper') return [primary];
  return [primary, fallback];
}

/** @deprecated name kept for callers — RapidAPI → Outscraper. */
async function runRapidapiOutscraperMapsSearch(params, integrationEnv) {
  return runPrimaryThenOutscraperMapsSearch(params, integrationEnv, 'rapidapi');
}

/**
 * Run configured primary Maps API, then Outscraper if primary fails / returns short.
 */
async function runPrimaryThenOutscraperMapsSearch(params, integrationEnv, primaryId) {
  const primary = String(primaryId || 'rapidapi').toLowerCase().trim() || 'rapidapi';
  const providers = primaryThenOutscraperProviders(primary, integrationEnv);
  if (!providers.some((p) => p.configured())) {
    const label = primary === 'rapidapi' ? 'RapidAPI' : primary;
    throw new Error(
      `Maps search needs ${label} and/or Outscraper. Add the primary API key and/or OUTSCRAPER_API_KEY under Workspace → Integrations.`,
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

  // Auto / unset → workspace primary (default RapidAPI) → Outscraper.
  if (!override || override === 'auto' || override === 'monid') {
    const primary = resolvePrimary(integrationEnv);
    return runPrimaryThenOutscraperMapsSearch(params, integrationEnv, primary);
  }

  // Explicit rapidapi mode: same short chain.
  if (override === 'rapidapi') {
    return runPrimaryThenOutscraperMapsSearch(params, integrationEnv, 'rapidapi');
  }

  // Forced single provider (no Outscraper fallback).
  if (override === 'searchapi') {
    if (!searchapiConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to SearchAPI.io, but SEARCHAPI_API_KEY is missing.');
    }
    return searchapi.searchGoogleMaps(params);
  }

  if (override === 'serpapi') {
    if (!serpapiConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to SerpAPI, but SERPAPI_API_KEY is missing.');
    }
    return serpapi.searchGoogleMaps(params);
  }

  if (override === 'apify') {
    if (!apifyConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Apify, but APIFY_API_TOKEN is missing.');
    }
    return apify.searchGoogleMaps(params);
  }

  if (override === 'outscraper') {
    if (!outscraper.isConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Outscraper, but OUTSCRAPER_API_KEY is missing.');
    }
    return outscraper.searchGoogleMaps(params);
  }

  if (override === 'oxylabs') {
    if (!oxylabsConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to Oxylabs, but OXYLABS_USERNAME / OXYLABS_PASSWORD are missing.');
    }
    return oxylabsGoogleLocal.searchGoogleMaps(params);
  }

  const primary = resolvePrimary(integrationEnv);
  return runPrimaryThenOutscraperMapsSearch(params, integrationEnv, primary);
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

/** Status row for Workspace → Integrations (primary then Outscraper first). */
function getMapsProviderStatusList(integrationEnv) {
  return [
    {
      id: 'rapidapi',
      label: 'RapidAPI (primary)',
      configured: rapidapi.isConfigured(integrationEnv),
    },
    {
      id: 'outscraper',
      label: 'Outscraper (fallback)',
      configured: outscraper.isConfigured(integrationEnv),
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
  runRapidapiOutscraperMapsSearch,
  runPrimaryThenOutscraperMapsSearch,
};
