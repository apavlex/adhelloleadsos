const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'automation-lab/realtor-scraper';

function actorId() {
  return (process.env.APIFY_REALTOR_ACTOR_ID || DEFAULT_ACTOR).trim();
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
  const url = item.url || item.link || item.propertyUrl || '';
  const id = String(item.propertyId || item.listingId || item.id || url || '').trim();
  const addr = item.address || item.streetAddress || item.location || '';
  return normalizeListingRow({
    source: 'realtor',
    sourceId: id,
    title: item.title || item.name || addr,
    price: item.price ?? item.listPrice ?? item.list_price,
    url,
    description: item.description || '',
    city: item.city || city,
    state: item.state || state,
    address: addr,
    postalCode: item.zip || item.postalCode,
    phone: item.phone || item.agentPhone,
    email: item.agentEmail,
    sellerName: item.agentName || item.brokerName || '',
    beds: item.beds ?? item.bedrooms,
    baths: item.baths ?? item.bathrooms,
    sqft: item.sqft ?? item.squareFeet,
    propertyType: item.propertyType || item.type || '',
    imageUrl: Array.isArray(item.photos) && item.photos[0] ? item.photos[0] : item.photo,
  });
}

async function searchRealtor({ city, state, query, maxResults, minPrice, maxPrice, integrationEnv }) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const location = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  if (!location) throw new Error('City and state required for Realtor.com search.');

  const input = {
    location,
    maxResults: Math.min(cap * 3, 200),
    listingType: 'for_sale',
  };
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.minPrice = min;
  if (max) input.maxPrice = max;

  const items = await runActor(integrationEnv, actorId(), input, 'REALTOR');
  return items
    .map((item) => normalizeItem(item, { city, state }))
    .filter((row) => matchesQuery(row, query))
    .slice(0, cap);
}

module.exports = {
  id: 'realtor',
  label: 'Realtor.com',
  isConfigured,
  requiresLocation: true,
  search: searchRealtor,
};
