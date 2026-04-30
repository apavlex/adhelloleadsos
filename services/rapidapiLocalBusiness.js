/**
 * RapidAPI Local Business Data client.
 * Provider for Maps search step in Find Leads.
 */

const DEFAULT_HOST = 'local-business-data.p.rapidapi.com';
const DEFAULT_ENDPOINT = 'https://local-business-data.p.rapidapi.com/search';

function apiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_KEY || '').trim();
}

function apiHost(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_HOST;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_HOST || DEFAULT_HOST).trim();
}

function endpoint(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT || DEFAULT_ENDPOINT).trim();
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

function pickFirst(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function normalizePlace(item) {
  const site = pickFirst(item.website, item.site);
  const cat = pickFirst(
    item.type,
    item.category,
    Array.isArray(item.subtypes) && item.subtypes.length ? item.subtypes[0] : ''
  );
  return {
    title: pickFirst(item.name, item.title) || 'N/A',
    phone: pickFirst(item.phone_number, item.phone) || 'N/A',
    website: site || 'N/A',
    email: pickFirst(item.email, item.contact_email, item.contactEmail) || 'N/A',
    categoryName: cat || 'N/A',
    address: pickFirst(item.full_address, item.formatted_address, item.address) || 'N/A',
    city: pickFirst(item.city),
    state: pickFirst(item.state, item.us_state),
    postalCode: pickFirst(item.zipcode, item.postal_code, item.postalCode),
    totalScore: safeNum(item.rating, 0),
    reviewsCount: safeNum(item.review_count, 0),
    url: pickFirst(item.place_link, item.location_link, item.google_url, item.url),
    facebook: pickFirst(item.facebook, item.emails_and_contacts && item.emails_and_contacts.facebook) || 'N/A',
    instagram: pickFirst(item.instagram, item.emails_and_contacts && item.emails_and_contacts.instagram) || 'N/A',
    twitter: pickFirst(
      item.twitter,
      item.twitter_url,
      item.emails_and_contacts && item.emails_and_contacts.twitter
    ) || 'N/A',
    placeId: pickFirst(item.place_id, item.placeId),
  };
}

function extractItems(payload) {
  const data = payload && payload.data;
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object');
  if (data && typeof data === 'object') {
    for (const k of ['data', 'results', 'businesses', 'places', 'items']) {
      if (Array.isArray(data[k])) return data[k].filter((x) => x && typeof x === 'object');
    }
    if (data.place_id || data.name) return [data];
  }
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object');
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
      throw new Error((json && (json.message || json.error)) || `HTTP ${res.status}`);
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
  u.searchParams.set('query', q);
  u.searchParams.set('limit', String(limit));
  const headers = {
    'x-rapidapi-key': apiKey(integrationEnv),
    'x-rapidapi-host': apiHost(integrationEnv),
    accept: 'application/json',
  };
  console.log(`[RapidAPI] Local business search: "${q}" (limit=${limit})`);
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
  isConfigured,
  searchGoogleMaps,
};

