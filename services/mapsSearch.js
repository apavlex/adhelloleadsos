/**
 * Step 1 — Google Maps lead list:
 * default auto order is RapidAPI Local Business Data -> Outscraper -> Apify.
 */

const apify = require('./apify');
const outscraper = require('./outscraperClient');
const rapidapi = require('./rapidapiLocalBusiness');

function apifyConfigured(integrationEnv) {
  const t = (integrationEnv && integrationEnv.APIFY_API_TOKEN) || process.env.APIFY_API_TOKEN;
  return Boolean(String(t || '').trim());
}

function isMapsSearchConfigured(integrationEnv) {
  return rapidapi.isConfigured(integrationEnv) || outscraper.isConfigured(integrationEnv) || apifyConfigured(integrationEnv);
}

function resolvePrimary(integrationEnv) {
  const fromWs = String((integrationEnv && integrationEnv.SEARCH_MAPS_PRIMARY) || '').toLowerCase().trim();
  const fromEnv = String(process.env.SEARCH_MAPS_PRIMARY || '').toLowerCase().trim();
  const v = fromWs || fromEnv;
  if (v === 'rapidapi' || v === 'apify' || v === 'outscraper') return v;
  return 'auto';
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>} same shape as apify.searchGoogleMaps
 */
async function searchGoogleMaps(params) {
  const integrationEnv = params.integrationEnv || null;
  const primary = resolvePrimary(integrationEnv);

  if (primary === 'rapidapi') {
    if (!rapidapi.isConfigured(integrationEnv)) {
      throw new Error('Maps provider is set to RapidAPI, but RAPIDAPI_KEY is missing.');
    }
    return rapidapi.searchGoogleMaps(params);
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

  if (rapidapi.isConfigured(integrationEnv)) {
    try {
      const rows = await rapidapi.searchGoogleMaps(params);
      if (rows && rows.length > 0) {
        return rows;
      }
      console.warn('[mapsSearch] RapidAPI returned 0 places; falling back to Outscraper/Apify.');
    } catch (e) {
      console.warn('[mapsSearch] RapidAPI failed, falling back to Outscraper/Apify:', e.message);
    }
  }

  if (outscraper.isConfigured(integrationEnv)) {
    try {
      const rows = await outscraper.searchGoogleMaps(params);
      if (rows && rows.length > 0) {
        return rows;
      }
      console.warn('[mapsSearch] Outscraper returned 0 places; falling back to Apify.');
    } catch (e) {
      console.warn('[mapsSearch] Outscraper failed, falling back to Apify:', e.message);
    }
  }

  if (!apifyConfigured(integrationEnv)) {
    throw new Error(
      'No Maps search provider available: set RAPIDAPI_KEY, OUTSCRAPER_API_KEY, or APIFY_API_TOKEN.'
    );
  }

  return apify.searchGoogleMaps(params);
}

module.exports = {
  searchGoogleMaps,
  isMapsSearchConfigured,
  resolvePrimary,
};
