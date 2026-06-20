/**
 * Executes scheduled / background scrape jobs by type.
 */

const mapsSearch = require('./mapsSearch');
const directoryLeadSearch = require('./directoryLeadSearch');
const realEstateSearch = require('./realEstateSearch');
const listingSearch = require('./listingSearch');
const { parseFlipFilter, scoreAndFilterListings } = require('./listingFlipScore');
const enricher = require('./enricher');
const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');

async function runMapsBusinessJob(schedule, integrationEnv, options = {}) {
  const wantDirectorySupplement = options.directorySupplement === true;

  let results = await mapsSearch.searchGoogleMaps({
    keyword: schedule.keyword,
    city: schedule.city,
    state: schedule.state,
    maxResults: schedule.maxResults || 20,
    integrationEnv,
    mapsProvider: schedule.mapsProvider || undefined,
  });
  results = mapsSearch.filterMapsResults(results, {
    minRating: schedule.minRating,
    minReviews: schedule.minReviews,
  });

  if (wantDirectorySupplement && results && results.length > 0) {
    try {
      const directoryLeads = await directoryLeadSearch.searchDirectoryLeads({
        keyword: schedule.keyword,
        city: schedule.city,
        state: schedule.state,
        maxResults: Math.min(25, schedule.maxResults || 20),
      });
      results = directoryLeadSearch.mergeMapsAndDirectoryLeads(
        results,
        directoryLeads,
        schedule.maxResults || 20
      );
    } catch (dirErr) {
      console.warn('[SCRAPE-JOB] Directory supplement failed:', dirErr.message);
    }
  }

  if (!results || results.length === 0) {
    throw new Error(
      `No businesses found for "${schedule.keyword}" in ${schedule.city}, ${schedule.state}.`
    );
  }

  results = await enricher.enrichLeads(results, { workspaceId: schedule.workspaceId || 'default' });
  return results;
}

async function runListingJob(schedule, integrationEnv) {
  if (!listingSearch.isConfigured(integrationEnv)) {
    throw new Error(
      'Listing search requires Apify and/or SerpAPI. Add keys under Workspace → API integrations.'
    );
  }

  const jobType = normalizeJobType(schedule.jobType);
  const scraperMode = String(schedule.scraper || 'listings').toLowerCase();

  if (
    jobType === JOB_TYPES.REAL_ESTATE &&
    (scraperMode === 'apify_zillow' || scraperMode === 'auto')
  ) {
    return runRealEstateJob(schedule, integrationEnv);
  }

  let results = await listingSearch.searchListings({
    city: schedule.city,
    state: schedule.state,
    query: schedule.query || schedule.keyword || 'listings',
    sources: schedule.sources,
    maxResults: schedule.maxResults || 20,
    minPrice: schedule.minPrice,
    maxPrice: schedule.maxPrice,
    integrationEnv,
  });

  if (!results || results.length === 0) {
    throw new Error(
      `No listings found in ${schedule.city}, ${schedule.state}. Try other scrapers or widen filters.`
    );
  }

  const flipFilter = parseFlipFilter(schedule);
  if (jobType === JOB_TYPES.REAL_ESTATE && flipFilter.enabled) {
    const scored = await scoreAndFilterListings(results, flipFilter, {
      city: schedule.city,
      state: schedule.state,
    });
    schedule._flipStats = scored.stats;
    if (!scored.listings.length) {
      const stats = scored.stats || {};
      throw new Error(
        `Found ${stats.inputCount || results.length} listings but none met flip criteria. Try lowering thresholds.`
      );
    }
    results = scored.listings;
  }

  return results;
}

async function runMobileHomesJob(schedule, integrationEnv) {
  return runListingJob({ ...schedule, jobType: JOB_TYPES.REAL_ESTATE }, integrationEnv);
}

async function runRealEstateJob(schedule, integrationEnv) {
  if (!realEstateSearch.isConfigured(integrationEnv)) {
    throw new Error(
      'Real estate search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.'
    );
  }

  let results = await realEstateSearch.searchListings({
    city: schedule.city,
    state: schedule.state,
    maxResults: schedule.maxResults || 20,
    minPrice: schedule.minPrice,
    maxPrice: schedule.maxPrice,
    integrationEnv,
  });

  if (!results || results.length === 0) {
    throw new Error(
      `No listings found in ${schedule.city}, ${schedule.state}. Try widening price filters or another area.`
    );
  }

  return results;
}

/**
 * @param {Object} schedule
 * @param {Record<string,string>} integrationEnv
 * @param {{ directorySupplement?: boolean }} [options]
 */
async function executeScrapeJob(schedule, integrationEnv, options = {}) {
  const jobType = normalizeJobType(schedule.jobType);
  if (
    jobType === JOB_TYPES.REAL_ESTATE ||
    jobType === JOB_TYPES.HOME_OWNERS ||
    jobType === JOB_TYPES.PRODUCTS ||
    jobType === JOB_TYPES.WHOLESALE ||
    jobType === JOB_TYPES.MOBILE_HOMES
  ) {
    return runListingJob(schedule, integrationEnv);
  }
  return runMapsBusinessJob(schedule, integrationEnv, options);
}

function buildSearchRecord(schedule, results, timestampIso) {
  const jobType = normalizeJobType(schedule.jobType);
  const base = {
    jobType,
    city: schedule.city,
    state: schedule.state,
    maxResults: schedule.maxResults || 20,
    targetFolderKey: schedule.targetFolderKey || '',
    targetFolderName: schedule.targetFolderName || '',
    resultCount: results.length,
    results,
    isAutopilot: true,
    timestamp: timestampIso,
    workspaceId: schedule.workspaceId || 'default',
  };

  if (
    jobType === JOB_TYPES.REAL_ESTATE ||
    jobType === JOB_TYPES.HOME_OWNERS ||
    jobType === JOB_TYPES.PRODUCTS ||
    jobType === JOB_TYPES.WHOLESALE ||
    jobType === JOB_TYPES.MOBILE_HOMES
  ) {
    const flipFilter = parseFlipFilter(schedule);
    const q = schedule.query || schedule.keyword || 'listings';
    const label =
      jobType === JOB_TYPES.HOME_OWNERS
        ? 'Home owners'
        : jobType === JOB_TYPES.PRODUCTS
          ? 'Products'
          : jobType === JOB_TYPES.WHOLESALE
            ? 'Wholesale'
            : 'Real estate';
    const record = {
      ...base,
      keyword: `${q} · ${schedule.city}, ${schedule.state}`,
      query: q,
      sources: schedule.sources || listingSearch.ALL_SOURCES.map((s) => s.id),
      minPrice: schedule.minPrice || null,
      maxPrice: schedule.maxPrice || null,
      flipFilter: flipFilter.enabled ? flipFilter : null,
      scraper: schedule.scraper || null,
    };
    if (schedule._flipStats) record.flipStats = schedule._flipStats;
    if (jobType !== JOB_TYPES.REAL_ESTATE) {
      record.keyword = `${label}: ${q} · ${schedule.city}, ${schedule.state}`;
    }
    return record;
  }

  return {
    ...base,
    keyword: schedule.keyword,
  };
}

function isJobConfigured(schedule, integrationEnv) {
  const jobType = normalizeJobType(schedule.jobType);
  if (
    jobType === JOB_TYPES.REAL_ESTATE ||
    jobType === JOB_TYPES.HOME_OWNERS ||
    jobType === JOB_TYPES.PRODUCTS ||
    jobType === JOB_TYPES.WHOLESALE ||
    jobType === JOB_TYPES.MOBILE_HOMES
  ) {
    return listingSearch.isConfigured(integrationEnv) || realEstateSearch.isConfigured(integrationEnv);
  }
  return mapsSearch.isMapsSearchConfigured(integrationEnv);
}

module.exports = {
  executeScrapeJob,
  buildSearchRecord,
  isJobConfigured,
  runMapsBusinessJob,
  runRealEstateJob,
  runMobileHomesJob,
  runListingJob,
};
