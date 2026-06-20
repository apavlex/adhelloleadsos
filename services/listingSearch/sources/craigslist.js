const { runActor } = require('../apifyClient');
const { craigslistCitySlug } = require('../locationSlugs');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'automation-lab/craigslist-scraper';

function actorId() {
  return (process.env.APIFY_CRAIGSLIST_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function normalizeItem(item, { city, state, query }) {
  const url = item.url || item.link || item.postUrl || '';
  const id = String(item.id || item.postId || url || '').trim();
  return normalizeListingRow({
    source: 'craigslist',
    sourceId: id,
    title: item.title || item.name || query,
    price: item.price ?? item.priceValue,
    url,
    description: item.description || item.body || '',
    city: item.city || city,
    state: state,
    address: item.location || item.address || item.neighborhood || '',
    phone: item.phone || item.contactPhone,
    email: item.email,
    postedAt: item.date || item.postedAt || item.datetime,
    beds: item.bedrooms,
    baths: item.bathrooms,
    sqft: item.sqft || item.squareFeet,
    propertyType: 'mobile_home',
    imageUrl: Array.isArray(item.images) && item.images[0] ? item.images[0] : item.image,
  });
}

async function searchCraigslist({
  city,
  state,
  query,
  maxResults,
  minPrice,
  maxPrice,
  integrationEnv,
  category = 'housing',
}) {
  const slug = craigslistCitySlug(city, state);
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const searchTerm = String(query || 'mobile home').trim() || 'mobile home';

  const input = {
    searchQueries: [searchTerm],
    city: slug,
    category,
    maxResults: cap,
    includeDetails: false,
  };
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (min) input.minPrice = min;
  if (max) input.maxPrice = max;

  const items = await runActor(integrationEnv, actorId(), input, 'CRAIGSLIST');
  return items.map((item) => normalizeItem(item, { city, state, query: searchTerm }));
}

module.exports = {
  id: 'craigslist',
  label: 'Craigslist',
  isConfigured,
  search: searchCraigslist,
};
