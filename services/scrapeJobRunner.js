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

async function runMobileHomesJob(schedule, integrationEnv) {
  if (!listingSearch.isConfigured(integrationEnv)) {
    throw new Error(
      'Mobile home search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.'
    );
  }

  let results = await listingSearch.searchListings({
    city: schedule.city,
    state: schedule.state,
    query: schedule.query || 'mobile home',
    sources: schedule.sources,
    maxResults: schedule.maxResults || 20,
    minPrice: schedule.minPrice,
    maxPrice: schedule.maxPrice,
    integrationEnv,
  });

  if (!results || results.length === 0) {
    throw new Error(
      `No mobile home listings found in ${schedule.city}, ${schedule.state}. Try other sources or widen filters.`
    );
  }

  const flipFilter = parseFlipFilter(schedule);
  if (flipFilter.enabled) {
    const scored = await scoreAndFilterListings(results, flipFilter, {
      city: schedule.city,
      state: schedule.state,
    });
    schedule._flipStats = scored.stats;
    if (!scored.listings.length) {
      const stats = scored.stats || {};
      throw new Error(
        `Found ${stats.inputCount || results.length} listings but none met flip criteria (min score ${flipFilter.minFlipScore}, min ROI ${flipFilter.minRoiPercent}%). Try lowering thresholds or disabling "Flip deals only".`
      );
    }
    results = scored.listings;
  }

  return results;
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
  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    return runMobileHomesJob(schedule, integrationEnv);
  }
  if (jobType === JOB_TYPES.REAL_ESTATE) {
    return runRealEstateJob(schedule, integrationEnv);
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

  if (jobType === JOB_TYPES.MOBILE_HOMES) {
    const flipFilter = parseFlipFilter(schedule);
    const record = {
      ...base,
      keyword: `${schedule.query || 'mobile home'} · ${schedule.city}, ${schedule.state}`,
      query: schedule.query || 'mobile home',
      sources: schedule.sources || listingSearch.ALL_SOURCES.map((s) => s.id),
      minPrice: schedule.minPrice || null,
      maxPrice: schedule.maxPrice || null,
      flipFilter: flipFilter.enabled ? flipFilter : null,
    };
    if (schedule._flipStats) {
      record.flipStats = schedule._flipStats;
    }
    return record;
  }

  if (jobType === JOB_TYPES.REAL_ESTATE) {
    return {
      ...base,
      keyword: `Real estate · ${schedule.city}, ${schedule.state}`,
      minPrice: schedule.minPrice || null,
      maxPrice: schedule.maxPrice || null,
    };
  }

  return {
    ...base,
    keyword: schedule.keyword,
  };
}

function isJobConfigured(schedule, integrationEnv) {
  const jobType = normalizeJobType(schedule.jobType);
  if (jobType === JOB_TYPES.MOBILE_HOMES || jobType === JOB_TYPES.REAL_ESTATE) {
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
};
