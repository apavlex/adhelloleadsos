/**
 * Step 1 — Google Maps lead list: prefer Outscraper when configured (often cheaper),
 * fall back to existing Apify actor on empty / errors / Apify-only preference.
 */

const apify = require('./apify');
const outscraper = require('./outscraperClient');

function apifyConfigured(integrationEnv) {
  const t = (integrationEnv && integrationEnv.APIFY_API_TOKEN) || process.env.APIFY_API_TOKEN;
  return Boolean(String(t || '').trim());
}

function isMapsSearchConfigured(integrationEnv) {
  return outscraper.isConfigured(integrationEnv) || apifyConfigured(integrationEnv);
}

/**
 * SEARCH_MAPS_PRIMARY=apify — skip Outscraper, use Apify only.
 * Otherwise: if OUTSCRAPER_API_KEY is set, try Outscraper first, then Apify when needed.
 * @param {Record<string, string>|null|undefined} [integrationEnv]
 */
function tryOutscraperFirst(integrationEnv) {
  const v = String(process.env.SEARCH_MAPS_PRIMARY || '').toLowerCase().trim();
  if (v === 'apify') return false;
  return outscraper.isConfigured(integrationEnv);
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>} same shape as apify.searchGoogleMaps
 */
async function searchGoogleMaps(params) {
  const integrationEnv = params.integrationEnv || null;
  if (tryOutscraperFirst(integrationEnv)) {
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
      'No Maps search provider available: set APIFY_API_TOKEN (workspace or environment), or fix Outscraper.'
    );
  }

  return apify.searchGoogleMaps(params);
}

module.exports = {
  searchGoogleMaps,
  isMapsSearchConfigured,
  tryOutscraperFirst,
};
