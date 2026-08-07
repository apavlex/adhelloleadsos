/**
 * Optional Outscraper (outscraper.cloud) API helper.
 * Does not replace Apify — use to compare unit pricing or run parallel experiments.
 * @see https://outscraper.com/
 */

const { buildMapsSearchQuery } = require('./geocodeLocation');
const { sanitizeLeadCategoryName } = require('./leadCategory');

const DEFAULT_BASE = 'https://api.app.outscraper.com';
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

const CONTACTS_MAX_WAIT_MS = Math.max(
  15000,
  parseInt(process.env.OUTSCRAPER_CONTACTS_MAX_WAIT_MS || '90000', 10) || 90000,
);

/**
 * Poll any Outscraper async task until Success / Failure / timeout.
 */
async function pollOutscraperTask(resultsUrl, opts) {
  opts = opts || {};
  const integrationEnv = opts.integrationEnv || null;
  const deadline = Date.now() + (opts.maxWaitMs || MAPS_MAX_WAIT_MS);
  let first = true;
  while (Date.now() < deadline) {
    if (!first) await sleep(MAPS_POLL_MS);
    first = false;
    const { ok, status, json } = await outscraperFetchJson(resultsUrl, {
      timeoutMs: MAPS_INIT_TIMEOUT_MS,
      integrationEnv,
    });
    if (status === 204 || (json && json.status === 'Failure')) {
      const msg = json?.errorMessage || json?.message || `${opts.label || 'Outscraper'} task failed`;
      throw new Error(msg);
    }
    if (!ok || !json) continue;
    if (json.status === 'Success') return json.data;
    if (json.status === 'Pending' || json.status === 'Processing') continue;
    if (json.error) throw new Error(json.errorMessage || json.message || 'Outscraper error');
  }
  throw new Error(`${opts.label || 'Outscraper'} task timed out`);
}

function flattenContactsAndLeadsPayload(data) {
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0];
  return row && typeof row === 'object' ? row : null;
}

/**
 * Outscraper Contacts & Leads — emails, phones, socials, decision makers from domain.
 */
async function fetchContactsAndLeads({ query, integrationEnv, contactsPerCompany, emailsPerContact }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Outscraper is not configured (set OUTSCRAPER_API_KEY).');
  }
  const q = String(query || '').trim();
  if (!q) throw new Error('Domain query is required for contacts-and-leads.');

  const syncMode = ['1', 'true', 'yes'].includes(
    String(process.env.OUTSCRAPER_CONTACTS_SYNC || '').toLowerCase().trim(),
  );
  const useAsync = !syncMode;
  const perCo = Math.min(10, Math.max(1, parseInt(contactsPerCompany, 10) || 3));
  const perEmail = Math.min(5, Math.max(1, parseInt(emailsPerContact, 10) || 2));

  const u = new URL(`${apiBase(integrationEnv)}/contacts-and-leads`);
  u.searchParams.set('query', q);
  u.searchParams.set('contactsPerCompany', String(perCo));
  u.searchParams.set('emailsPerContact', String(perEmail));
  u.searchParams.set('async', useAsync ? 'true' : 'false');

  console.log(`[Outscraper] Contacts & leads: "${q}" (async=${useAsync})`);

  const initTimeout = useAsync ? MAPS_INIT_TIMEOUT_MS : Math.max(MAPS_INIT_TIMEOUT_MS, 120000);
  const { ok, status, json } = await outscraperFetchJson(u.toString(), {
    timeoutMs: initTimeout,
    integrationEnv,
  });

  if (!ok) {
    const msg = json?.errorMessage || json?.message || `HTTP ${status}`;
    throw new Error(`Outscraper contacts: ${msg}`);
  }

  if (json?.status === 'Success' && json.data) {
    return flattenContactsAndLeadsPayload(json.data);
  }
  if (json?.status === 'Failure') {
    throw new Error(json.errorMessage || json.message || 'Outscraper contacts task failed');
  }

  if (useAsync && json?.id) {
    let pollUrl = json.results_location;
    if (pollUrl && !String(pollUrl).startsWith('http')) {
      pollUrl = `${apiBase(integrationEnv)}${String(pollUrl).startsWith('/') ? '' : '/'}${pollUrl}`;
    }
    if (!pollUrl) pollUrl = `${apiBase(integrationEnv)}/requests/${json.id}`;
    const data = await pollOutscraperTask(pollUrl, {
      integrationEnv,
      maxWaitMs: CONTACTS_MAX_WAIT_MS,
      label: 'Outscraper contacts',
    });
    return flattenContactsAndLeadsPayload(data);
  }

  if (json?.error) throw new Error(json.errorMessage || json.message || 'Outscraper contacts error');
  throw new Error(json?.errorMessage || `Unexpected Outscraper contacts response (status=${status})`);
}

const DIRECTORY_MAX_WAIT_MS = Math.max(
  15000,
  parseInt(process.env.OUTSCRAPER_DIRECTORY_MAX_WAIT_MS || '120000', 10) || 120000,
);

function slugifySegment(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildYelpSearchUrl(keyword, city, state) {
  return `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(`${city}, ${state}`)}`;
}

function buildAngiSearchUrl(keyword, city, state) {
  const kw = slugifySegment(keyword) || 'services';
  const loc = slugifySegment(`${city}-${state}`) || slugifySegment(city) || 'us';
  return `https://www.angi.com/companylist/${kw}/${loc}.htm`;
}

function buildZillowAgentsSearchUrl(city, state) {
  const loc = slugifySegment(`${city}-${state}`);
  return `https://www.zillow.com/professionals/real-estate-agent-reviews/${loc}/`;
}

function buildBuiltWithUrl(domain) {
  const d = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];
  return d ? `https://builtwith.com/${d}` : '';
}

/**
 * Flatten nested Outscraper directory payloads (array of arrays).
 * @param {unknown} data
 * @returns {object[]}
 */
function flattenOutscraperDirectoryRows(data) {
  return flattenOutscraperPlaces(data);
}

function pickFirstString(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s && s !== 'N/A' && s !== '—') return s;
  }
  return '';
}

function normalizeYelpDirectoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = pickFirstString(row.name, row.title);
  if (!title) return null;
  const cats = Array.isArray(row.categories) ? row.categories.join(', ') : row.category || '';
  return {
    title,
    phone: pickFirstString(row.phone) || 'N/A',
    website: pickFirstString(row.website, row.site) || 'N/A',
    address: pickFirstString(row.formatted_address, row.formatted_dddress, row.address) || 'N/A',
    url: pickFirstString(row.business_url, row.url, row.link) || '',
    totalScore: Number(row.rating) || 0,
    reviewsCount: parseInt(row.reviews, 10) || parseInt(row.reviewsCount, 10) || 0,
    categoryName: cats || '',
  };
}

function normalizeYellowpagesDirectoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = pickFirstString(row.name, row.title);
  if (!title) return null;
  const cats = Array.isArray(row.categories) ? row.categories.join(', ') : '';
  const addr = [row.street, row.locality].filter(Boolean).join(', ');
  return {
    title,
    phone: pickFirstString(row.phone) || 'N/A',
    website: pickFirstString(row.site, row.website) || 'N/A',
    address: pickFirstString(addr, row.address) || 'N/A',
    url: pickFirstString(row.business_link, row.url) || '',
    totalScore: 0,
    reviewsCount: 0,
    categoryName: cats || '',
  };
}

function normalizeAngiDirectoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = pickFirstString(row.name, row.company_name, row.companyName, row.title, row.business_name);
  if (!title) return null;
  return {
    title,
    phone: pickFirstString(row.phone, row.phone_number, row.phoneNumber) || 'N/A',
    website: pickFirstString(row.website, row.site, row.url) || 'N/A',
    address: pickFirstString(row.address, row.full_address, row.formatted_address) || 'N/A',
    url: pickFirstString(row.profile_url, row.business_url, row.url, row.link) || '',
    totalScore: Number(row.rating || row.average_rating || row.score) || 0,
    reviewsCount: parseInt(row.reviews || row.review_count || row.reviewsCount, 10) || 0,
    categoryName: pickFirstString(row.category, row.categories) || '',
  };
}

function normalizeZillowAgentRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = pickFirstString(row.name, row.agent_name, row.full_name, row.title);
  if (!title) return null;
  const agency = pickFirstString(row.brokerage, row.company, row.team_name);
  return {
    title: agency ? `${title} (${agency})` : title,
    phone: pickFirstString(row.phone, row.phone_number) || 'N/A',
    website: pickFirstString(row.website, row.profile_url, row.url) || 'N/A',
    address: pickFirstString(row.address, row.city_state) || 'N/A',
    url: pickFirstString(row.profile_url, row.url, row.link) || '',
    totalScore: Number(row.rating || row.average_rating) || 0,
    reviewsCount: parseInt(row.reviews || row.review_count, 10) || 0,
    categoryName: 'Real estate agent',
  };
}

function normalizeDirectoryRows(rows, normalizer) {
  const out = [];
  for (const row of rows || []) {
    const mapped = normalizer(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

function parseAiScraperListings(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.length && Array.isArray(payload[0])) {
      return payload.flat().filter((x) => x && typeof x === 'object');
    }
    return payload.filter((x) => x && typeof x === 'object');
  }
  if (typeof payload === 'object') {
    for (const key of ['businesses', 'listings', 'results', 'items', 'data']) {
      if (Array.isArray(payload[key])) return payload[key].filter((x) => x && typeof x === 'object');
    }
    if (payload.name || payload.title || payload.company_name) return [payload];
  }
  return [];
}

/**
 * Generic Outscraper GET search (yelp-search, yellowpages-search, angi-search, zillow-search).
 */
async function runOutscraperDirectoryGet({
  endpoint,
  integrationEnv,
  label,
  buildRequestUrl,
  maxWaitMs,
}) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Outscraper is not configured (set OUTSCRAPER_API_KEY).');
  }
  const syncMode = ['1', 'true', 'yes'].includes(
    String(process.env.OUTSCRAPER_DIRECTORY_SYNC || '').toLowerCase().trim(),
  );
  const useAsync = !syncMode;
  const u = buildRequestUrl(apiBase(integrationEnv), useAsync);
  console.log(`[Outscraper] ${label}: ${u.toString()} (async=${useAsync})`);

  const initTimeout = useAsync ? MAPS_INIT_TIMEOUT_MS : Math.max(MAPS_INIT_TIMEOUT_MS, 120000);
  const { ok, status, json } = await outscraperFetchJson(u.toString(), {
    timeoutMs: initTimeout,
    integrationEnv,
  });

  if (!ok) {
    const msg = json?.errorMessage || json?.message || `HTTP ${status}`;
    throw new Error(`Outscraper ${label}: ${msg}`);
  }

  if (json?.status === 'Success' && json.data) {
    return flattenOutscraperDirectoryRows(json.data);
  }
  if (json?.status === 'Failure') {
    throw new Error(json.errorMessage || json.message || `Outscraper ${label} task failed`);
  }

  if (useAsync && json?.id) {
    let pollUrl = json.results_location;
    if (pollUrl && !String(pollUrl).startsWith('http')) {
      pollUrl = `${apiBase(integrationEnv)}${String(pollUrl).startsWith('/') ? '' : '/'}${pollUrl}`;
    }
    if (!pollUrl) pollUrl = `${apiBase(integrationEnv)}/requests/${json.id}`;
    const data = await pollOutscraperTask(pollUrl, {
      integrationEnv,
      maxWaitMs: maxWaitMs || DIRECTORY_MAX_WAIT_MS,
      label,
    });
    return flattenOutscraperDirectoryRows(data);
  }

  if (json?.error) throw new Error(json.errorMessage || json.message || `Outscraper ${label} error`);
  throw new Error(json?.errorMessage || `Unexpected Outscraper ${label} response (status=${status})`);
}

async function fetchAiScraperPage({ query, prompt, integrationEnv, label, maxWaitMs }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('Outscraper is not configured (set OUTSCRAPER_API_KEY).');
  }
  const q = String(query || '').trim();
  if (!q) throw new Error(`${label}: query URL is required`);

  const syncMode = ['1', 'true', 'yes'].includes(
    String(process.env.OUTSCRAPER_AI_SCRAPER_SYNC || '').toLowerCase().trim(),
  );
  const useAsync = !syncMode;
  const u = new URL(`${apiBase(integrationEnv)}/ai-scraper`);
  u.searchParams.set('query', q);
  u.searchParams.set('prompt', prompt);
  u.searchParams.set('async', useAsync ? 'true' : 'false');

  const initTimeout = useAsync ? MAPS_INIT_TIMEOUT_MS : Math.max(MAPS_INIT_TIMEOUT_MS, 120000);
  const { ok, status, json } = await outscraperFetchJson(u.toString(), {
    timeoutMs: initTimeout,
    integrationEnv,
  });

  if (!ok) {
    const msg = json?.errorMessage || json?.message || `HTTP ${status}`;
    throw new Error(`Outscraper ${label}: ${msg}`);
  }

  let payload = json;
  if (payload?.status === 'Failure') {
    throw new Error(payload.errorMessage || payload.message || `Outscraper ${label} failed`);
  }
  if (useAsync && payload?.id && payload?.status !== 'Success') {
    let pollUrl = payload.results_location;
    if (pollUrl && !String(pollUrl).startsWith('http')) {
      pollUrl = `${apiBase(integrationEnv)}${String(pollUrl).startsWith('/') ? '' : '/'}${pollUrl}`;
    }
    if (!pollUrl) pollUrl = `${apiBase(integrationEnv)}/requests/${payload.id}`;
    const data = await pollOutscraperTask(pollUrl, {
      integrationEnv,
      maxWaitMs: maxWaitMs || DIRECTORY_MAX_WAIT_MS,
      label,
    });
    payload = { status: 'Success', data };
  }
  if (payload?.status !== 'Success') {
    throw new Error(payload?.errorMessage || `Unexpected Outscraper ${label} response`);
  }
  return payload.data;
}

async function searchYelpDirectory({ keyword, city, state, maxResults, integrationEnv }) {
  const limit = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 15));
  const queryUrl = buildYelpSearchUrl(keyword, city, state);
  const rows = await runOutscraperDirectoryGet({
    endpoint: 'yelp-search',
    integrationEnv,
    label: 'Yelp search',
    buildRequestUrl: (base, useAsync) => {
      const u = new URL(`${base}/yelp-search`);
      u.searchParams.set('query', queryUrl);
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('async', useAsync ? 'true' : 'false');
      return u;
    },
  });
  return normalizeDirectoryRows(rows, normalizeYelpDirectoryRow);
}

async function searchYellowpagesDirectory({ keyword, city, state, maxResults, integrationEnv }) {
  const limit = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 15));
  const rows = await runOutscraperDirectoryGet({
    endpoint: 'yellowpages-search',
    integrationEnv,
    label: 'Yellow Pages search',
    buildRequestUrl: (base, useAsync) => {
      const u = new URL(`${base}/yellowpages-search`);
      u.searchParams.set('query', keyword);
      u.searchParams.set('location', `${city}, ${state}`);
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('async', useAsync ? 'true' : 'false');
      return u;
    },
  });
  return normalizeDirectoryRows(rows, normalizeYellowpagesDirectoryRow);
}

async function searchAngiDirectory({ keyword, city, state, maxResults, integrationEnv }) {
  const limit = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 15));
  const queryUrl = buildAngiSearchUrl(keyword, city, state);

  try {
    const rows = await runOutscraperDirectoryGet({
      endpoint: 'angi-search',
      integrationEnv,
      label: 'Angi search',
      buildRequestUrl: (base, useAsync) => {
        const u = new URL(`${base}/angi-search`);
        u.searchParams.set('query', queryUrl);
        u.searchParams.set('limit', String(limit));
        u.searchParams.set('async', useAsync ? 'true' : 'false');
        return u;
      },
    });
    const mapped = normalizeDirectoryRows(rows, normalizeAngiDirectoryRow);
    if (mapped.length) return mapped;
  } catch (e) {
    console.warn('[Outscraper] angi-search endpoint unavailable, trying AI scraper:', e.message);
  }

  const prompt =
    'Extract every business listing visible on this Angi search results page. Return a JSON array of objects with keys: name, phone, website, address, profile_url, rating, review_count, category.';
  const data = await fetchAiScraperPage({
    query: queryUrl,
    prompt,
    integrationEnv,
    label: 'Angi AI scraper',
  });
  const listings = parseAiScraperListings(data);
  return normalizeDirectoryRows(listings.slice(0, limit), normalizeAngiDirectoryRow);
}

async function searchZillowAgentsDirectory({ city, state, maxResults, integrationEnv }) {
  const limit = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 15));
  const queryUrl = buildZillowAgentsSearchUrl(city, state);

  try {
    const rows = await runOutscraperDirectoryGet({
      endpoint: 'zillow-search',
      integrationEnv,
      label: 'Zillow agents search',
      buildRequestUrl: (base, useAsync) => {
        const u = new URL(`${base}/zillow-search`);
        u.searchParams.set('query', queryUrl);
        u.searchParams.set('limit', String(limit));
        u.searchParams.set('async', useAsync ? 'true' : 'false');
        return u;
      },
    });
    const mapped = normalizeDirectoryRows(rows, normalizeZillowAgentRow);
    if (mapped.length) return mapped;
  } catch (e) {
    console.warn('[Outscraper] zillow-search for agents failed, trying AI scraper:', e.message);
  }

  const prompt =
    'Extract real estate agent profiles from this Zillow professionals page. Return a JSON array with name, phone, website, profile_url, rating, review_count, brokerage, address.';
  const data = await fetchAiScraperPage({
    query: queryUrl,
    prompt,
    integrationEnv,
    label: 'Zillow agents AI scraper',
  });
  const listings = parseAiScraperListings(data);
  return normalizeDirectoryRows(listings.slice(0, limit), normalizeZillowAgentRow);
}

/**
 * BuiltWith tech stack via Outscraper AI scraper (domain enrichment).
 * @returns {Promise<{ cmsPlatform?: string, techStackTags?: string[] }|null>}
 */
async function fetchBuiltWithTechStack({ domain, integrationEnv }) {
  const url = buildBuiltWithUrl(domain);
  if (!url) return null;
  const prompt =
    'Extract the website technology stack from this BuiltWith page. Return JSON with keys: cms_platform (string), tech_stack_tags (array of technology names).';
  try {
    const data = await fetchAiScraperPage({
      query: url,
      prompt,
      integrationEnv,
      label: 'BuiltWith scraper',
      maxWaitMs: Math.min(DIRECTORY_MAX_WAIT_MS, 90000),
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    const tags = row.tech_stack_tags || row.technologies || row.tech || [];
    return {
      cmsPlatform: pickFirstString(row.cms_platform, row.cms, row.cmsPlatform) || undefined,
      techStackTags: Array.isArray(tags)
        ? tags.map((t) => String(t).trim()).filter(Boolean)
        : String(tags || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    };
  } catch (e) {
    console.warn('[Outscraper] BuiltWith scrape failed:', e.message);
    return null;
  }
}

module.exports = {
  isConfigured,
  pingHealth,
  apiBase,
  apiKey,
  searchGoogleMaps,
  fetchGoogleMapsReviews,
  fetchContactsAndLeads,
  flattenOutscraperReviewsPayload,
  flattenContactsAndLeadsPayload,
  flattenOutscraperDirectoryRows,
  normalizeMapsPlace,
  pollOutscraperTask,
  buildYelpSearchUrl,
  buildAngiSearchUrl,
  buildZillowAgentsSearchUrl,
  buildBuiltWithUrl,
  normalizeYelpDirectoryRow,
  normalizeYellowpagesDirectoryRow,
  normalizeAngiDirectoryRow,
  normalizeZillowAgentRow,
  parseAiScraperListings,
  searchYelpDirectory,
  searchYellowpagesDirectory,
  searchAngiDirectory,
  searchZillowAgentsDirectory,
  fetchBuiltWithTechStack,
};
