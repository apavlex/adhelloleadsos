/**
 * RapidAPI Local Business Data client.
 * Provider for Maps search step in Find Leads.
 */

const DEFAULT_HOST = 'local-business-data.p.rapidapi.com';
const DEFAULT_ENDPOINT = 'https://local-business-data.p.rapidapi.com/search';

/** RapidAPI requires x-rapidapi-host to match the API host in the request URL. */
function hostFromEndpointUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    return new URL(urlStr.trim()).hostname || '';
  } catch {
    return '';
  }
}

function apiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_KEY || '').trim();
}

function apiHost(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_HOST;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  const fromEnv = process.env.RAPIDAPI_HOST;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const fromEndpoint = hostFromEndpointUrl(endpoint(integrationEnv));
  if (fromEndpoint) return fromEndpoint;
  return DEFAULT_HOST;
}

function endpoint(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT || DEFAULT_ENDPOINT).trim();
}

/** Query-string key for the search text (Local Business Data uses `query`; some RapidAPI hosts use `q`, `text`, etc.). */
function searchQueryParam(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_SEARCH_QUERY_PARAM;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  const ev = process.env.RAPIDAPI_SEARCH_QUERY_PARAM;
  if (typeof ev === 'string' && ev.trim()) return ev.trim();
  return 'query';
}

/** Query-string key for max results (default `limit`). */
function searchLimitParam(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_SEARCH_LIMIT_PARAM;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  const ev = process.env.RAPIDAPI_SEARCH_LIMIT_PARAM;
  if (typeof ev === 'string' && ev.trim()) return ev.trim();
  return 'limit';
}

function isConfigured(integrationEnv) {
  return Boolean(apiKey(integrationEnv));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstFiniteNum(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function normalizePlace(item) {
  const site = pickFirst(
    item.website,
    item.site,
    item.domain,
    item.website_url,
    item.web_site,
    item.contact_website
  );
  const cat = pickFirst(
    item.type,
    item.category,
    item.category_name,
    item.business_type,
    Array.isArray(item.types) && item.types.length ? item.types[0] : '',
    Array.isArray(item.subtypes) && item.subtypes.length ? item.subtypes[0] : ''
  );
  return {
    title: pickFirst(item.name, item.title, item.business_name, item.business_name_full) || 'N/A',
    phone: pickFirst(
      item.phone_number,
      item.phone,
      item.formatted_phone_number,
      item.international_phone_number,
      item.contact_phone
    ) || 'N/A',
    website: site || 'N/A',
    email: pickFirst(item.email, item.contact_email, item.contactEmail, item.contact_email_address) || 'N/A',
    categoryName: cat || 'N/A',
    address: pickFirst(
      item.full_address,
      item.formatted_address,
      item.address,
      item.address_street,
      item.vicinity,
      item.fullAddress
    ) || 'N/A',
    city: pickFirst(item.city, item.locality),
    state: pickFirst(item.state, item.us_state, item.administrative_area_level_1),
    postalCode: pickFirst(item.zipcode, item.postal_code, item.postalCode, item.zip),
    totalScore: firstFiniteNum(item.rating, item.stars, item.totalScore, item.star_rating),
    reviewsCount: firstFiniteNum(
      item.review_count,
      item.reviews_count,
      item.user_ratings_total,
      item.reviewsCount,
      item.total_reviews
    ),
    url: pickFirst(
      item.place_link,
      item.location_link,
      item.google_url,
      item.maps_url,
      item.url,
      item.link,
      item.place_url
    ),
    facebook: pickFirst(item.facebook, item.emails_and_contacts && item.emails_and_contacts.facebook) || 'N/A',
    instagram: pickFirst(item.instagram, item.emails_and_contacts && item.emails_and_contacts.instagram) || 'N/A',
    twitter: pickFirst(
      item.twitter,
      item.twitter_url,
      item.emails_and_contacts && item.emails_and_contacts.twitter
    ) || 'N/A',
    placeId: pickFirst(item.place_id, item.placeId, item.google_place_id),
  };
}

function extractItems(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object');
  for (const rootKey of ['results', 'places', 'businesses', 'items', 'data']) {
    const block = payload[rootKey];
    if (Array.isArray(block)) return block.filter((x) => x && typeof x === 'object');
    if (block && typeof block === 'object') {
      for (const k of ['data', 'results', 'businesses', 'places', 'items']) {
        if (Array.isArray(block[k])) return block[k].filter((x) => x && typeof x === 'object');
      }
      if (block.place_id || block.name || block.title) return [block];
    }
  }
  const data = payload.data;
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object');
  if (data && typeof data === 'object') {
    for (const k of ['data', 'results', 'businesses', 'places', 'items']) {
      if (Array.isArray(data[k])) return data[k].filter((x) => x && typeof x === 'object');
    }
    if (data.place_id || data.name || data.title) return [data];
  }
  return [];
}

async function requestWithBackoff(url, headers, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return json || {};
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxAttempts - 1) {
          throw new Error((json && (json.message || json.error)) || `HTTP ${res.status}`);
        }
        const waitMs = Math.min(15000, (2 ** attempt) * 1000 + Math.floor(Math.random() * 500));
        await sleep(waitMs);
        continue;
      }
      const detail =
        (json && (json.message || json.error)) ||
        (text && text.length < 280 ? text : text ? `${text.slice(0, 200)}…` : '');
      throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      const waitMs = Math.min(15000, (2 ** attempt) * 1000 + Math.floor(Math.random() * 500));
      await sleep(waitMs);
    }
  }
  return {};
}

/**
 * Search Google Maps via RapidAPI Local Business Data.
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>}
 */
async function searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
  if (!isConfigured(integrationEnv)) {
    throw new Error('RapidAPI is not configured (set RAPIDAPI_KEY).');
  }
  const q = `${keyword} in ${city}, ${state}, USA`;
  const limit = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const u = new URL(endpoint(integrationEnv));
  const qp = searchQueryParam(integrationEnv);
  const lp = searchLimitParam(integrationEnv);
  u.searchParams.set(qp, q);
  u.searchParams.set(lp, String(limit));
  const headers = {
    'x-rapidapi-key': apiKey(integrationEnv),
    'x-rapidapi-host': apiHost(integrationEnv),
    accept: 'application/json',
  };
  const host = headers['x-rapidapi-host'];
  console.log(`[RapidAPI] GET ${u.origin}${u.pathname} host=${host} query="${q}" limit=${limit}`);
  const payload = await requestWithBackoff(u.toString(), headers);
  const raw = extractItems(payload);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const row = normalizePlace(r);
    const pid = String(row.placeId || '').trim();
    if (pid) {
      if (seen.has(pid)) continue;
      seen.add(pid);
    }
    out.push(row);
  }
  console.log(`[RapidAPI] Returned ${out.length} places.`);
  return out;
}

module.exports = {
  apiKey,
  apiHost,
  endpoint,
  hostFromEndpointUrl,
  searchQueryParam,
  searchLimitParam,
  isConfigured,
  searchGoogleMaps,
};

