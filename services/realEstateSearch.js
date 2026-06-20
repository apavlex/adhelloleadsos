/**
 * Real estate listings via Apify (default: cirkit/zillow-search-scraper).
 * Accepts city + state and optional price filters; normalizes to lead rows.
 */

const { ApifyClient } = require('apify-client');

const DEFAULT_ACTOR = 'cirkit/zillow-search-scraper';

function apifyToken(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.APIFY_API_TOKEN;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.APIFY_API_TOKEN || '').trim();
}

function actorId() {
  return (process.env.APIFY_REAL_ESTATE_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apifyToken(integrationEnv)) || require('./oxylabsRealEstate').isConfigured(integrationEnv);
}

function clientFor(integrationEnv) {
  const token = apifyToken(integrationEnv);
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not set (workspace integrations or environment).');
  }
  return new ApifyClient({ token });
}

function parsePrice(value) {
  if (value == null || value === '') return null;
  const n = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listingPrice(item) {
  const raw = item.price ?? item.unformattedPrice ?? item.listPrice ?? item.priceValue;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return parsePrice(raw);
}

function normalizeListing(item, { city, state }) {
  const price = listingPrice(item);
  const address =
    item.address ||
    item.streetAddress ||
    item.street ||
    (item.addressStreet && item.addressCity
      ? `${item.addressStreet}, ${item.addressCity}`
      : '') ||
    'N/A';
  const listingCity = item.addressCity || item.city || city || '';
  const listingState = item.addressState || item.state || state || '';
  const zip = item.addressZipcode || item.zipcode || item.postalCode || '';
  const beds = item.beds ?? item.bedrooms ?? item.bedroomCount;
  const baths = item.baths ?? item.bathrooms ?? item.bathroomCount;
  const sqft = item.livingArea ?? item.sqft ?? item.area;
  const url = item.url || item.detailUrl || item.hdpUrl || '';
  const zpid = String(item.zpid || item.id || '').trim();
  const priceLabel = price ? `$${price.toLocaleString()}` : 'Price TBD';
  const bedsBaths =
    beds != null || baths != null
      ? `${beds != null ? beds : '?'}bd · ${baths != null ? baths : '?'}ba`
      : '';

  return {
    title: [address !== 'N/A' ? address : listingCity, priceLabel, bedsBaths].filter(Boolean).join(' · '),
    phone: item.agentPhone || item.brokerPhone || item.phone || 'N/A',
    website: url || 'N/A',
    email: item.agentEmail || item.brokerEmail || item.email || 'N/A',
    categoryName: 'Real Estate',
    address: address !== 'N/A' ? address : `${listingCity}, ${listingState}`.trim(),
    city: listingCity,
    state: listingState,
    postalCode: zip,
    totalScore: 0,
    reviewsCount: 0,
    url,
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    placeId: zpid || undefined,
    sourceType: 'real_estate',
    realEstate: {
      zpid,
      price,
      beds,
      baths,
      sqft,
      status: item.status || item.homeStatus || item.listingStatus || '',
      listDate: item.datePosted || item.listDate || item.timeOnZillow || '',
      brokerName: item.brokerName || item.brokerageName || '',
      agentName: item.agentName || item.listingAgentName || '',
      propertyType: item.homeType || item.propertyType || '',
      lat: item.lat ?? item.latitude,
      lon: item.lng ?? item.longitude,
    },
  };
}

function applyPriceFilters(listings, { minPrice, maxPrice }) {
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (!min && !max) return listings;
  return listings.filter((row) => {
    const p = row.realEstate && row.realEstate.price != null ? row.realEstate.price : listingPrice(row);
    if (p == null) return true;
    if (min && p < min) return false;
    if (max && p > max) return false;
    return true;
  });
}

/**
 * @param {Object} params
 * @param {string} params.city
 * @param {string} params.state
 * @param {number} [params.maxResults]
 * @param {number|string} [params.minPrice]
 * @param {number|string} [params.maxPrice]
 * @param {Record<string,string>} [params.integrationEnv]
 */
async function searchListings({ city, state, maxResults, minPrice, maxPrice, integrationEnv }) {
  const oxylabsRealEstate = require('./oxylabsRealEstate');
  const preferOxylabs =
    String((integrationEnv && integrationEnv.REAL_ESTATE_PRIMARY) || process.env.REAL_ESTATE_PRIMARY || '')
      .trim()
      .toLowerCase() === 'oxylabs';

  if (preferOxylabs && oxylabsRealEstate.isConfigured(integrationEnv)) {
    return oxylabsRealEstate.searchListings({
      city,
      state,
      maxResults,
      minPrice,
      maxPrice,
      integrationEnv,
    });
  }

  if (isConfigured(integrationEnv) && apifyToken(integrationEnv)) {
    try {
      return await searchListingsViaApify({
        city,
        state,
        maxResults,
        minPrice,
        maxPrice,
        integrationEnv,
      });
    } catch (err) {
      if (oxylabsRealEstate.isConfigured(integrationEnv)) {
        console.warn('[REAL-ESTATE] Apify failed, falling back to Oxylabs:', err.message);
        return oxylabsRealEstate.searchListings({
          city,
          state,
          maxResults,
          minPrice,
          maxPrice,
          integrationEnv,
        });
      }
      throw err;
    }
  }

  if (oxylabsRealEstate.isConfigured(integrationEnv)) {
    return oxylabsRealEstate.searchListings({
      city,
      state,
      maxResults,
      minPrice,
      maxPrice,
      integrationEnv,
    });
  }

  throw new Error('Real estate search requires Apify or Oxylabs credentials.');
}

async function searchListingsViaApify({ city, state, maxResults, minPrice, maxPrice, integrationEnv }) {
  const client = clientFor(integrationEnv);
  const cap = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const locationQuery = `${String(city || '').trim()}, ${String(state || '').trim()}`.replace(/^,\s*|,\s*$/g, '').trim();
  if (!locationQuery || locationQuery === ',') {
    throw new Error('City and state are required for real estate search.');
  }

  const input = {
    locationQueries: [locationQuery],
    extractionMethod: 'PAGINATION',
    maxItems: cap,
    maxPagesPerSearch: Math.min(20, Math.max(1, Math.ceil(cap / 41))),
  };

  console.log(`[REAL-ESTATE] Starting Apify actor ${actorId()} for "${locationQuery}" (max ${cap})`);

  const run = await client.actor(actorId()).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`[REAL-ESTATE] Retrieved ${items.length} raw listings.`);

  let normalized = items.map((item) => normalizeListing(item, { city, state }));
  normalized = applyPriceFilters(normalized, { minPrice, maxPrice });
  return normalized.slice(0, cap);
}

module.exports = {
  isConfigured,
  searchListings,
  normalizeListing,
  applyPriceFilters,
};
