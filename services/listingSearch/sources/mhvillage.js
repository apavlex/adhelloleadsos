const { runActor } = require('../apifyClient');
const { normalizeListingRow, parsePrice } = require('../normalize');

const DEFAULT_ACTOR = 'piotrv1001/mhvillage-listings-scraper';

function actorId() {
  return (process.env.APIFY_MHVILLAGE_ACTOR_ID || DEFAULT_ACTOR).trim();
}

function isConfigured(integrationEnv) {
  const { isApifyConfigured } = require('../apifyClient');
  return isApifyConfigured(integrationEnv);
}

function stateCode(state) {
  return String(state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

function normalizeItem(item, { city, state }) {
  const addr = item.address && typeof item.address === 'object' ? item.address : {};
  const street = addr.street || item.street || item.addressLine || '';
  const listingCity = addr.city || item.city || city || '';
  const listingState = addr.state || item.state || state || '';
  const zip = addr.zip || addr.zipCode || item.zip || '';
  const fullAddress = [street, listingCity, listingState, zip].filter(Boolean).join(', ');
  const url = item.url || item.listingUrl || item.detailUrl || '';
  const id = String(item.id || item.listingId || url || '').trim();

  return normalizeListingRow({
    source: 'mhvillage',
    sourceId: id,
    title: item.title || item.name || `${item.year || ''} ${item.make || ''} ${item.model || ''}`.trim() || fullAddress,
    price: item.price ?? item.askingPrice ?? item.listPrice,
    url,
    description: item.description || '',
    city: listingCity,
    state: listingState,
    address: fullAddress || listingCity,
    postalCode: zip,
    phone: item.phone || item.dealerPhone,
    sellerName: item.dealerName || item.communityName || '',
    beds: item.beds ?? item.bedrooms,
    baths: item.baths ?? item.bathrooms,
    sqft: item.sqft ?? item.squareFeet,
    propertyType: 'mobile_home',
    imageUrl: Array.isArray(item.photos) && item.photos[0] ? item.photos[0] : item.photo,
  });
}

async function searchMhvillage({ city, state, maxResults, minPrice, maxPrice, integrationEnv, zipCode, radiusMiles }) {
  const cap = Math.max(1, parseInt(maxResults, 10) || 20);
  const st = stateCode(state);
  if (!st) throw new Error('State is required for MHVillage search (2-letter code).');

  const input = {
    state: st,
    maxItems: cap,
  };
  if (zipCode) {
    input.zipCode = String(zipCode).trim();
    input.radiusMiles = Math.max(1, parseInt(radiusMiles, 10) || 50);
  }

  const items = await runActor(integrationEnv, actorId(), input, 'MHVILLAGE');
  let rows = items.map((item) => normalizeItem(item, { city, state: st }));

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

  if (city) {
    const cityLower = String(city).toLowerCase();
    rows = rows.filter((row) => {
      const c = String(row.city || '').toLowerCase();
      return !c || c.includes(cityLower) || cityLower.includes(c);
    });
  }

  return rows.slice(0, cap);
}

module.exports = {
  id: 'mhvillage',
  label: 'MHVillage',
  isConfigured,
  requiresLocation: true,
  search: searchMhvillage,
};
