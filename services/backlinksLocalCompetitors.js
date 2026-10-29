/**
 * Find local business competitors via Google Maps (DataForSEO) for Backlinks picker.
 * Filters out directories / social giants (Facebook, Yelp, etc.).
 */

const dataForSeo = require('./dataForSeoClient');
const { hostKey, isDirectoryOrPlatformDomain } = require('./backlinksParse');
const { flattenSerpItems, extractMapsCompetitors, buildLocationName } = require('./localSeoParse');

function cleanDomain(raw) {
  const d = hostKey(raw);
  if (!d || isDirectoryOrPlatformDomain(d)) return '';
  return d;
}

/**
 * @param {object} opts
 * @param {string} opts.keyword — e.g. "flooring Camas WA"
 * @param {string} [opts.city]
 * @param {string} [opts.state]
 * @param {string} [opts.locationName]
 * @param {string} [opts.excludeDomain] — your site
 * @param {string} [opts.businessName] — exclude yourself by name
 * @param {object} opts.integrationEnv
 */
async function searchLocalCompetitors(opts = {}) {
  if (!dataForSeo.isConfigured(opts.integrationEnv)) {
    const err = new Error('Connect DataForSEO in Workspace → Integrations first.');
    err.code = 'DATAFORSEO_NOT_CONFIGURED';
    throw err;
  }
  const keyword = String(opts.keyword || '').trim();
  if (!keyword) {
    const err = new Error('Enter a local search (e.g. “flooring Camas WA”).');
    err.code = 'NO_KEYWORD';
    throw err;
  }
  const locationName =
    String(opts.locationName || '').trim() ||
    buildLocationName({
      city: opts.city,
      state: opts.state,
      country: 'United States',
    });
  const mapsOpts = {
    keyword: keyword.slice(0, 200),
    languageCode: String(opts.languageCode || 'en').slice(0, 8),
    depth: Math.min(40, Math.max(10, Number(opts.depth) || 20)),
    integrationEnv: opts.integrationEnv,
  };
  if (locationName) mapsOpts.locationName = locationName;
  else mapsOpts.locationCode = Number(opts.locationCode) || 2840;
  const mapsJson = await dataForSeo.googleMapsLive(mapsOpts);
  const items = flattenSerpItems(mapsJson);
  const excludeDomain = cleanDomain(opts.excludeDomain);
  const raw = extractMapsCompetitors(
    items,
    { businessName: opts.businessName || '', website: excludeDomain },
    24
  );
  const seen = new Set();
  const results = [];
  for (const row of raw) {
    const domain = cleanDomain(row.domain);
    if (!domain) continue;
    if (excludeDomain && (domain === excludeDomain || domain.endsWith('.' + excludeDomain))) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    results.push({
      title: row.title,
      domain,
      rank: row.rank,
      rating: row.rating,
      votes: row.votes,
      category: row.category || null,
      source: 'google_maps',
    });
    if (results.length >= 16) break;
  }
  return {
    keyword,
    locationName: locationName || null,
    results,
    resultCount: results.length,
  };
}

module.exports = {
  searchLocalCompetitors,
  cleanDomain,
};
