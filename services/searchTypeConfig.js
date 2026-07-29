/**
 * Search type catalog — UI labels, default scrapers, and Find/Folder wiring.
 */

const { JOB_TYPES } = require('./scrapeJobTypes');

/** Default listing source ids per search type (see listingSearch). */
const DEFAULT_SOURCES = {
  [JOB_TYPES.REAL_ESTATE]: [
    'zillow',
    'realtor',
    'redfin',
    'mhvillage',
    'craigslist',
    'facebook_marketplace',
    'offerup',
    'oxylabs',
    'web_search',
  ],
  [JOB_TYPES.HOME_OWNERS]: ['web_search', 'oxylabs', 'zillow', 'redfin', 'realtor'],
  [JOB_TYPES.PRODUCTS]: ['facebook_marketplace', 'craigslist', 'offerup', 'ebay'],
  [JOB_TYPES.WHOLESALE]: [
    'web_search',
    'oxylabs',
    'facebook_marketplace',
    'craigslist',
    'offerup',
    'ebay',
  ],
};

const SEARCH_TYPES = [
  {
    jobType: JOB_TYPES.MAPS_BUSINESS,
    findTab: 'maps',
    label: 'Business',
    shortLabel: 'Business',
    description: 'Google Maps businesses — enriched with contact data.',
    action: '/search',
    category: 'maps',
    defaultKeyword: 'plumber',
    defaultQuery: '',
    scraperHint:
      'RapidAPI, SearchAPI, SerpAPI, Oxylabs, Outscraper, or Apify Google Local. Add directory supplement for Yelp / Yellow Pages / BBB.',
    defaultMapsProvider: 'auto',
    requiresLocation: true,
  },
  {
    jobType: JOB_TYPES.REAL_ESTATE,
    findTab: 'real_estate',
    label: 'Real estate',
    shortLabel: 'Real estate',
    description: 'Homes, land, and mobile homes — multi-source listings with optional flip scoring.',
    action: '/listings/search',
    category: 'listings',
    defaultKeyword: '',
    defaultQuery: 'homes for sale',
    scraperHint:
      'Zillow, Realtor, Redfin, MHVillage, Craigslist, Facebook, OfferUp, Oxylabs, SerpAPI. Mobile home flip filters available.',
    supportsFlip: true,
    supportsPropertyScraper: true,
    requiresLocation: true,
  },
  {
    jobType: JOB_TYPES.HOME_OWNERS,
    findTab: 'home_owners',
    label: 'Home owners',
    shortLabel: 'Home owners',
    description: 'Property and owner signals — public records, listings, and web intelligence.',
    action: '/listings/search',
    category: 'listings',
    defaultKeyword: '',
    defaultQuery: 'property owner',
    scraperHint:
      'SerpAPI web search + Oxylabs Google for owner/property queries; Zillow, Redfin, Realtor for listing context.',
    requiresLocation: true,
  },
  {
    jobType: JOB_TYPES.PRODUCTS,
    findTab: 'products',
    label: 'Products',
    shortLabel: 'Products',
    description: 'Marketplace listings — Facebook, Craigslist, OfferUp, eBay.',
    action: '/listings/search',
    category: 'listings',
    defaultKeyword: '',
    defaultQuery: '',
    scraperHint: 'Facebook Marketplace, Craigslist, OfferUp, and eBay. Best for used goods and local inventory.',
    requiresLocation: false,
  },
  {
    jobType: JOB_TYPES.WHOLESALE,
    findTab: 'wholesale',
    label: 'Wholesale',
    shortLabel: 'Wholesale',
    description: 'Bulk suppliers and wholesale listings across marketplaces and web search.',
    action: '/listings/search',
    category: 'listings',
    defaultKeyword: '',
    defaultQuery: 'wholesale',
    scraperHint:
      'Web search + Oxylabs for supplier discovery; Facebook, Craigslist, OfferUp, eBay for bulk listings. Use Business search for wholesale storefronts on Maps.',
    requiresLocation: false,
  },
  {
    jobType: JOB_TYPES.PERMITS,
    findTab: 'permits',
    label: 'Permits',
    shortLabel: 'Permits',
    description: 'Recent building permits by city and trade — contractors and property projects from Permit Stack.',
    action: '/permits/search',
    category: 'permits',
    defaultKeyword: 'roofing',
    defaultQuery: 'roofing',
    scraperHint: 'Permit Stack API — roofing, HVAC, solar, plumbing, and more. Requires PERMITSTACK_API_KEY in Workspace → Integrations.',
    requiresLocation: true,
  },
];

const BY_JOB_TYPE = SEARCH_TYPES.reduce((acc, row) => {
  acc[row.jobType] = row;
  return acc;
}, {});

const BY_FIND_TAB = SEARCH_TYPES.reduce((acc, row) => {
  acc[row.findTab] = row;
  return acc;
}, {});

/** Legacy find tabs → job type */
const LEGACY_FIND_TAB = {
  maps: JOB_TYPES.MAPS_BUSINESS,
  business: JOB_TYPES.MAPS_BUSINESS,
  mobile_homes: JOB_TYPES.REAL_ESTATE,
  mobilehomes: JOB_TYPES.REAL_ESTATE,
  mobile: JOB_TYPES.REAL_ESTATE,
};

function resolveFindTab(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (BY_FIND_TAB[v]) return v;
  if (LEGACY_FIND_TAB[v]) {
    const jt = LEGACY_FIND_TAB[v];
    return (BY_JOB_TYPE[jt] && BY_JOB_TYPE[jt].findTab) || 'maps';
  }
  return 'maps';
}

function findTabForJobType(jobType) {
  const row = BY_JOB_TYPE[jobType];
  return row ? row.findTab : 'maps';
}

function configForJobType(jobType) {
  return BY_JOB_TYPE[jobType] || BY_JOB_TYPE[JOB_TYPES.MAPS_BUSINESS];
}

function defaultSourcesForJobType(jobType) {
  return DEFAULT_SOURCES[jobType] || listingSearchDefaultAll();
}

function listingSearchDefaultAll() {
  const listingSearch = require('./listingSearch');
  return listingSearch.ALL_SOURCES.map((s) => s.id);
}

function isListingJobType(jobType) {
  const row = BY_JOB_TYPE[jobType];
  return row && row.category === 'listings';
}

function findTabRequiresLocation(findTab) {
  const row = BY_FIND_TAB[findTab];
  return row ? row.requiresLocation !== false : true;
}

function jobTypeRequiresLocation(jobType) {
  const row = BY_JOB_TYPE[jobType];
  return row ? row.requiresLocation !== false : true;
}

module.exports = {
  SEARCH_TYPES,
  DEFAULT_SOURCES,
  BY_JOB_TYPE,
  BY_FIND_TAB,
  resolveFindTab,
  findTabForJobType,
  configForJobType,
  defaultSourcesForJobType,
  isListingJobType,
  findTabRequiresLocation,
  jobTypeRequiresLocation,
};
