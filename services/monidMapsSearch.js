/**
 * Google Maps business search via Monid (Apify /damilo/google-maps-scraper).
 * Lets workspaces run Find leads with only a Monid API key configured.
 */

const monid = require('./monidClient');
const { sanitizeLeadCategoryName } = require('./leadCategory');
const { buildLocationLabel } = require('./geocodeLocation');

const MONID_GMAPS = { provider: 'apify', endpoint: '/damilo/google-maps-scraper' };

function isConfigured(integrationEnv) {
  return monid.isConfigured(integrationEnv);
}

function extractOutputRows(output) {
  if (Array.isArray(output)) return output;
  if (output && Array.isArray(output.results)) return output.results;
  if (output && Array.isArray(output.items)) return output.items;
  if (output && Array.isArray(output.data)) return output.data;
  return [];
}

/**
 * @param {object} item — raw Apify / Monid place row
 * @param {string} [city]
 * @param {string} [state]
 */
function normalizeItem(item, city, state) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || item.name || '').trim();
  if (!title) return null;

  const placeId = String(item.placeId || item.place_id || '').trim();
  const url =
    String(item.url || item.link || '').trim() ||
    (placeId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}` : '');

  return {
    title,
    phone: String(item.phoneNumber || item.phone || '').trim() || 'N/A',
    website: String(item.website || '').trim() || 'N/A',
    email: String(item.email || item.contactEmail || '').trim() || 'N/A',
    categoryName: sanitizeLeadCategoryName(
      String(item.type || item.categoryName || '').trim() ||
        (Array.isArray(item.types) && item.types[0] ? String(item.types[0]).trim() : ''),
      title,
      'N/A',
    ),
    address: String(item.address || '').trim() || 'N/A',
    city: String(city || item.city || '').trim(),
    state: String(state || item.state || '').trim(),
    postalCode: String(item.postalCode || item.zip || '').trim(),
    totalScore: Number(item.rating ?? item.totalScore ?? 0) || 0,
    reviewsCount: Number(item.ratingCount ?? item.reviewsCount ?? 0) || 0,
    url,
    placeId,
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
  };
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 */
async function searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Monid API key is not configured (Workspace → Integrations → Monid).');
  }

  const cap = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const query = String(keyword || '').trim();
  const location = buildLocationLabel(city, state);
  if (!query || !location) {
    throw new Error('Monid Maps search requires keyword, city, and state.');
  }

  console.log(`[Monid Maps] Searching "${query}" in "${location}" (max ${cap})...`);

  const run = await monid.runEndpoint({
    ...MONID_GMAPS,
    input: {
      query,
      location,
      max_results: cap,
      language: 'en',
    },
    integrationEnv,
    maxWaitMs: 120_000,
  });

  const rows = extractOutputRows(run.output)
    .map((item) => normalizeItem(item, city, state))
    .filter(Boolean);

  if (!rows.length) {
    throw new Error(
      `Monid Google Maps returned no businesses for "${query}" in ${location}. Try a broader keyword or different area.`,
    );
  }

  return rows.slice(0, cap);
}

module.exports = {
  isConfigured,
  searchGoogleMaps,
  normalizeItem,
  extractOutputRows,
  MONID_GMAPS,
};
