const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'piotrv1001/offerup-listings-scraper';

function actorId() {
  return (process.env.APIFY_OFFERUP_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function normalizeItem(item, { city, state }) {
  const url = item.url || item.listingUrl || item.link || '';
  const id = String(item.id || item.listingId || url || '').trim();
  const loc = item.locationName || item.location || '';
  return normalizeListingRow({
    source: 'offerup',
    sourceId: id,
    title: item.title || item.name,
    price: item.price ?? item.priceValue,
    url,
    description: item.description || '',
    city: city || loc,
    state,
    address: loc,
    sellerName: item.sellerName || item.seller || '',
    postedAt: item.postDate || item.postedAt,
    propertyType: 'mobile_home',
    imageUrl: Array.isArray(item.images) && item.images[0] ? item.images[0] : item.imageUrl,
  });
}

async function searchOfferup({
  city,
  state,
  query,
  maxResults,
  minPrice,
  maxPrice,
  integrationEnv,
  radiusMiles,
}) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const searchTerm = String(query || 'mobile home').trim() || 'mobile home';
  const location = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');

  const input = {
    query: searchTerm,
    maxItems: cap,
    radiusMiles: Math.max(1, Math.min(500, parseInt(radiusMiles, 10) || 100)),
    scrapeDetails: false,
  };
  if (location) input.location = location;

  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.priceMin = min;
  if (max) input.priceMax = max;

  const items = await runActor(integrationEnv, actorId(), input, 'OFFERUP');
  return items.map((item) => normalizeItem(item, { city, state })).slice(0, cap);
}

module.exports = {
  id: 'offerup',
  label: 'OfferUp',
  isConfigured,
  search: searchOfferup,
};
