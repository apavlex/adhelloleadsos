const { runActor } = require('../apifyClient');
const { facebookCitySlug } = require('../locationSlugs');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'parseforge/facebook-marketplace-scraper';

function actorId() {
  return (process.env.APIFY_FACEBOOK_MARKETPLACE_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function normalizeItem(item, { city, state }) {
  const url = item.listingUrl || item.url || item.link || '';
  const id = String(item.listingId || item.id || url || '').trim();
  const re = item.realEstate || item.real_estate || {};
  return normalizeListingRow({
    source: 'facebook_marketplace',
    sourceId: id,
    title: item.title || item.name,
    price: item.price ?? item.priceAmount ?? item.currentPrice,
    url,
    description: item.description || '',
    city: item.city || city,
    state: state,
    address: item.location || re.address || '',
    sellerName: item.sellerName || item.seller || '',
    postedAt: item.listedAt || item.datePosted,
    beds: re.bedrooms ?? item.bedrooms,
    baths: re.bathrooms ?? item.bathrooms,
    sqft: re.squareFootage ?? item.squareFootage,
    propertyType: re.propertyType || item.propertyType || 'mobile_home',
    imageUrl: item.primaryPhoto || item.image || (Array.isArray(item.images) ? item.images[0] : ''),
  });
}

async function searchFacebookMarketplace({
  city,
  state,
  query,
  maxResults,
  integrationEnv,
}) {
  const slug = facebookCitySlug(city, state);
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const searchTerm = String(query || 'mobile home').trim() || 'mobile home';

  const input = {
    searchQueries: [{ city: slug, query: searchTerm }],
    maxItems: cap,
  };

  const items = await runActor(integrationEnv, actorId(), input, 'FACEBOOK');
  return items
    .filter((item) => {
      const lt = String(item.listingType || item.type || '').toLowerCase();
      if (lt && !lt.includes('home') && lt !== 'rental' && lt !== 'product') return true;
      if (lt === 'vehicle') return false;
      return true;
    })
    .map((item) => normalizeItem(item, { city, state }));
}

module.exports = {
  id: 'facebook_marketplace',
  label: 'Facebook Marketplace',
  isConfigured,
  search: searchFacebookMarketplace,
};
