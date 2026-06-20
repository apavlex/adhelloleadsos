const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'cirkit/zillow-search-scraper';

function actorId() {
  return (process.env.APIFY_REAL_ESTATE_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function normalizeZillowItem(item, { city, state, query }) {
  const price = item.price ?? item.unformattedPrice ?? item.listPrice;
  const address =
    item.address ||
    item.streetAddress ||
    (item.addressStreet && item.addressCity ? `${item.addressStreet}, ${item.addressCity}` : '') ||
    '';
  const url = item.url || item.detailUrl || item.hdpUrl || '';
  const zpid = String(item.zpid || item.id || url || '').trim();
  const title = address || `${query} · ${city}, ${state}`;

  return normalizeListingRow({
    source: 'zillow',
    sourceId: zpid,
    title,
    price,
    url,
    city: item.addressCity || item.city || city,
    state: item.addressState || item.state || state,
    address,
    postalCode: item.addressZipcode || item.zipcode,
    phone: item.agentPhone || item.phone,
    email: item.agentEmail || item.email,
    postedAt: item.datePosted || item.listDate,
    beds: item.beds ?? item.bedrooms,
    baths: item.baths ?? item.bathrooms,
    sqft: item.livingArea ?? item.sqft,
    propertyType: item.homeType || item.propertyType || 'mobile_home',
    sellerName: item.agentName || item.brokerName,
  });
}

function matchesMobileHomeQuery(row, query) {
  const q = String(query || 'mobile home').toLowerCase();
  const hay = [
    row.title,
    row.listing && row.listing.description,
    row.listing && row.listing.propertyType,
    row.categoryName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  return (
    terms.some((t) => hay.includes(t)) ||
    hay.includes('manufactured') ||
    hay.includes('mobile') ||
    hay.includes('trailer')
  );
}

async function searchZillow({
  city,
  state,
  query,
  maxResults,
  minPrice,
  maxPrice,
  integrationEnv,
}) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const locationQuery = `${String(city || '').trim()}, ${String(state || '').trim()}`
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
  if (!locationQuery) throw new Error('City and state required for Zillow search.');

  const input = {
    locationQueries: [locationQuery],
    extractionMethod: 'PAGINATION',
    maxItems: Math.min(cap * 3, 120),
    maxPagesPerSearch: Math.min(20, Math.max(1, Math.ceil(cap / 41))),
  };

  const items = await runActor(integrationEnv, actorId(), input, 'ZILLOW');
  let rows = items.map((item) => normalizeZillowItem(item, { city, state, query }));
  rows = rows.filter((row) => matchesMobileHomeQuery(row, query));

  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min || max) {
    rows = rows.filter((row) => {
      const p = row.listing && row.listing.price;
      if (p == null) return true;
      if (min && p < min) return false;
      if (max && p > max) return false;
      return true;
    });
  }

  return rows.slice(0, cap);
}

module.exports = {
  id: 'zillow',
  label: 'Zillow',
  isConfigured,
  requiresLocation: true,
  search: searchZillow,
};
