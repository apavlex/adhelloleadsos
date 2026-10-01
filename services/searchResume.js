/**
 * Re-run a search that was still running when the app restarted (e.g. a deploy).
 */

const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const scrapeJobRunner = require('./scrapeJobRunner');
const enricher = require('./enricher');
const { JOB_TYPES, normalizeJobType } = require('./scrapeJobTypes');
const { rememberFolderSearchFromRun } = require('./folderSearchPreset');
const { STALE_MS, ENRICH_BUDGET_MS, runBestEffort, withTimeout } = require('./leadRunProgress');

const SEARCH_BUDGET_MS = STALE_MS - 60 * 1000;

async function runResumedSearch(schedule) {
  const wid = schedule.workspaceId || 'default';
  const ws = await dbService.getWorkspace(wid);
  if (ws && ws.isDemo) throw new Error('Searches do not run in demo workspaces.');
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
  if (!scrapeJobRunner.isJobConfigured(schedule, integrationEnv)) {
    throw new Error('Search is not configured. Add provider keys under Workspace → API integrations.');
  }
  let results = await withTimeout(
    scrapeJobRunner.executeScrapeJob(schedule, integrationEnv, {
      directorySupplement: schedule.directorySupplement === true,
    }),
    SEARCH_BUDGET_MS,
    'search'
  );
  if (!results || !results.length) throw new Error('No results found for this search.');

  if (normalizeJobType(schedule.jobType) === JOB_TYPES.MAPS_BUSINESS) {
    const enrichAttempt = await runBestEffort(
      () => enricher.enrichLeads(results, { workspaceId: wid, timeoutMs: ENRICH_BUDGET_MS }),
      results,
      ENRICH_BUDGET_MS + 5000,
      'resume_enrich'
    );
    results = enrichAttempt.value || results;
  }

  let savedCount = 0;
  const folderKey = String(schedule.targetFolderKey || '').trim();
  const folder = schedule.autoSave && folderKey ? await dbService.getFolder(wid, folderKey) : null;
  if (folder) {
    // Lazy require: folderSearchRun also loads the database module at boot.
    const { persistResultsIntoFolder } = require('./folderSearchRun');
    const persist = await persistResultsIntoFolder(wid, folder, schedule, results);
    savedCount = persist.added;
  }

  const searchRecord = {
    ...scrapeJobRunner.buildSearchRecord(schedule, results, new Date().toISOString()),
    isAutopilot: false,
    resumed: true,
    savedCount,
  };
  if (schedule.autoTags) searchRecord.autoTags = schedule.autoTags;
  if (schedule.searchNotes) searchRecord.searchNotes = schedule.searchNotes;
  const searchKey = await dbService.saveSearch(searchRecord);
  if (folder) {
    await rememberFolderSearchFromRun(wid, folder.key, {
      ...searchRecord,
      searchKey,
      directorySupplement: schedule.directorySupplement,
    });
  }
  return { resultCount: results.length, searchKey, savedCount };
}

async function resumeInterruptedSearch(job) {
  const { startedAt, status, ...rest } = job;
  await dbService.setActiveJob({ ...rest, resumeCount: (job.resumeCount || 0) + 1 });

  setImmediate(async () => {
    try {
      const done = await runResumedSearch(job.resume);
      await dbService.clearActiveJob(done);
      console.log(`[SEARCH-RESUME] Finished "${job.keyword || ''}": ${done.resultCount} results`);
    } catch (err) {
      console.error('[SEARCH-RESUME] Resumed search failed:', err);
      await dbService.clearActiveJob({
        failed: true,
        error: (err && err.message) || 'Search failed after the app restarted.',
      });
    }
  });
}

module.exports = { resumeInterruptedSearch, runResumedSearch };
