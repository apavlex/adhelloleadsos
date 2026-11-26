/**
 * Search adapters on treg's routed endpoints.
 * Routed tools (treg.google.serp.maps, treg.web.search) pick a provider and
 * fall back on a miss, which is the piece worth borrowing instead of pinning
 * a vendor id that the catalog replaces every week.
 *
 * Place and result rows stay in the same shape the built-in providers return.
 */

const { sanitizeLeadCategoryName } = require('./leadCategory');
const { buildMapsSearchQuery, countryForState } = require('./geocodeLocation');
const { tregCall } = require('./tregClient');
const { normalizeListingRow } = require('./listingSearch/normalize');
const webSearch = require('./listingSearch/sources/webSearch');

function pickFirst(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'object') continue;
    const s = String(v).trim();
    if (s && s !== 'N/A') return s;
  }
  return '';
}

function firstFinite(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') {
      const nested = firstFinite(v.value, v.rating, v.votes_count, v.reviews, v.count);
      if (nested) return nested;
      continue;
    }
    const n = Number(String(v).replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function unwrapPlace(item) {
  if (!item || typeof item !== 'object') return {};
  if (item.place && typeof item.place === 'object' && (item.place.title || item.place.name || item.place.address)) {
    return item.place;
  }
  return item;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function collectPlaces(body) {
  const output = body && body.output && typeof body.output === 'object' ? body.output : null;
  const buckets = [
    output && output.places,
    output && output.local_results,
    output && output.maps_results,
    body && body.places,
    body && body.local_results,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length) return bucket;
  }
  const results = asList(output && output.results);
  if (results.some((row) => row && (row.place_id || row.address || row.phone || row.rating))) return results;
  return [];
}

function collectWebResults(body) {
  const output = body && body.output && typeof body.output === 'object' ? body.output : null;
  const buckets = [
    output && output.results,
    output && output.organic_results,
    output && output.organic,
    body && body.results,
    body && body.organic_results,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length) return bucket;
  }
  return [];
}

function websiteFromPlace(item) {
  const links = item.links && typeof item.links === 'object' ? item.links : null;
  return pickFirst(
    item.website,
    item.site,
    item.domain && /^https?:\/\//i.test(String(item.domain)) ? item.domain : '',
    item.website_url,
    links && links.website,
    links && links.site,
  );
}

function phoneFromPlace(item) {
  const links = item.links && typeof item.links === 'object' ? item.links : null;
  const contact = item.contact_info && typeof item.contact_info === 'object' ? item.contact_info : null;
  return pickFirst(
    item.phone,
    item.phone_number,
    item.formatted_phone_number,
    links && links.phone,
    contact && contact.phone,
  ).replace(/^tel:/i, '');
}

function mapsUrl(item, ctx) {
  const direct = pickFirst(item.place_link, item.location_link, item.google_url, item.maps_url, item.url, item.link);
  if (direct && /google\.[^/]+\/maps|maps\.google/i.test(direct)) return direct;
  const pid = pickFirst(item.place_id, item.placeId, item.google_place_id);
  if (pid) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pid)}&query_place_id=${encodeURIComponent(pid)}`;
  const gps = item.gps_coordinates || item.gps || null;
  if (gps && gps.latitude != null && gps.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gps.latitude},${gps.longitude}`)}`;
  }
  const title = pickFirst(item.title, item.name);
  const addr = pickFirst(item.address, item.full_address, item.formatted_address);
  const loc = [title, addr, ctx.city, ctx.state].filter(Boolean).join(' ');
  if (loc) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;
  return direct || '';
}

function normalizePlace(item, ctx) {
  const row = unwrapPlace(item);
  const title = pickFirst(row.title, row.name, row.business_name) || 'N/A';
  const website = websiteFromPlace(row);
  const city = pickFirst(row.city, row.locality, ctx.city);
  const state = pickFirst(row.state, row.us_state, ctx.state);
  const category = pickFirst(
    row.type,
    row.category,
    row.category_name,
    Array.isArray(row.types) && row.types.length ? row.types[0] : '',
    Array.isArray(row.subtypes) && row.subtypes.length ? row.subtypes[0] : '',
  );
  const rating = firstFinite(
    typeof row.rating === 'object' ? row.rating && row.rating.value : row.rating,
    row.stars,
    row.totalScore,
  );
  const reviews = firstFinite(
    typeof row.rating === 'object' ? row.rating && (row.rating.votes_count || row.rating.reviews) : null,
    row.reviews,
    row.review_count,
    row.reviews_count,
    row.user_ratings_total,
    row.reviewsCount,
  );
  return {
    title,
    phone: phoneFromPlace(row) || 'N/A',
    website: website || 'N/A',
    email: pickFirst(row.email, row.contact_email) || 'N/A',
    categoryName: sanitizeLeadCategoryName(category, title, 'N/A'),
    address: pickFirst(row.full_address, row.formatted_address, row.address, row.vicinity) || 'N/A',
    city: city || '',
    state: state || '',
    postalCode: pickFirst(row.zipcode, row.postal_code, row.postalCode, row.zip) || '',
    totalScore: rating,
    reviewsCount: reviews,
    url: mapsUrl(row, { city: ctx.city, state: ctx.state }) || website || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    placeId: pickFirst(row.place_id, row.placeId, row.google_place_id) || undefined,
  };
}

function resultLink(row) {
  return pickFirst(row.link, row.url, row.href, row.website);
}

function extractPrice(text) {
  const match = String(text || '').match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Google Maps places via treg.google.serp.maps.
 * Same arguments and row shape as mapsSearch.searchGoogleMaps.
 */
async function searchGoogleMaps(params) {
  const keyword = String(params.keyword || '').trim();
  const city = String(params.city || '').trim();
  const state = String(params.state || '').trim();
  if (!keyword || !city || !state) {
    throw new Error('keyword, city, and state are required');
  }
  const cap = Math.min(500, Math.max(1, parseInt(params.maxResults, 10) || 20));
  const country = countryForState(state) === 'Canada' ? 'ca' : 'us';
  const q = buildMapsSearchQuery(keyword, city, state);
  const { body } = await tregCall('treg.google.serp.maps', {
    method: 'POST',
    body: { q, country, language: 'en' },
    feature: 'maps-search',
    workspaceId: params.integrationEnv && params.integrationEnv.ADHELLO_WORKSPACE_ID,
    integrationEnv: params.integrationEnv,
    maxCostUsd: 0.25,
    fetchImpl: params.fetchImpl,
  });
  const places = collectPlaces(body)
    .slice(0, cap)
    .map((item) => normalizePlace(item, { city, state }))
    .filter((row) => row.title && row.title !== 'N/A');
  if (!places.length) {
    throw new Error(`No Maps search results found for "${keyword}" in ${city}, ${state}.`);
  }
  return places;
}

/**
 * Open-web results for listing search, filtered the same way as SerpAPI organic.
 */
async function searchWebListings(params) {
  const cap = Math.max(1, parseInt(params.maxResults, 10) || 20);
  const q = webSearch.buildSearchQuery(params);
  const { body } = await tregCall('treg.web.search', {
    method: 'POST',
    body: { q, limit: Math.min(20, Math.max(1, cap)) },
    feature: 'web-search',
    workspaceId: params.integrationEnv && params.integrationEnv.ADHELLO_WORKSPACE_ID,
    integrationEnv: params.integrationEnv,
    maxCostUsd: 0.1,
    fetchImpl: params.fetchImpl,
  });
  const city = params.city;
  const state = params.state;
  return collectWebResults(body)
    .filter((row) => webSearch.isLikelyListingUrl(resultLink(row)))
    .slice(0, cap)
    .map((row) => {
      const url = resultLink(row);
      const title = pickFirst(row.title, row.name) || url;
      const snippet = pickFirst(row.snippet, row.description, row.content) || '';
      return normalizeListingRow({
        source: 'web_treg',
        sourceId: String(row.position || row.rank || url || title),
        title,
        price: extractPrice(`${title} ${snippet}`),
        url,
        description: snippet,
        city,
        state,
        propertyType: 'mobile_home',
        postedAt: row.date || '',
      });
    });
}

module.exports = {
  searchGoogleMaps,
  searchWebListings,
  collectPlaces,
  collectWebResults,
  normalizePlace,
};
