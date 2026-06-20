/**
 * Google Maps / Local business leads via Oxylabs google_search (local pack + local tab).
 */

const oxylabs = require('./oxylabsClient');
const { buildMapsSearchQuery } = require('./geocodeLocation');

function pickPhone(item) {
  const p = item && (item.phone || item.phone_number);
  return typeof p === 'string' ? p.trim().replace(/^tel:/i, '') : '';
}

function mapsUrlFromLocalItem(item, ctx) {
  const href = item && (item.href || item.url || item.link);
  if (typeof href === 'string' && /^https?:\/\//i.test(href)) return href.split('#')[0];
  const cid = item && item.cid;
  if (cid != null && String(cid).trim()) {
    return `https://www.google.com/maps?cid=${encodeURIComponent(String(cid).trim())}`;
  }
  const title = String((item && item.title) || '').trim();
  const city = String((ctx && ctx.city) || '').trim();
  const state = String((ctx && ctx.state) || '').trim();
  const addr = String((item && item.address) || '').trim();
  if (title) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${addr} ${city} ${state}`.trim())}`;
  }
  return '';
}

function normalizeLocalItem(item, ctx) {
  const ratingRaw = item && item.rating != null ? item.rating : 0;
  const rating = Number(ratingRaw);
  const reviewsRaw =
    item && item.rating_count != null
      ? item.rating_count
      : item && item.reviews_count != null
        ? item.reviews_count
        : item && item.reviews != null
          ? item.reviews
          : 0;
  const reviewsCount =
    typeof reviewsRaw === 'number'
      ? Math.round(reviewsRaw)
      : parseInt(String(reviewsRaw).replace(/,/g, ''), 10) || 0;

  const website =
    item && typeof item.website === 'string' && /^https?:\/\//i.test(item.website)
      ? item.website.trim()
      : 'N/A';
  const listingUrl = mapsUrlFromLocalItem(item, ctx);

  return {
    title: String((item && item.title) || 'N/A').trim() || 'N/A',
    phone: pickPhone(item) || 'N/A',
    website,
    email: 'N/A',
    categoryName: String((item && item.category) || (item && item.type) || 'N/A').trim() || 'N/A',
    address: String((item && item.address) || 'N/A').trim() || 'N/A',
    city: String((ctx && ctx.city) || '').trim(),
    state: String((ctx && ctx.state) || '').trim(),
    postalCode: '',
    totalScore: Number.isFinite(rating) ? rating : 0,
    reviewsCount,
    url: listingUrl || (website !== 'N/A' ? website : ''),
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    placeId: item && item.cid != null ? String(item.cid) : undefined,
    mapsProvider: 'oxylabs',
  };
}

function dedupeKey(row) {
  const pid = String(row.placeId || '').trim();
  if (pid) return `pid:${pid}`;
  return `t:${String(row.title || '').toLowerCase()}|p:${String(row.phone || '').replace(/\D/g, '')}`;
}

function mergeRows(primary, extra, maxTotal) {
  const cap = Math.max(1, parseInt(maxTotal, 10) || 20);
  const merged = [...(Array.isArray(primary) ? primary : [])];
  const seen = new Set(merged.map(dedupeKey));
  for (const row of Array.isArray(extra) ? extra : []) {
    const k = dedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
    if (merged.length >= cap) break;
  }
  return merged.slice(0, cap);
}

function collectLocalItems(parsed) {
  const items = [];
  if (!parsed || typeof parsed !== 'object') return items;

  const pack = parsed.local_pack;
  if (pack && Array.isArray(pack.items)) {
    for (const item of pack.items) items.push(item);
  }

  const localResults = parsed.local_results || parsed.places || parsed.maps_results;
  if (Array.isArray(localResults)) {
    for (const item of localResults) items.push(item);
  }

  return items;
}

async function fetchGoogleSearchPage(params, integrationEnv, pageOpts = {}) {
  const q = buildMapsSearchQuery(params.keyword, params.city, params.state);
  const payload = {
    source: 'google_search',
    query: q,
    domain: 'com',
    geo_location: oxylabs.geoLocationForCityState(params.city, params.state),
    parse: true,
    start_page: pageOpts.startPage || 1,
    pages: pageOpts.pages || 1,
    limit: pageOpts.limit || 10,
    context: pageOpts.context || [],
  };

  const data = await oxylabs.postQuery(payload, integrationEnv, { timeoutMs: 90000 });
  const rows = oxylabs.resultRows(data);
  const localItems = [];

  for (const row of rows) {
    const content = oxylabs.extractContent(row);
    const parsed = oxylabs.parsedGoogleResults(content);
    localItems.push(...collectLocalItems(parsed));
  }

  return localItems;
}

function isConfigured(integrationEnv) {
  return oxylabs.isConfigured(integrationEnv);
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 */
async function searchGoogleMaps(params) {
  if (!isConfigured(params.integrationEnv)) {
    throw new Error('Oxylabs credentials are not configured.');
  }

  const cap = Math.min(500, Math.max(1, parseInt(params.maxResults, 10) || 20));
  const ctx = { city: params.city, state: params.state };
  let localItems = [];

  try {
    const pages = Math.min(5, Math.max(1, Math.ceil(cap / 10)));
    localItems = await fetchGoogleSearchPage(params, params.integrationEnv, {
      startPage: 1,
      pages,
      limit: 10,
      context: [{ key: 'tbm', value: 'lcl' }],
    });
  } catch (err) {
    console.warn('[oxylabsGoogleLocal] Local tab search failed, trying standard SERP:', err.message);
  }

  if (!localItems.length) {
    localItems = await fetchGoogleSearchPage(params, params.integrationEnv, {
      startPage: 1,
      pages: Math.min(3, Math.max(1, Math.ceil(cap / 10))),
      limit: 10,
    });
  }

  let out = localItems.map((item) => normalizeLocalItem(item, ctx));
  out = mergeRows([], out, cap);

  if (!out.length) {
    throw new Error(
      `Oxylabs returned no local businesses for "${params.keyword}" in ${params.city}, ${params.state}.`
    );
  }

  return out.slice(0, cap);
}

module.exports = {
  isConfigured,
  searchGoogleMaps,
  normalizeLocalItem,
};
