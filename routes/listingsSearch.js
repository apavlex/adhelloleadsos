const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const listingSearch = require('../services/listingSearch');
const scrapeJobRunner = require('../services/scrapeJobRunner');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { parseSchedulePayload } = require('../services/scheduleHelpers');
const { parseFlipFilter } = require('../services/listingFlipScore');
const { JOB_TYPES, normalizeJobType } = require('../services/scrapeJobTypes');
const { resolveTargetFolder } = require('../services/pipelineFolders');
const { configForJobType, defaultSourcesForJobType, jobTypeRequiresLocation } = require('../services/searchTypeConfig');

router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const jobType = normalizeJobType(req.body.jobType || JOB_TYPES.REAL_ESTATE);
    const { city, state, maxResults, mode, minPrice, maxPrice, query, keyword } = req.body;
    const sources = listingSearch.parseSourcesFromBody(req.body);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const typeConfig = configForJobType(jobType);

    const folderResolved = await resolveTargetFolder(wid, {
      folderKey: req.body.folderKey,
      newFolderName: req.body.newFolderName,
      jobType,
    });
    if (folderResolved.error) {
      return res.status(400).render('error', {
        message: folderResolved.error,
        activePage: 'find',
      });
    }
    const targetFolderKey = folderResolved.targetFolderKey;
    const targetFolderName = folderResolved.targetFolderName;

    const needsLocation = jobTypeRequiresLocation(jobType);

    if (needsLocation && (!city || !state)) {
      return res.status(400).render('error', {
        message: 'City and state are required.',
        activePage: 'find',
      });
    }

    const resolvedCity = needsLocation ? String(city || '').trim() : String(city || '').trim();
    const resolvedState = needsLocation ? String(state || '').trim() : String(state || '').trim();

    const maxRes = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 25));
    const searchQuery =
      String(query || keyword || typeConfig.defaultQuery || '').trim() ||
      typeConfig.defaultQuery ||
      'listings';
    const flipFilter = jobType === JOB_TYPES.REAL_ESTATE ? parseFlipFilter(req.body) : { enabled: false };
    const resolvedSources =
      sources && sources.length ? sources : defaultSourcesForJobType(jobType);

    const jobParams = {
      jobType,
      city: resolvedCity,
      state: resolvedState,
      query: searchQuery,
      sources: resolvedSources,
      maxResults: maxRes,
      minPrice,
      maxPrice,
      flipFilter,
      scraper: req.body.scraper,
      targetFolderKey,
      targetFolderName,
      workspaceId: wid,
    };

    async function startBackgroundRun() {
      await dbService.setActiveJob({
        type: `${jobType}_search`,
        city: resolvedCity,
        state: resolvedState,
        query: searchQuery,
        maxResults: maxRes,
        jobType,
        flipFilter: flipFilter.enabled ? flipFilter : null,
      });
      setImmediate(async () => {
        try {
          if (!listingSearch.isConfigured(integrationEnv)) {
            await dbService.clearActiveJob({
              failed: true,
              error:
                'Listing search requires Apify and/or SerpAPI keys. Add them under Workspace → API integrations.',
            });
            return;
          }
          const results = await scrapeJobRunner.runListingJob(jobParams, integrationEnv);
          const searchRecord = scrapeJobRunner.buildSearchRecord(
            jobParams,
            results,
            new Date().toISOString()
          );
          const searchKey = await dbService.saveSearch(searchRecord);
          if (userEmail(req)) await activationService.recordEvent(userEmail(req), 'search_saved');
          await dbService.clearActiveJob({ resultCount: results.length, searchKey });
        } catch (err) {
          console.error(`[LISTINGS-BG] ${jobType} search failed:`, err);
          await dbService.clearActiveJob({
            failed: true,
            error: err && err.message ? String(err.message) : 'Search failed',
          });
        }
      });
    }

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).render('error', { message: parsed.message, activePage: 'find' });
      }
      await dbService.saveSchedule({
        ...jobParams,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        workspaceId: wid,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      const runNowAlso = String(req.body.runNowAlso || '').toLowerCase() === 'on';
      if (runNowAlso) {
        await startBackgroundRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    await startBackgroundRun();
    return res.redirect('/today?searchInProgress=1');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
