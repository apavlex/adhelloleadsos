/**
 * Background runs for non-Maps lead sources (building permits, new business formations, contractor licenses).
 * Shared by the Find Leads form routes and the AI connector tools.
 * Resolvers validate input and return { ok:false, status, error } or the resolved run.
 */
const dbService = require('./database');
const permitStackClient = require('./permitStackClient');
const { normalizePermitCategory } = require('./permitStackCategories');
const { normalizePermitStackCity } = require('./permitStackCities');
const { permitsToLeads } = require('./permitLeadEnrich');
const businessFormationSearch = require('./businessFormationSearch');
const { persistFormationSearchResults } = require('./businessFormationPersist');
const { persistContractorRecords } = require('./contractorLeadPersist');
const {
  parseContractorSearchInput,
  collectContractorRecords,
  keywordLabel,
  recordToLead,
  placesKeyFromEnv,
} = require('./contractorRegistry');
const { resolveTargetFolder, leadMetadataForJobType } = require('./pipelineFolders');
const { JOB_TYPES } = require('./scrapeJobTypes');
const activationService = require('./activationService');

const FORMATIONS_NOT_CONFIGURED =
  'Business formation search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.';

async function recordSearchSaved(actorEmail) {
  if (actorEmail) await activationService.recordEvent(actorEmail, 'search_saved');
}

/**
 * @param {object} input city, state, category, keyword, contractor, zip, filedAfter, maxResults, folderKey, newFolderName
 */
async function resolvePermitSearch(workspaceId, input, integrationEnv) {
  if (!permitStackClient.isConfigured(integrationEnv)) {
    return {
      ok: false,
      status: 503,
      error: 'Permit Stack is not configured. Add your API key under Workspace → Integrations → Permit Stack.',
    };
  }

  let city = String(input.city || '').trim();
  let state = String(input.state || '').trim();
  const knownCity = normalizePermitStackCity(city);
  if (knownCity) {
    city = knownCity.city;
    if (knownCity.state) state = knownCity.state;
  } else if (city) {
    return {
      ok: false,
      status: 400,
      error: `"${city}" is not a supported Permit Stack city. Go to Find Leads → Permits and choose a city from the dropdown (804 supported jurisdictions).`,
    };
  }
  const params = {
    city,
    state,
    zip: String(input.zip || '').trim(),
    category: normalizePermitCategory(input.category),
    keyword: String(input.keyword || '').trim(),
    contractor: String(input.contractor || '').trim(),
    filedAfter: String(input.filedAfter || '').trim(),
    maxResults: Math.min(100, Math.max(1, parseInt(input.maxResults, 10) || 25)),
  };
  if (!params.city && !params.zip) {
    return { ok: false, status: 400, error: 'City or ZIP code is required for permit search.' };
  }

  const folder = await resolveTargetFolder(workspaceId, {
    folderKey: input.folderKey,
    newFolderName: input.newFolderName,
    jobType: JOB_TYPES.PERMITS,
    category: params.category,
    city: params.city,
  });
  if (folder.error) return { ok: false, status: 400, error: folder.error };

  return { ok: true, params, folder };
}

async function runPermitSearchInBackground({ workspaceId: wid, integrationEnv, params, folder, actorEmail }) {
  await dbService.setActiveJob({
    workspaceId: wid,
    type: 'permits_search',
    jobType: JOB_TYPES.PERMITS,
    city: params.city,
    state: params.state,
    category: params.category,
    keyword: params.keyword,
    contractor: params.contractor,
    zip: params.zip,
    filed_after: params.filedAfter,
    maxResults: params.maxResults,
    targetFolderKey: folder.targetFolderKey,
    targetFolderName: folder.targetFolderName,
  });

  setImmediate(async () => {
    try {
      const searchResult = await permitStackClient.searchPermitsWithFallback(
        {
          city: params.city,
          state: params.state,
          category: params.category,
          keyword: params.keyword,
          contractor_name: params.contractor,
          zip: params.zip,
          filed_after: params.filedAfter,
          per_page: params.maxResults,
        },
        integrationEnv
      );

      const leadRows = permitsToLeads(searchResult.results, {
        workspaceId: wid,
        city: params.city,
        state: params.state,
        category: params.category,
        folderKey: folder.targetFolderKey,
      });

      let savedCount = 0;
      for (const row of leadRows) {
        const meta = leadMetadataForJobType(JOB_TYPES.PERMITS, { folderKey: folder.targetFolderKey });
        // eslint-disable-next-line no-await-in-loop
        const result = await dbService.saveLeadWithMeta({ ...row, ...meta, workspaceId: wid });
        if (!result.merged) savedCount += 1;
      }

      const searchKey = await dbService.saveSearch({
        jobType: JOB_TYPES.PERMITS,
        keyword: params.category || params.keyword,
        category: params.category,
        permitKeyword: params.keyword,
        permitContractor: params.contractor,
        zip: params.zip,
        filedAfter: params.filedAfter,
        city: params.city,
        state: params.state,
        maxResults: params.maxResults,
        targetFolderKey: folder.targetFolderKey,
        targetFolderName: folder.targetFolderName,
        resultCount: leadRows.length,
        savedCount,
        totalAvailable: searchResult.total,
        totalCapped: searchResult.totalCapped,
        relaxedFilters: searchResult.relaxedFilters || false,
        zeroWithOptionalFilters: searchResult.zeroWithOptionalFilters || false,
        results: leadRows,
        timestamp: new Date().toISOString(),
        workspaceId: wid,
      });
      await recordSearchSaved(actorEmail);
      await dbService.clearActiveJob({
        resultCount: leadRows.length,
        savedCount,
        totalAvailable: searchResult.total,
        searchKey,
        relaxedFilters: searchResult.relaxedFilters || false,
        zeroWithOptionalFilters: searchResult.zeroWithOptionalFilters || false,
      });
    } catch (err) {
      console.error('[PERMITS-BG] Permit search failed:', err);
      const msg = err && err.message ? String(err.message) : 'Permit search failed';
      await dbService.clearActiveJob({ failed: true, error: msg });
    }
  });
}

/**
 * @param {object} input body-shaped: formationStates, entityTypes, keyword, registeredAfter, monitorMode, maxResults, folderKey, newFolderName
 * @param {{ monitor?: boolean }} opts monitor forces monitor mode (schedules)
 */
async function resolveFormationSearch(workspaceId, input, integrationEnv, opts = {}) {
  const params = businessFormationSearch.parseSearchParamsFromBody(input);
  if (!params.stateCodes.length) {
    return { ok: false, status: 400, error: 'Select at least one supported state (NY, CO, PA, CT, OR).' };
  }

  const folder = await resolveTargetFolder(workspaceId, {
    folderKey: input.folderKey,
    newFolderName: input.newFolderName,
    jobType: JOB_TYPES.BUSINESS_FORMATIONS,
    state: params.stateCodes.join(','),
  });
  if (folder.error) return { ok: false, status: 400, error: folder.error };

  const monitorMode = opts.monitor ? true : params.monitorMode;
  const searchParams = { ...params, monitorMode, registeredAfterDays: 30 };
  const jobParams = {
    jobType: JOB_TYPES.BUSINESS_FORMATIONS,
    stateCodes: params.stateCodes,
    entityTypes: params.entityTypes,
    formationKeyword: params.keyword,
    keyword: businessFormationSearch.scheduleKeywordLabel(searchParams),
    registeredAfter: params.registeredAfter,
    monitorMode,
    maxResults: params.maxResults,
    targetFolderKey: folder.targetFolderKey,
    targetFolderName: folder.targetFolderName,
    workspaceId,
    city: '',
    state: params.stateCodes.join(', '),
  };

  return {
    ok: true,
    configured: businessFormationSearch.isConfigured(integrationEnv),
    notConfiguredError: FORMATIONS_NOT_CONFIGURED,
    params,
    searchParams,
    jobParams,
    folder,
  };
}

async function runFormationSearchInBackground({ workspaceId: wid, integrationEnv, resolved, actorEmail }) {
  const { params, searchParams, jobParams, folder } = resolved;
  if (!businessFormationSearch.isConfigured(integrationEnv)) {
    await dbService.clearActiveJob({ failed: true, error: FORMATIONS_NOT_CONFIGURED });
    return;
  }

  await dbService.setActiveJob({
    workspaceId: wid,
    type: 'business_formations_search',
    jobType: JOB_TYPES.BUSINESS_FORMATIONS,
    state: jobParams.state,
    keyword: jobParams.keyword,
    maxResults: params.maxResults,
    targetFolderKey: folder.targetFolderKey,
    targetFolderName: folder.targetFolderName,
    formationStates: params.stateCodes,
    monitorMode: searchParams.monitorMode,
  });

  setImmediate(async () => {
    try {
      const { results, input } = await businessFormationSearch.searchBusinessFormations(
        searchParams,
        integrationEnv
      );
      const { savedCount, leadRows } = await persistFormationSearchResults(
        wid,
        { targetFolderKey: folder.targetFolderKey, stateCodes: params.stateCodes },
        results
      );

      const searchKey = await dbService.saveSearch({
        jobType: JOB_TYPES.BUSINESS_FORMATIONS,
        keyword: jobParams.keyword,
        stateCodes: params.stateCodes,
        entityTypes: params.entityTypes,
        formationKeyword: params.keyword,
        registeredAfter: input.registeredAfter,
        monitorMode: !!input.monitorMode,
        maxResults: params.maxResults,
        targetFolderKey: folder.targetFolderKey,
        targetFolderName: folder.targetFolderName,
        resultCount: leadRows.length,
        savedCount,
        results: leadRows,
        timestamp: new Date().toISOString(),
        workspaceId: wid,
      });
      await recordSearchSaved(actorEmail);
      await dbService.clearActiveJob({
        resultCount: leadRows.length,
        savedCount,
        searchKey,
        note: leadRows.length === 0 ? 'No new formations in this run (monitor mode may return zero).' : undefined,
      });
    } catch (err) {
      console.error('[FORMATIONS-BG] Business formation search failed:', err);
      const msg = err && err.message ? String(err.message) : 'Formation search failed';
      await dbService.clearActiveJob({ failed: true, error: msg });
    }
  });
}

function contractorJobPayload(job) {
  return {
    workspaceId: job.workspaceId,
    type: 'contractors_search',
    jobType: JOB_TYPES.CONTRACTORS,
    keyword: job.keyword,
    city: job.city,
    state: job.state,
    maxResults: job.maxResults,
    targetFolderKey: job.targetFolderKey,
    targetFolderName: job.targetFolderName,
    registries: job.registries,
    trades: job.trades,
    enrichPlaces: job.enrichPlaces,
    splitByTrade: job.splitByTrade,
  };
}

/**
 * @param {object} input body or tool args: contractorRegistries, contractorTrades, contractorMaxResults, contractorFull, contractorPlaces, folderKey, newFolderName
 */
async function resolveContractorSearch(workspaceId, input) {
  const parsed = parseContractorSearchInput(input || {});
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const folder = await resolveTargetFolder(workspaceId, {
    folderKey: input.folderKey || input.folder_id,
    newFolderName: input.newFolderName || input.folder_name,
    jobType: JOB_TYPES.CONTRACTORS,
  });
  if (folder.error) return { ok: false, status: 400, error: folder.error };

  const params = parsed.params;
  const jobParams = {
    jobType: JOB_TYPES.CONTRACTORS,
    keyword: keywordLabel(params),
    city: 'Clark County / Portland metro',
    state: params.registries.map((r) => r.toUpperCase()).join(', '),
    registries: params.registries,
    trades: params.trades,
    maxResults: params.maxResults,
    enrichPlaces: params.enrichPlaces,
    splitByTrade: params.splitByTrade,
    targetFolderKey: folder.targetFolderKey,
    targetFolderName: folder.targetFolderName,
    workspaceId,
  };

  return { ok: true, configured: true, params, jobParams, folder };
}

async function executeContractorSearch({ workspaceId, integrationEnv, resolved, onProgress }) {
  const collected = await collectContractorRecords(resolved.params, {
    placesKey: placesKeyFromEnv(integrationEnv),
    onProgress,
  });
  const persisted = await persistContractorRecords(workspaceId, collected.records, {
    splitByTrade: resolved.params.splitByTrade,
    folderKey: resolved.folder.targetFolderKey,
  });
  return { collected, persisted };
}

async function runContractorSearchInBackground({ workspaceId: wid, integrationEnv, resolved, actorEmail }) {
  const { params, jobParams, folder } = resolved;
  const beat = () =>
    contractorJobPayload({
      ...jobParams,
      workspaceId: wid,
      targetFolderKey: folder.targetFolderKey,
      targetFolderName: folder.targetFolderName,
    });

  await dbService.setActiveJob(beat());
  let lastBeat = Date.now();

  setImmediate(async () => {
    try {
      const { collected, persisted } = await executeContractorSearch({
        workspaceId: wid,
        integrationEnv,
        resolved,
        onProgress: async (info) => {
          const now = Date.now();
          if (now - lastBeat < 60000) return;
          lastBeat = now;
          await dbService.setActiveJob({ ...beat(), keyword: info && info.label ? info.label : jobParams.keyword });
        },
      });
      const noteParts = [];
      if (persisted.folders.length) {
        noteParts.push(
          `Filed into ${persisted.folders.length} folder${persisted.folders.length === 1 ? '' : 's'}`
        );
      }
      if (collected.placesError) noteParts.push(collected.placesError);
      if (collected.errors && collected.errors.length) noteParts.push(collected.errors.join(' '));
      const searchKey = await dbService.saveSearch({
        jobType: JOB_TYPES.CONTRACTORS,
        keyword: jobParams.keyword,
        city: jobParams.city,
        state: jobParams.state,
        registries: params.registries,
        trades: params.trades,
        enrichPlaces: params.enrichPlaces,
        splitByTrade: params.splitByTrade,
        maxResults: params.maxResults,
        targetFolderKey: folder.targetFolderKey,
        targetFolderName: folder.targetFolderName,
        resultCount: collected.records.length,
        savedCount: persisted.savedCount,
        mergedCount: persisted.mergedCount,
        summary: collected.summary,
        results: collected.records.slice(0, 200).map((row) => recordToLead(row)),
        timestamp: new Date().toISOString(),
        workspaceId: wid,
      });
      await recordSearchSaved(actorEmail);
      await dbService.clearActiveJob({
        resultCount: collected.records.length,
        savedCount: persisted.savedCount,
        searchKey,
        note: noteParts.join(' · ') || undefined,
      });
    } catch (err) {
      console.error('[CONTRACTORS-BG] Contractor license search failed:', err);
      const msg = err && err.message ? String(err.message) : 'Contractor license search failed';
      await dbService.clearActiveJob({ failed: true, error: msg });
    }
  });
}

module.exports = {
  FORMATIONS_NOT_CONFIGURED,
  resolvePermitSearch,
  runPermitSearchInBackground,
  resolveFormationSearch,
  runFormationSearchInBackground,
  resolveContractorSearch,
  executeContractorSearch,
  runContractorSearchInBackground,
};
