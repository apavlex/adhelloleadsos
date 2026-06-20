const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'h4sh/redfin-scraper';

function actorId() {
  return (process.env.APIFY_REDFIN_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function matchesQuery(row, query) {
  const q = String(query || 'mobile home').toLowerCase();
  const hay = [row.title, row.listing && row.listing.description, row.listing && row.listing.propertyType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return true;
  return q.split(/\s+/).some((t) => hay.includes(t)) || hay.includes('mobile') || hay.includes('manufactured');
}

function normalizeItem(item, { city, state }) {
  const url = item.url || item.link || item.redfinUrl || '';
  const id = String(item.propertyId || item.listingId || item.id || url || '').trim();
  const addr = item.address || item.streetAddress || item.streetLine || '';
  return normalizeListingRow({
    source: 'redfin',
    sourceId: id,
    title: addr || item.title || item.name,
    price: item.price ?? item.listPrice ?? item.priceInfo?.amount,
    url,
    description: item.description || '',
    city: item.city || city,
    state: item.state || state,
    address: addr,
    postalCode: item.zip || item.postalCode,
    phone: item.agentPhone || item.phone,
    sellerName: item.agentName || '',
    beds: item.beds ?? item.bedrooms,
    baths: item.baths ?? item.bathrooms,
    sqft: item.sqft ?? item.squareFeet,
    propertyType: item.propertyType || item.homeType || '',
    imageUrl: Array.isArray(item.photos) && item.photos[0] ? item.photos[0] : item.primaryPhoto,
  });
}

async function searchRedfin({ city, state, query, maxResults, minPrice, maxPrice, integrationEnv }) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const location = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  if (!location) throw new Error('City and state required for Redfin search.');

  const input = {
    location,
    maxResults: Math.min(cap * 3, 200),
    listingStatus: 'active',
    propertyType: 'all',
    includeDetails: false,
  };
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.minPrice = min;
  if (max) input.maxPrice = max;

  const items = await runActor(integrationEnv, actorId(), input, 'REDFIN');
  return items
    .map((item) => normalizeItem(item, { city, state }))
    .filter((row) => matchesQuery(row, query))
    .slice(0, cap);
}

module.exports = {
  id: 'redfin',
  label: 'Redfin',
  isConfigured,
  requiresLocation: true,
  search: searchRedfin,
};
