/**
 * Real estate listings via Oxylabs google_search (Zillow / Realtor / Redfin organic URLs).
 */

const oxylabs = require('./oxylabsClient');

function parsePriceFromText(text) {
  if (!text) return null;
  const m = String(text).match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseBedsBaths(text) {
  const s = String(text || '');
  const beds = s.match(/(\d+)\s*(?:bd|bed|br|bedroom)/i);
  const baths = s.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath|bathroom)/i);
  return {
    beds: beds ? parseInt(beds[1], 10) : null,
    baths: baths ? parseFloat(baths[1]) : null,
  };
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isRealEstateListingUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http')) return false;
  const hosts = [
    'zillow.com',
    'realtor.com',
    'redfin.com',
    'trulia.com',
    'homes.com',
    'landwatch.com',
    'landandfarm.com',
  ];
  if (!hosts.some((h) => u.includes(h))) return false;
  const hints = ['homedetails', 'for_sale', 'for-sale', '/home/', '/property/', '/realestate/', '/homes/'];
  return hints.some((h) => u.includes(h));
}

function normalizeOrganicListing(result, { city, state }) {
  const { normalizeListing } = require('./realEstateSearch');
  const url = result.url || result.link || '';
  const title = result.title || result.name || url;
  const snippet = result.desc || result.description || result.snippet || '';
  const price = parsePriceFromText(`${title} ${snippet}`);
  const { beds, baths } = parseBedsBaths(`${title} ${snippet}`);
  const host = hostFromUrl(url);

  const item = {
    url,
    address: title.split('|')[0].trim(),
    price,
    beds,
    baths,
    homeType: host.includes('zillow') ? 'Zillow listing' : 'Listing',
    status: 'for_sale',
  };

  const row = normalizeListing(item, { city, state });
  row.realEstate = {
    ...(row.realEstate || {}),
    source: `oxylabs_${host.split('.')[0] || 'web'}`,
    snippet,
  };
  return row;
}

function isConfigured(integrationEnv) {
  return oxylabs.isConfigured(integrationEnv);
}

/**
 * @param {Object} params
 */
async function searchListings({ city, state, maxResults, minPrice, maxPrice, query, integrationEnv }) {
  const cap = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const loc = [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
  const terms = String(query || 'homes for sale').trim() || 'homes for sale';
  const searchQuery = `${terms} ${loc} (site:zillow.com OR site:realtor.com OR site:redfin.com)`;

  const payload = {
    source: 'google_search',
    query: searchQuery,
    domain: 'com',
    geo_location: oxylabs.geoLocationForCityState(city, state),
    parse: true,
    pages: Math.min(5, Math.max(1, Math.ceil(cap / 10))),
    limit: 10,
  };

  const data = await oxylabs.postQuery(payload, integrationEnv, { timeoutMs: 90000 });
  const rows = oxylabs.resultRows(data);
  let listings = [];

  for (const row of rows) {
    const content = oxylabs.extractContent(row);
    const parsed = oxylabs.parsedGoogleResults(content);
    const organic = parsed && Array.isArray(parsed.organic) ? parsed.organic : [];
    for (const item of organic) {
      const url = item.url || item.link;
      if (!isRealEstateListingUrl(url)) continue;
      listings.push(normalizeOrganicListing(item, { city, state }));
      if (listings.length >= cap) break;
    }
    if (listings.length >= cap) break;
  }

  listings = require('./realEstateSearch').applyPriceFilters(listings, { minPrice, maxPrice });

  if (!listings.length) {
    throw new Error(`Oxylabs returned no real estate listings for ${loc}.`);
  }

  return listings.slice(0, cap);
}

module.exports = {
  isConfigured,
  searchListings,
};
