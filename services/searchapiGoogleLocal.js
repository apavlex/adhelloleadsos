/**
 * SearchAPI.io — Google Local engine (local pack / local finder).
 * https://www.searchapi.io/docs/google-local-api
 */

const SEARCHAPI_SEARCH_URL = 'https://www.searchapi.io/api/v1/search';
const { sanitizeLeadCategoryName } = require('./leadCategory');

function apiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.SEARCHAPI_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.SEARCHAPI_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKey(integrationEnv));
}

function mapsListingUrlFromResult(r) {
  const dir = r && r.direction;
  if (typeof dir === 'string' && /^https?:\/\//i.test(dir)) {
    try {
      const u = new URL(dir);
      return `${u.origin}${u.pathname}${u.search}`;
    } catch {
      return dir.split('#')[0];
    }
  }
  const pid = r && r.place_id;
  if (typeof pid === 'string' && pid.trim()) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(pid.trim())}`;
  }
  const gps = r && r.gps_coordinates;
  if (gps && gps.latitude != null && gps.longitude != null) {
    const lat = Number(gps.latitude);
    const lng = Number(gps.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    }
  }
  return '';
}

function normalizeLocalResult(r, ctx) {
  const city = String((ctx && ctx.city) || '').trim();
  const state = String((ctx && ctx.state) || '').trim();
  const addr = String((r && r.address) || '').trim();
  const reviewsRaw = r && r.reviews != null ? r.reviews : 0;
  const reviewsCount =
    typeof reviewsRaw === 'number'
      ? Math.round(reviewsRaw)
      : parseInt(String(reviewsRaw), 10) || 0;

  const listingUrl = mapsListingUrlFromResult(r);
  let website = String((r && r.website) || '').trim();
  if (website && !/^https?:\/\//i.test(website)) website = '';

  const rating = r && r.rating != null ? Number(r.rating) : 0;
  const title = String((r && r.title) || 'N/A').trim() || 'N/A';

  return {
    title,
    phone: String((r && r.phone) || '').trim() || 'N/A',
    website: website || 'N/A',
    email: 'N/A',
    categoryName: sanitizeLeadCategoryName(String((r && r.type) || '').trim(), title, 'N/A'),
    address: addr || 'N/A',
    city,
    state,
    postalCode: '',
    totalScore: Number.isFinite(rating) ? rating : 0,
    reviewsCount,
    url: listingUrl || website || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
  };
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>} same shape as Apify searchGoogleMaps
 */
async function searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
  const key = apiKey(integrationEnv);
  if (!key) throw new Error('SEARCHAPI_API_KEY is not set (workspace integrations or environment).');

  const kw = String(keyword || '').trim();
  const c = String(city || '').trim();
  const st = String(state || '').trim();
  if (!kw || !c || !st) throw new Error('keyword, city, and state are required');

  const max = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const perPage = 20;
  const pagesNeeded = Math.ceil(max / perPage);
  const { buildLocationLabel, buildMapsSearchQuery, countryForState } = require('./geocodeLocation');
  const locationParam = buildLocationLabel(c, st);
  const q = buildMapsSearchQuery(kw, c, st);
  const gl = countryForState(st) === 'Canada' ? 'ca' : 'us';

  const out = [];
  for (let page = 1; page <= pagesNeeded && out.length < max; page++) {
    const params = new URLSearchParams({
      engine: 'google_local',
      q,
      api_key: key,
      location: locationParam,
      hl: 'en',
      gl,
      page: String(page),
    });

    const url = `${SEARCHAPI_SEARCH_URL}?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`SearchAPI returned non-JSON (${res.status})`);
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message || data.detail)) || text.slice(0, 280);
      throw new Error(`SearchAPI ${res.status}: ${msg}`);
    }

    const meta = data.search_metadata;
    if (meta && meta.status && String(meta.status).toLowerCase() !== 'success') {
      throw new Error(`SearchAPI status: ${meta.status}`);
    }

    const local = Array.isArray(data.local_results) ? data.local_results : [];
    for (const item of local) {
      out.push(normalizeLocalResult(item, { city: c, state: st }));
      if (out.length >= max) break;
    }

    if (local.length < perPage) break;
  }

  console.log(`[searchapiGoogleLocal] Retrieved ${out.length} results (requested max ${max}).`);
  return out.slice(0, max);
}

module.exports = {
  isConfigured,
  searchGoogleMaps,
  mapsListingUrlFromResult,
};
