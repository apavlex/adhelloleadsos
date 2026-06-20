function parsePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listingDedupeKey(row) {
  const url = String(row.url || row.website || '').trim().toLowerCase().replace(/\/$/, '');
  if (url && url !== 'n/a') return `url:${url}`;
  const src = String(row.listing && row.listing.sourceId || '').trim();
  if (src) return `src:${src}`;
  const title = String(row.title || '').toLowerCase().slice(0, 80);
  const price = row.listing && row.listing.price != null ? row.listing.price : '';
  return `t:${title}|p:${price}`;
}

function mergeListingResults(primary, extra, maxTotal) {
  const cap = Math.max(1, parseInt(maxTotal, 10) || 20);
  const merged = [...(Array.isArray(primary) ? primary : [])];
  const seen = new Set(merged.map(listingDedupeKey));
  for (const row of Array.isArray(extra) ? extra : []) {
    const k = listingDedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
    if (merged.length >= cap) break;
  }
  return merged.slice(0, cap);
}

function applyPriceFilters(listings, { minPrice, maxPrice }) {
  const min = parsePrice(minPrice);
  const max = parsePrice(maxPrice);
  if (!min && !max) return listings;
  return listings.filter((row) => {
    const p = row.listing && row.listing.price != null ? row.listing.price : null;
    if (p == null) return true;
    if (min && p < min) return false;
    if (max && p > max) return false;
    return true;
  });
}

/**
 * Unified listing → lead row (works for Craigslist, FB Marketplace, Zillow, etc.)
 */
function normalizeListingRow({
  source,
  sourceId,
  title,
  price,
  url,
  description,
  city,
  state,
  address,
  postalCode,
  phone,
  email,
  sellerName,
  postedAt,
  beds,
  baths,
  sqft,
  propertyType,
  imageUrl,
  raw,
}) {
  const parsedPrice = parsePrice(price);
  const priceLabel = parsedPrice ? `$${parsedPrice.toLocaleString()}` : 'Price TBD';
  const loc = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  const addr = address || (loc ? loc : 'N/A');
  const displayTitle = [String(title || 'Listing').trim(), priceLabel].filter(Boolean).join(' · ');

  return {
    title: displayTitle,
    phone: phone || 'N/A',
    website: url || 'N/A',
    email: email || 'N/A',
    categoryName: 'Mobile Home',
    address: addr,
    city: city || '',
    state: state || '',
    postalCode: postalCode || '',
    totalScore: 0,
    reviewsCount: 0,
    url: url || '',
    facebook: source === 'facebook_marketplace' && url ? url : 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    placeId: sourceId || undefined,
    sourceType: 'mobile_home_listing',
    listing: {
      source,
      sourceId: sourceId || '',
      price: parsedPrice,
      beds: beds ?? null,
      baths: baths ?? null,
      sqft: sqft ?? null,
      propertyType: propertyType || '',
      description: description || '',
      sellerName: sellerName || '',
      postedAt: postedAt || '',
      imageUrl: imageUrl || '',
      raw: raw ? undefined : undefined,
    },
  };
}

module.exports = {
  parsePrice,
  listingDedupeKey,
  mergeListingResults,
  applyPriceFilters,
  normalizeListingRow,
};
