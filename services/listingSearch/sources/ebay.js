const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'parseforge/ebay-scraper';

function actorId() {
  return (process.env.APIFY_EBAY_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function normalizeItem(item, { city, state, query }) {
  const url = item.url || item.link || item.itemUrl || '';
  const id = String(item.itemId || item.id || url || '').trim();
  const loc = item.location || item.itemLocation || '';
  return normalizeListingRow({
    source: 'ebay',
    sourceId: id,
    title: item.title || item.name || query,
    price: item.price ?? item.priceValue ?? item.currentPrice,
    url,
    description: item.description || item.subtitle || '',
    city: city || loc,
    state,
    address: loc,
    sellerName: item.seller || item.sellerName || '',
    propertyType: 'mobile_home',
    imageUrl: item.image || item.imageUrl || (Array.isArray(item.images) ? item.images[0] : ''),
  });
}

async function searchEbay({ city, state, query, maxResults, minPrice, maxPrice, integrationEnv }) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const baseQ = String(query || 'mobile home').trim() || 'mobile home';
  const loc = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(' ');
  const searchQuery = loc ? `${baseQ} ${loc}` : baseQ;

  const input = {
    searchQuery,
    maxItems: cap,
  };
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.minPrice = min;
  if (max) input.maxPrice = max;

  const items = await runActor(integrationEnv, actorId(), input, 'EBAY');
  return items.map((item) => normalizeItem(item, { city, state, query: searchQuery })).slice(0, cap);
}

module.exports = {
  id: 'ebay',
  label: 'eBay',
  isConfigured,
  search: searchEbay,
};
