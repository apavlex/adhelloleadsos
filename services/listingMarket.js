/**
 * Real-estate listing market: active (for sale), recently sold, or both.
 */

const MARKETS = {
  active: {
    id: 'active',
    label: 'Active for sale',
    defaultQuery: 'homes for sale',
    zillowPath: '',
    realtorType: 'for_sale',
    redfinStatus: 'active',
    oxylabsTerms: 'homes for sale',
    outscraperFilter: 'for_sale',
  },
  sold: {
    id: 'sold',
    label: 'Recently sold',
    defaultQuery: 'recently sold homes',
    zillowPath: 'sold/',
    realtorType: 'sold',
    redfinStatus: 'sold',
    oxylabsTerms: 'recently sold homes',
    outscraperFilter: 'sold',
  },
};

/** @returns {'active'|'sold'|'both'} */
function normalizeListingMarket(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'sold' || v === 'recently_sold' || v === 'recently-sold') return 'sold';
  if (v === 'active' || v === 'for_sale' || v === 'for-sale' || v === 'sale') return 'active';
  if (v === 'both' || v === 'all' || v === 'active_and_sold') return 'both';
  // Default: active + recently sold (product ask).
  return 'both';
}

function listingMarketLabel(value) {
  const m = normalizeListingMarket(value);
  if (m === 'both') return 'Active + recently sold';
  return MARKETS[m].label;
}

function marketsFor(value) {
  const m = normalizeListingMarket(value);
  if (m === 'both') return [MARKETS.active, MARKETS.sold];
  return [MARKETS[m]];
}

/** True for generic sale/sold queries — do not keyword-filter listing titles. */
function isGenericListingQuery(query) {
  const q = String(query || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  if (!q) return true;
  // Property-type searches still filter titles (mobile home, land, etc.).
  if (/\b(mobile|manufactured|trailer|land|acre|condo|townhome|fixer|duplex|triplex)\b/.test(q)) {
    return false;
  }
  return /for\s+sale|recently\s+sold|\bsold\b|^homes?$|^listings?$|^properties$/.test(q);
}

function zillowLocationSlug(city, state) {
  const c = String(city || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const s = String(state || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 2);
  if (!c || !s) return '';
  return `${c}-${s}`;
}

/** Apify cirkit/zillow-search-scraper searchUrls for the chosen market(s). */
function zillowSearchUrls(city, state, listingMarket) {
  const slug = zillowLocationSlug(city, state);
  if (!slug) return [];
  return marketsFor(listingMarket).map((m) => ({
    url: `https://www.zillow.com/${slug}/${m.zillowPath}`,
    market: m.id,
  }));
}

function defaultQueryForMarket(listingMarket) {
  const m = normalizeListingMarket(listingMarket);
  if (m === 'both') return 'homes for sale and recently sold';
  return MARKETS[m].defaultQuery;
}

function classifyListingStatus(raw) {
  const s = [
    raw && raw.statusType,
    raw && raw.statusText,
    raw && raw.marketingStatusSimplifiedCd,
    raw && raw.rawHomeStatusCd,
    raw && raw.status,
    raw && raw.homeStatus,
    raw && raw.listingStatus,
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  if (/recently[_\s-]?sold|\bsold\b/.test(s)) return 'sold';
  if (/for[_\s-]?sale|active|coming[_\s-]?soon|pending|contingent/.test(s)) return 'active';
  return '';
}

module.exports = {
  MARKETS,
  normalizeListingMarket,
  listingMarketLabel,
  marketsFor,
  isGenericListingQuery,
  zillowLocationSlug,
  zillowSearchUrls,
  defaultQueryForMarket,
  classifyListingStatus,
};
