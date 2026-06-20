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
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const { resolveTargetFolder } = require('../services/pipelineFolders');

router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const { city, state, maxResults, mode, minPrice, maxPrice, query } = req.body;
    const sources = listingSearch.parseSourcesFromBody(req.body);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    const folderResolved = await resolveTargetFolder(wid, {
      folderKey: req.body.folderKey,
      newFolderName: req.body.newFolderName,
      jobType: JOB_TYPES.MOBILE_HOMES,
    });
    if (folderResolved.error) {
      return res.status(400).render('error', {
        message: folderResolved.error,
        activePage: 'find',
      });
    }
    const targetFolderKey = folderResolved.targetFolderKey;
    const targetFolderName = folderResolved.targetFolderName;

    if (!city || !state) {
      return res.status(400).render('error', {
        message: 'City and state are required.',
        activePage: 'find',
      });
    }

    const maxRes = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 25));
    const searchQuery = String(query || 'mobile home').trim() || 'mobile home';
    const flipFilter = parseFlipFilter(req.body);

    const jobParams = {
      jobType: JOB_TYPES.MOBILE_HOMES,
      city,
      state,
      query: searchQuery,
      sources,
      maxResults: maxRes,
      minPrice,
      maxPrice,
      flipFilter,
      targetFolderKey,
      targetFolderName,
      workspaceId: wid,
    };

    async function startBackgroundRun() {
      await dbService.setActiveJob({
        type: 'mobile_home_search',
        city,
        state,
        query: searchQuery,
        maxResults: maxRes,
        flipFilter: flipFilter.enabled ? flipFilter : null,
      });
      setImmediate(async () => {
        try {
          if (!listingSearch.isConfigured(integrationEnv)) {
            await dbService.clearActiveJob({
              failed: true,
              error: 'Apify API token required. Add it under Workspace → API integrations.',
            });
            return;
          }
          const results = await scrapeJobRunner.runMobileHomesJob(jobParams, integrationEnv);
          const searchRecord = scrapeJobRunner.buildSearchRecord(
            jobParams,
            results,
            new Date().toISOString()
          );
          const searchKey = await dbService.saveSearch(searchRecord);
          await activationService.recordEvent(userEmail(req), 'search_saved');
          await dbService.clearActiveJob({ resultCount: results.length, searchKey });
        } catch (err) {
          await dbService.clearActiveJob({
            failed: true,
            error: err && err.message ? String(err.message) : 'Listing search failed',
          });
        }
      });
    }

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).render('error', { message: parsed.message, activePage: 'find' });
      }
      if (!listingSearch.isConfigured(integrationEnv)) {
        return res.status(503).render('error', {
          message: 'Apify API token required for listing search.',
          activePage: 'find',
        });
      }
      await dbService.saveSchedule({
        jobType: JOB_TYPES.MOBILE_HOMES,
        city,
        state,
        query: searchQuery,
        sources,
        maxResults: maxRes,
        minPrice: minPrice || null,
        maxPrice: maxPrice || null,
        flipFilter: flipFilter.enabled ? flipFilter : null,
        targetFolderKey,
        targetFolderName,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        workspaceId: wid,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      if (String(req.body.runNowAlso || '').toLowerCase() === 'on') {
        await startBackgroundRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    if (!listingSearch.isConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message: 'Apify API token required for listing search.',
        activePage: 'find',
      });
    }

    await startBackgroundRun();
    res.redirect('/today?searchInProgress=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
