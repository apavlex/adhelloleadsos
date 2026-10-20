const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice, mergeListingResults } = require('../normalize');
const listingMarket = require('../../listingMarket');

const DEFAULT_ACTOR = 'automation-lab/realtor-scraper';

function actorId() {
  return (process.env.APIFY_REALTOR_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function matchesQuery(row, query) {
  if (listingMarket.isGenericListingQuery(query)) return true;
  const q = String(query || 'mobile home').toLowerCase();
  const hay = [row.title, row.listing && row.listing.description, row.listing && row.listing.propertyType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return true;
  return q.split(/\s+/).some((t) => hay.includes(t)) || hay.includes('mobile') || hay.includes('manufactured');
}

function normalizeItem(item, { city, state, marketId }) {
  const url = item.url || item.link || item.propertyUrl || '';
  const id = String(item.propertyId || item.listingId || item.id || url || '').trim();
  const addr = item.address || item.streetAddress || item.location || '';
  const status =
    listingMarket.classifyListingStatus(item) ||
    (marketId === 'sold' ? 'sold' : marketId === 'active' ? 'active' : '');
  return normalizeListingRow({
    source: 'realtor',
    sourceId: id,
    title: item.title || item.name || addr,
    price: item.price ?? item.listPrice ?? item.list_price ?? item.soldPrice,
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
    status,
  });
}

async function searchOneMarket({
  city,
  state,
  query,
  maxResults,
  minPrice,
  maxPrice,
  market,
  integrationEnv,
}) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const location = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  if (!location) throw new Error('City and state required for Realtor.com search.');

  const input = {
    location,
    maxResults: Math.min(cap * 3, 200),
    listingType: market.realtorType,
  };
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.minPrice = min;
  if (max) input.maxPrice = max;

  const items = await runActor(integrationEnv, actorId(), input, 'REALTOR');
  return items
    .map((item) => normalizeItem(item, { city, state, marketId: market.id }))
    .filter((row) => matchesQuery(row, query))
    .slice(0, cap);
}

async function searchRealtor(params) {
  const markets = listingMarket.marketsFor(params.listingMarket);
  const per = Math.max(5, Math.ceil((parseInt(params.maxResults, 10) || 20) / markets.length));
  let rows = [];
  for (const market of markets) {
    try {
      const chunk = await searchOneMarket({ ...params, maxResults: per, market });
      rows = mergeListingResults(rows, chunk, parseInt(params.maxResults, 10) || 20);
    } catch (err) {
      console.warn(`[Realtor] ${market.label} failed:`, err.message);
    }
  }
  return rows;
}

module.exports = {
  id: 'realtor',
  label: 'Realtor.com',
  isConfigured,
  requiresLocation: true,
  search: searchRealtor,
};
