/**
 * RapidAPI Local Business Data client.
 * Provider for Maps search step in Find Leads.
 */

const {
  buildMapsSearchQuery,
  geocodeCityState,
  countryForState,
} = require('./geocodeLocation');

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

/** Reject review/detail endpoints saved by mistake in Workspace → Integrations. */
function assertSearchEndpoint(urlStr) {
  let u;
  try {
    u = new URL(String(urlStr || '').trim());
  } catch {
    throw new Error('RapidAPI endpoint URL is invalid.');
  }
  const path = u.pathname.toLowerCase();
  if (
    /review|business[-_]?details?|place[-_]?details?|\/detail\b|\/place\.php/i.test(path) &&
    !/\/search/i.test(path)
  ) {
    throw new Error(
      'RapidAPI endpoint looks like a review/details URL, not search. Use the /search URL from your API’s RapidAPI page (e.g. …/search or …/search.php).'
    );
  }
}

function messageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const msg = pickFirst(
    payload.message,
    payload.error,
    payload.status_message,
    payload.msg,
    payload.reason,
    payload.detail
  );
  if (msg) return String(msg);
  if (payload.success === false) return 'API reported success=false';
  const st = payload.status;
  if (st != null && String(st).toLowerCase() === 'error') return 'API status=error';
  return '';
}

function describeEmptyPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Empty response body.';
  const keys = Object.keys(payload).slice(0, 8);
  return keys.length
    ? `Response keys: ${keys.join(', ')}. Check endpoint URL and query/limit param names.`
    : 'Empty JSON object.';
}

function usesDefaultQueryParam(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_SEARCH_QUERY_PARAM;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim() === 'query';
  const ev = process.env.RAPIDAPI_SEARCH_QUERY_PARAM;
  if (typeof ev === 'string' && ev.trim()) return ev.trim() === 'query';
  return true;
}

/** When query param is still default, try common RapidAPI aliases after 0 results. */
function queryParamAttempts(integrationEnv) {
  const primary = searchQueryParam(integrationEnv);
  const attempts = [primary];
  if (usesDefaultQueryParam(integrationEnv)) {
    for (const alt of ['q', 'text', 'search']) {
      if (!attempts.includes(alt)) attempts.push(alt);
    }
  }
  return attempts;
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

function normText(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function extractNextToken(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return pickFirst(
    data.next_page_token,
    data.nextPageToken,
    payload.next_page_token,
    payload.nextPageToken,
    data.cursor,
    payload.cursor,
    data.next_cursor
  );
}

function appendGeoParams(url, geo) {
  if (!geo || geo.lat == null || geo.lng == null) return;
  const pairs = [
    ['lat', 'lng'],
    ['latitude', 'longitude'],
  ];
  for (const [latKey, lngKey] of pairs) {
    if (!url.searchParams.has(latKey)) url.searchParams.set(latKey, String(geo.lat));
    if (!url.searchParams.has(lngKey)) url.searchParams.set(lngKey, String(geo.lng));
  }
}

/** Drop businesses clearly outside the requested city/state (e.g. Lyon when searching Vancouver, BC). */
function rowMatchesTarget(row, city, state) {
  const tCity = normText(city);
  const tState = String(state || '')
    .trim()
    .toUpperCase();
  const addr = normText(row.address);
  const rCity = normText(row.city);
  const targetCountry = countryForState(tState);

  if (targetCountry === 'Canada') {
    if (/\bfrance\b|, fr\b|69006\b/.test(addr) && !addr.includes('canada')) return false;
    if (/\blyon\b|\bparis\b/.test(addr) && !addr.includes(tCity) && !rCity.includes(tCity)) return false;
  } else if (/\bfrance\b|, fr\b|69006\b/.test(addr)) {
    return false;
  }

  if (tCity) {
    const inAddr = addr.includes(tCity);
    const inCityField =
      rCity && (rCity === tCity || rCity.includes(tCity) || tCity.includes(rCity));
    if (!inAddr && !inCityField) return false;
  }

  if (tState) {
    const stLow = tState.toLowerCase();
    const rState = String(row.state || '')
      .trim()
      .toUpperCase();
    if (rState && rState !== tState && rState.slice(0, 2) !== tState.slice(0, 2)) {
      if (!addr.includes(stLow) && !addr.includes(tState)) return false;
    }
  }

  return true;
}

function filterByTargetArea(rows, city, state) {
  const filtered = rows.filter((r) => rowMatchesTarget(r, city, state));
  if (filtered.length < rows.length) {
    console.log(
      `[RapidAPI] Dropped ${rows.length - filtered.length} place(s) outside ${city}, ${state}.`
    );
  }
  return filtered;
}

function rowsFromPayload(payload, seen) {
  const raw = extractItems(payload);
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
  return out;
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

  const c = String(city || '').trim();
  const st = String(state || '').trim();
  if (!c || !st) {
    throw new Error('City and state/province are required (e.g. Vancouver + BC or Austin + TX).');
  }

  const q = buildMapsSearchQuery(keyword, c, st);
  const limit = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const baseEndpoint = endpoint(integrationEnv);
  assertSearchEndpoint(baseEndpoint);

  const geo = await geocodeCityState(c, st);
  if (geo) {
    console.log(
      `[RapidAPI] Geocoded ${c}, ${st} → ${geo.lat},${geo.lng} (${geo.formattedAddress || geo.countryCode || ''})`
    );
  }

  const lp = searchLimitParam(integrationEnv);
  const headers = {
    'x-rapidapi-key': apiKey(integrationEnv),
    'x-rapidapi-host': apiHost(integrationEnv),
    accept: 'application/json',
  };
  const host = headers['x-rapidapi-host'];
  const seen = new Set();
  let out = [];
  let lastPayload = null;
  let lastApiMsg = '';
  // Local Business Data API accepts limit 1–500 per request; avoid capping at 20 when user asks for more.
  const pageSize = Math.min(500, limit);
  const paramAttempts = queryParamAttempts(integrationEnv);

  for (let attemptIdx = 0; attemptIdx < paramAttempts.length && out.length < limit; attemptIdx += 1) {
    const qp = paramAttempts[attemptIdx];
    let nextToken = '';

    while (out.length < limit) {
      const u = new URL(baseEndpoint);
      u.searchParams.set(qp, q);
      u.searchParams.set(lp, String(Math.min(pageSize, limit - out.length)));
      appendGeoParams(u, geo);
      if (nextToken) u.searchParams.set('next_page_token', nextToken);

      console.log(
        `[RapidAPI] GET ${u.origin}${u.pathname} host=${host} ${qp}="${q}" ${lp}=${u.searchParams.get(lp)}` +
          (nextToken ? ' page=next' : '') +
          (attemptIdx > 0 ? ' (param retry)' : '')
      );

      const payload = await requestWithBackoff(u.toString(), headers);
      lastPayload = payload;
      lastApiMsg = messageFromPayload(payload);
      const batch = rowsFromPayload(payload, seen);
      out = out.concat(batch);
      nextToken = extractNextToken(payload);

      if (!batch.length || !nextToken || out.length >= limit) break;
    }

    if (out.length > 0) {
      if (qp !== paramAttempts[0]) {
        console.log(
          `[RapidAPI] ${out.length} places using query param "${qp}". Save RAPIDAPI_SEARCH_QUERY_PARAM=${qp} in integrations if needed.`
        );
      }
      break;
    }
    if (lastApiMsg) break;
  }

  out = filterByTargetArea(out, c, st).slice(0, limit);

  if (out.length === 0) {
    const detail = lastApiMsg || describeEmptyPayload(lastPayload);
    throw new Error(
      `RapidAPI returned no businesses in ${c}, ${st} for "${q}". ${detail} Use BC for Vancouver Canada (not USA). Test connection under Workspace → API integrations.`
    );
  }

  console.log(`[RapidAPI] Returning ${out.length} place(s) in target area.`);
  return out;
}

module.exports = {
  apiKey,
  apiHost,
  endpoint,
  hostFromEndpointUrl,
  assertSearchEndpoint,
  messageFromPayload,
  searchQueryParam,
  searchLimitParam,
  isConfigured,
  searchGoogleMaps,
};

