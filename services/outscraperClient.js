/**
 * Optional Outscraper (outscraper.cloud) API helper.
 * Does not replace Apify — use to compare unit pricing or run parallel experiments.
 * @see https://outscraper.com/
 */

const { buildMapsSearchQuery } = require('./geocodeLocation');
const { sanitizeLeadCategoryName } = require('./leadCategory'); = 'https://api.app.outscraper.com';
const DEFAULT_TIMEOUT_MS = 8000;
const MAPS_INIT_TIMEOUT_MS = Math.max(15000, parseInt(process.env.OUTSCRAPER_MAPS_INIT_TIMEOUT_MS || '60000', 10) || 60000);
const MAPS_POLL_MS = Math.max(2000, parseInt(process.env.OUTSCRAPER_MAPS_POLL_MS || '4000', 10) || 4000);
const MAPS_MAX_WAIT_MS = Math.max(60000, parseInt(process.env.OUTSCRAPER_MAPS_MAX_WAIT_MS || '360000', 10) || 360000);

/** @param {Record<string, string>|null|undefined} [integrationEnv] resolved workspace + env */
function apiBase(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.OUTSCRAPER_API_BASE;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim().replace(/\/$/, '');
  return (process.env.OUTSCRAPER_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

function apiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.OUTSCRAPER_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.OUTSCRAPER_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKey(integrationEnv));
}

/**
 * Best-effort account / balance ping (endpoint may vary; failures are non-fatal).
 * @param {Record<string, string>|null|undefined} [integrationEnv]
 */
async function pingHealth(integrationEnv) {
  const key = apiKey(integrationEnv);
  if (!key) {
    return { ok: false, configured: false, message: 'Not configured (set OUTSCRAPER_API_KEY).' };
  }
  const base = apiBase(integrationEnv);
  const candidates = ['/profile', '/account', '/balance'];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    for (const p of candidates) {
      const r = await fetch(`${base}${p}`, {
        method: 'GET',
        headers: {
          'X-API-KEY': key,
          Accept: 'application/json,*/*',
        },
        signal: ctrl.signal,
      });
      if (r.ok) {
        return { ok: true, configured: true, message: `Reachable at ${base}${p}` };
      }
    }
    return {
      ok: false,
      configured: true,
      message: 'API key set but profile endpoint did not return OK (check OUTSCRAPER_API_BASE or key scopes).',
    };
  } catch (e) {
    return { ok: false, configured: true, message: e.name === 'AbortError' ? 'Timed out reaching Outscraper.' : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Outscraper returns one array per query, or a flat list when dropDuplicates is used.
 * @param {unknown} data
 * @returns {object[]}
 */
function flattenOutscraperPlaces(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (Array.isArray(data[0])) {
    const out = [];
    for (const group of data) {
      if (!Array.isArray(group)) continue;
      for (const row of group) {
        if (row && typeof row === 'object') out.push(row);
      }
    }
    return out;
  }
  return data.filter((x) => x && typeof x === 'object');
}

/**
 * Match the shape returned by {@link ../services/apify.searchGoogleMaps} for enricher + UI.
 * @param {object} item
 */
function normalizeMapsPlace(item) {
  const title = item.name || item.title || 'N/A';
  const site = item.site || item.website || '';
  const cat = item.category || item.type || (typeof item.subtypes === 'string' ? item.subtypes.split(',')[0] : '') || 'N/A';
  const placeId = item.place_id || item.placeId || item.google_id || item.googleId || '';
  return {
    title,
    phone: item.phone || 'N/A',
    website: site ? String(site).trim() : 'N/A',
    email: item.email || item.contact_email || item.contactEmail || 'N/A',
    categoryName: sanitizeLeadCategoryName(cat, title, 'N/A'),
    address: item.full_address || item.address || 'N/A',
    city: item.city || '',
    state: item.state || item.us_state || '',
    postalCode: item.postal_code || item.postalCode || '',
    totalScore: item.rating != null ? item.rating : item.totalScore != null ? item.totalScore : 0,
    reviewsCount: item.reviews != null ? item.reviews : item.reviewsCount != null ? item.reviewsCount : 0,
    url: item.location_link || item.google_url || item.url || item.link || '',
    placeId: placeId ? String(placeId).trim() : '',
    facebook: item.facebook || 'N/A',
    instagram: item.instagram || 'N/A',
    twitter: item.twitter || item.twitter_url || 'N/A',
  };
}

/**
 * Flatten Outscraper reviews response (place row + reviews_data array).
 * @param {unknown} data
 * @returns {{ place: object|null, reviews: object[] }}
 */
function flattenOutscraperReviewsPayload(data) {
  if (!Array.isArray(data) || !data.length) return { place: null, reviews: [] };
  let place = null;
  const reviews = [];
  const rows = Array.isArray(data[0]) ? data.flat() : data;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!place && (row.name || row.title || row.rating != null || row.reviews != null)) {
      place = row;
    }
    const nested = row.reviews_data || row.reviewsData || row.reviews_list;
    if (Array.isArray(nested)) {
      for (const rev of nested) {
        if (rev && typeof rev === 'object') reviews.push(rev);
      }
    }
    if (row.review_text || row.reviewText || row.text) {
      reviews.push(row);
    }
  }
  return { place, reviews };
}

async function outscraperFetchJson(url, { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS, integrationEnv } = {}) {
  const key = apiKey(integrationEnv);
  if (!key) throw new Error('OUTSCRAPER_API_KEY is not set');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'X-API-KEY': key, Accept: 'application/json,*/*' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: r.ok, status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Poll Outscraper request URL until Success / Failure / timeout.
 * @param {string} resultsUrl
 * @returns {Promise<object[]>} normalized lead rows
 */
async function pollMapsRequest(resultsUrl, integrationEnv) {
  const deadline = Date.now() + MAPS_MAX_WAIT_MS;
  let first = true;
  while (Date.now() < deadline) {
    if (!first) await sleep(MAPS_POLL_MS);
    first = false;
    const { ok, status, json } = await outscraperFetchJson(resultsUrl, {
      timeoutMs: MAPS_INIT_TIMEOUT_MS,
      integrationEnv,
    });
    if (status === 204 || (json && json.status === 'Failure')) {
      const msg = json?.errorMessage || json?.message || 'Outscraper maps task failed';
      throw new Error(msg);
    }
    if (!ok || !json) continue;
    if (json.status === 'Success' && json.data) {
      const flat = flattenOutscraperPlaces(json.data);
      return flat.map(normalizeMapsPlace);
    }
    if (json.status === 'Pending' || json.status === 'Processing') {
      continue;
    }
    if (json.error) {
      throw new Error(json.errorMessage || json.message || 'Outscraper error');
    }
  }
  throw new Error('Outscraper maps search timed out waiting for results');
}

/**
 * Google Maps business search via Outscraper (GET /google-maps-search, async + poll).
 * @param {{ keyword: string, city: string, state: string, maxResults?: number }} params
 * @returns {Promise<object[]>} same shape as apify.searchGoogleMaps
 */
async function searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Outscraper is not configured (set OUTSCRAPER_API_KEY).');
  }
  const limit = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const { buildMapsSearchQuery } = require('./geocodeLocation');
  const query = buildMapsSearchQuery(keyword, city, state);
  const syncMode = ['1', 'true', 'yes'].includes(String(process.env.OUTSCRAPER_MAPS_SYNC || '').toLowerCase().trim());
  const useAsync = !syncMode;

  const u = new URL(`${apiBase(integrationEnv)}/google-maps-search`);
  u.searchParams.set('query', query);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('language', 'en');
  u.searchParams.set('region', 'US');
  u.searchParams.set('async', useAsync ? 'true' : 'false');

  console.log(`[Outscraper] Google Maps search: "${query}" (limit=${limit}, async=${useAsync})`);

  const initTimeout = useAsync ? MAPS_INIT_TIMEOUT_MS : Math.max(MAPS_INIT_TIMEOUT_MS, 180000);
  const { ok, status, json } = await outscraperFetchJson(u.toString(), {
    timeoutMs: initTimeout,
    integrationEnv,
  });

  if (!ok) {
    const msg = json?.errorMessage || json?.message || `HTTP ${status}`;
    throw new Error(`Outscraper maps: ${msg}`);
  }

  if (json?.status === 'Success') {
    if (!json.data) return [];
    const rows = flattenOutscraperPlaces(json.data).map(normalizeMapsPlace);
    console.log(`[Outscraper] Maps returned ${rows.length} places (${useAsync ? 'immediate' : 'sync'}).`);
    return rows;
  }

  if (json?.status === 'Failure') {
    throw new Error(json.errorMessage || json.message || 'Outscraper maps task failed');
  }

  if (useAsync && json?.id) {
    let pollUrl = json.results_location;
    if (pollUrl && !String(pollUrl).startsWith('http')) {
      pollUrl = `${apiBase(integrationEnv)}${String(pollUrl).startsWith('/') ? '' : '/'}${pollUrl}`;
    }
    if (!pollUrl) {
      pollUrl = `${apiBase(integrationEnv)}/requests/${json.id}`;
    }
    const rows = await pollMapsRequest(pollUrl, integrationEnv);
    console.log(`[Outscraper] Maps returned ${rows.length} places (async).`);
    return rows;
  }

  if (json?.error) {
    throw new Error(json.errorMessage || json.message || 'Outscraper maps error');
  }

  throw new Error(json?.errorMessage || `Unexpected Outscraper response (status=${status})`);
}

/**
 * Google Maps reviews via Outscraper (GET /maps/reviews-v2, async + poll).
 * @param {{ query: string, reviewsLimit?: number, sort?: string, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<{ reviews: object[], placeRating: number|null, placeReviewsCount: number|null }>}
 */
async function fetchGoogleMapsReviews({ query, reviewsLimit, sort, integrationEnv }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Outscraper is not configured (set OUTSCRAPER_API_KEY).');
  }
  const q = String(query || '').trim();
  if (!q) throw new Error('Review query is required (place_id, Maps URL, or business name).');

  const limit = Math.min(100, Math.max(5, parseInt(reviewsLimit, 10) || 25));
  const syncMode = ['1', 'true', 'yes'].includes(String(process.env.OUTSCRAPER_REVIEWS_SYNC || '').toLowerCase().trim());
  const useAsync = !syncMode;
  const sortVal = sort || 'newest';

  const u = new URL(`${apiBase(integrationEnv)}/maps/reviews-v2`);
  u.searchParams.set('query', q);
  u.searchParams.set('reviewsLimit', String(limit));
  u.searchParams.set('limit', '1');
  u.searchParams.set('sort', sortVal);
  u.searchParams.set('language', 'en');
  u.searchParams.set('region', 'US');
  u.searchParams.set('ignoreEmpty', 'true');
  u.searchParams.set('async', useAsync ? 'true' : 'false');

  console.log(`[Outscraper] Google Maps reviews: "${q.slice(0, 80)}" (limit=${limit}, async=${useAsync})`);

  const initTimeout = useAsync ? MAPS_INIT_TIMEOUT_MS : Math.max(MAPS_INIT_TIMEOUT_MS, 120000);
  const { ok, status, json } = await outscraperFetchJson(u.toString(), {
    timeoutMs: initTimeout,
    integrationEnv,
  });

  if (!ok) {
    const msg = json?.errorMessage || json?.message || `HTTP ${status}`;
    throw new Error(`Outscraper reviews: ${msg}`);
  }

  let payload = json;
  if (payload?.status === 'Failure') {
    throw new Error(payload.errorMessage || payload.message || 'Outscraper reviews task failed');
  }

  if (useAsync && payload?.id && payload?.status !== 'Success') {
    let pollUrl = payload.results_location;
    if (pollUrl && !String(pollUrl).startsWith('http')) {
      pollUrl = `${apiBase(integrationEnv)}${String(pollUrl).startsWith('/') ? '' : '/'}${pollUrl}`;
    }
    if (!pollUrl) pollUrl = `${apiBase(integrationEnv)}/requests/${payload.id}`;
    const deadline = Date.now() + MAPS_MAX_WAIT_MS;
    let first = true;
    while (Date.now() < deadline) {
      if (!first) await sleep(MAPS_POLL_MS);
      first = false;
      const polled = await outscraperFetchJson(pollUrl, {
        timeoutMs: MAPS_INIT_TIMEOUT_MS,
        integrationEnv,
      });
      if (polled.status === 204 || (polled.json && polled.json.status === 'Failure')) {
        throw new Error(polled.json?.errorMessage || polled.json?.message || 'Outscraper reviews failed');
      }
      if (polled.json?.status === 'Success' && polled.json.data) {
        payload = polled.json;
        break;
      }
    }
    if (payload?.status !== 'Success' || !payload.data) {
      throw new Error('Outscraper reviews timed out waiting for results');
    }
  }

  if (payload?.status !== 'Success' || !payload.data) {
    throw new Error(payload?.errorMessage || 'Unexpected Outscraper reviews response');
  }

  const { place, reviews } = flattenOutscraperReviewsPayload(payload.data);
  const placeRating =
    place && place.rating != null ? Number(place.rating)
    : place && place.totalScore != null ? Number(place.totalScore)
    : null;
  const placeReviewsCount =
    place && place.reviews != null ? parseInt(place.reviews, 10)
    : place && place.reviewsCount != null ? parseInt(place.reviewsCount, 10)
    : null;

  console.log(`[Outscraper] Reviews returned ${reviews.length} rows for query.`);
  return {
    reviews,
    placeRating: Number.isFinite(placeRating) ? placeRating : null,
    placeReviewsCount: Number.isFinite(placeReviewsCount) ? placeReviewsCount : null,
  };
}

module.exports = {
  isConfigured,
  pingHealth,
  apiBase,
  apiKey,
  searchGoogleMaps,
  fetchGoogleMapsReviews,
  flattenOutscraperReviewsPayload,
  normalizeMapsPlace,
};
