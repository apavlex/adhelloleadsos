const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const realEstateSearch = require('../services/realEstateSearch');
const scrapeJobRunner = require('../services/scrapeJobRunner');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { parseSchedulePayload } = require('../services/scheduleHelpers');
const { JOB_TYPES } = require('../services/scrapeJobTypes');

router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const { city, state, maxResults, mode, minPrice, maxPrice } = req.body;
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    const requestedFolderKey = String(req.body.folderKey || '').trim();
    const newFolderName = String(req.body.newFolderName || '').trim();
    let targetFolderKey = '';
    let targetFolderName = '';

    if (newFolderName) {
      const folder = await dbService.createFolder(wid, newFolderName);
      targetFolderKey = folder && folder.key ? String(folder.key) : '';
      targetFolderName = folder && folder.name ? String(folder.name) : newFolderName;
    } else if (requestedFolderKey) {
      const folders = await dbService.listFolders(wid);
      const existing = folders.find((f) => f && String(f.key) === requestedFolderKey);
      if (!existing) {
        return res.status(400).render('error', {
          message: 'Selected folder no longer exists. Refresh and choose again.',
          activePage: 'find',
        });
      }
      targetFolderKey = String(existing.key);
      targetFolderName = String(existing.name || '');
    }

    if (!city || !state) {
      return res.status(400).render('error', {
        message: 'City and state are required.',
        activePage: 'find',
      });
    }

    const maxRes = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 20));

    async function startBackgroundRealEstateRun() {
      await dbService.setActiveJob({
        type: 'real_estate_search',
        city,
        state,
        maxResults: maxRes,
      });
      setImmediate(async () => {
        try {
          if (!realEstateSearch.isConfigured(integrationEnv)) {
            await dbService.clearActiveJob({
              failed: true,
              error: 'Real estate search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
            });
            return;
          }
          console.log(`[RE-SEARCH-BG] Starting for ${city}, ${state}...`);
          const results = await realEstateSearch.searchListings({
            city,
            state,
            maxResults: maxRes,
            minPrice,
            maxPrice,
            integrationEnv,
          });
          if (!results || results.length === 0) {
            throw new Error('No listings found. Try another area or widen price filters.');
          }
          const searchRecord = scrapeJobRunner.buildSearchRecord(
            {
              jobType: JOB_TYPES.REAL_ESTATE,
              city,
              state,
              maxResults: maxRes,
              minPrice,
              maxPrice,
              targetFolderKey,
              targetFolderName,
              workspaceId: wid,
            },
            results,
            new Date().toISOString()
          );
          const searchKey = await dbService.saveSearch(searchRecord);
          console.log(`[RE-SEARCH-BG] Saved ${results.length} listings: ${searchKey}`);
          await activationService.recordEvent(userEmail(req), 'search_saved');
          await dbService.clearActiveJob({ resultCount: results.length, searchKey });
        } catch (err) {
          console.error('[RE-SEARCH-BG] Failed:', err);
          await dbService.clearActiveJob({
            failed: true,
            error: err && err.message ? String(err.message) : 'Real estate search failed',
          });
        }
      });
    }

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).render('error', {
          message: parsed.message,
          activePage: 'find',
        });
      }

      if (!realEstateSearch.isConfigured(integrationEnv)) {
        return res.status(503).render('error', {
          message:
            'Real estate search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
          activePage: 'find',
        });
      }

      await dbService.saveSchedule({
        jobType: JOB_TYPES.REAL_ESTATE,
        city,
        state,
        maxResults: maxRes,
        minPrice: minPrice || null,
        maxPrice: maxPrice || null,
        targetFolderKey,
        targetFolderName,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        workspaceId: wid,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');

      const runNowAlso = String(req.body.runNowAlso || '').toLowerCase() === 'on';
      if (runNowAlso) {
        await startBackgroundRealEstateRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    if (!realEstateSearch.isConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message:
          'Real estate search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
        activePage: 'find',
      });
    }

    await startBackgroundRealEstateRun();
    res.redirect('/today?searchInProgress=1');
  } catch (err) {
    console.error('[REAL-ESTATE] Search error:', err);
    next(err);
  }
});

module.exports = router;
