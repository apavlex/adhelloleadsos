const express = require('express');
const { DateTime } = require('luxon');
const router = express.Router();
const mapsSearch = require('../services/mapsSearch');
const dbService = require('../services/database');
const enricher = require('../services/enricher');
const activationService = require('../services/activationService');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');

// POST /search — Google Maps list (Outscraper first when configured, else Apify)
router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const { keyword, city, state, maxResults, mode } = req.body;
    const activationUserEmail = userEmail(req);
    const activationWorkspaceId = wid;

    async function startBackgroundSearchRun() {
      await dbService.setActiveJob({
        type: 'search',
        keyword,
        city,
        state,
        maxResults: parseInt(maxResults, 10) || 20,
      });
      setImmediate(async () => {
        try {
          if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
            console.error('[SEARCH-BG] No Maps provider for workspace:', activationWorkspaceId);
            await dbService.clearActiveJob();
            return;
          }
          console.log(`[SEARCH-BG] Starting Maps search for "${keyword}" in "${city}, ${state}"...`);
          let results = await mapsSearch.searchGoogleMaps({
            keyword,
            city,
            state,
            maxResults: maxResults || 20,
            integrationEnv,
          });
          console.log('[SEARCH-BG] Starting deep enrichment pass...');
          results = await enricher.enrichLeads(results, { workspaceId: activationWorkspaceId });
          const searchRecord = {
            keyword,
            city,
            state,
            maxResults: parseInt(maxResults, 10) || 20,
            targetFolderKey,
            targetFolderName,
            resultCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            workspaceId: activationWorkspaceId,
          };
          const searchKey = await dbService.saveSearch(searchRecord);
          console.log(`[SEARCH-BG] Saved results to DB with key: ${searchKey}`);
          if (activationUserEmail) await activationService.recordEvent(activationUserEmail, 'search_saved');
          await dbService.clearActiveJob();
        } catch (err) {
          console.error('[SEARCH-BG] Background search failed:', err);
          await dbService.clearActiveJob();
        }
      });
    }

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
          activePage: 'search',
        });
      }
      targetFolderKey = String(existing.key);
      targetFolderName = String(existing.name || '');
    }

    if (mode !== 'schedule' && !mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message:
          'Maps search is not configured for this workspace. Add keys under Workspace → API integrations, or set OUTSCRAPER_API_KEY / APIFY_API_TOKEN on the server.',
        activePage: 'search',
      });
    }

    if (!keyword || !city || !state) {
      return res.status(400).render('error', {
        message: 'Keyword, City, and State are all required.',
        activePage: 'search',
      });
    }

    // --- Scheduled one-time scrape (date + time in user's timezone) ---
    if (mode === 'schedule') {
      const scheduledDate = String(req.body.scheduledDate || '').trim();
      const scheduledTime = String(req.body.scheduledTime || '09:00').trim();
      const timezone = String(req.body.timezone || 'UTC').trim() || 'UTC';

      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return res.status(400).render('error', {
          message: 'Choose a run date for your scheduled search.',
          activePage: 'search',
        });
      }

      const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(scheduledTime);
      if (!timeMatch) {
        return res.status(400).render('error', {
          message: 'Choose a valid time for your scheduled search.',
          activePage: 'search',
        });
      }

      const hh = String(timeMatch[1]).padStart(2, '0');
      const mm = timeMatch[2];
      const normalizedTime = `${hh}:${mm}`;

      const local = DateTime.fromISO(`${scheduledDate}T${normalizedTime}`, { zone: timezone });
      if (!local.isValid) {
        return res.status(400).render('error', {
          message: 'Could not interpret that schedule in your timezone. Try again.',
          activePage: 'search',
        });
      }

      const scheduledRunAt = local.toUTC().toISO();
      if (DateTime.utc() >= DateTime.fromISO(scheduledRunAt)) {
        return res.status(400).render('error', {
          message: 'Scheduled run must be in the future.',
          activePage: 'search',
        });
      }

      console.log(`[SEARCH] Saving scheduled scrape for "${keyword}" in "${city}" at ${scheduledDate} ${normalizedTime} (${timezone}) → ${scheduledRunAt}`);
      await dbService.saveSchedule({
        keyword,
        city,
        state,
        maxResults: parseInt(maxResults, 10) || 20,
        targetFolderKey,
        targetFolderName,
        scheduledRunAt,
        scheduledDate,
        scheduledTime: normalizedTime,
        timezone,
        createdAt: new Date().toISOString(),
        workspaceId: req.workspaceId,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      await persistWorkspaceIcp(wid, {
        keyword,
        city,
        state,
        qty: parseInt(maxResults, 10) || 20,
      });
      const runNowAlso = String(req.body.runNowAlso || '').toLowerCase() === 'on';
      if (runNowAlso) {
        await startBackgroundSearchRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    // --- START BACKGROUND PROCESSING ---
    const maxRes = parseInt(maxResults, 10) || 20;
    await persistWorkspaceIcp(wid, { keyword, city, state, qty: maxRes });
    await startBackgroundSearchRun();

    // Redirect user immediately back to Today (non-blocking run).
    res.redirect('/today?searchInProgress=1');
  } catch (err) {
    console.error('Search error:', err);

    if (err.message && err.message.includes('401')) {
      return res.status(401).render('error', {
        message: 'Invalid API credentials for Maps search. Check OUTSCRAPER_API_KEY and/or APIFY_API_TOKEN.',
        activePage: 'search',
      });
    }
    if (err.message && err.message.includes('402')) {
      return res.status(402).render('error', {
        message: 'Billing issue or insufficient credits on Apify or Outscraper. Check the provider that ran last in server logs.',
        activePage: 'search',
      });
    }

    next(err);
  }
});

// GET /search/:key — view a saved search's results
router.get('/:key', async (req, res, next) => {
  try {
    const searchKey = req.params.key;
    const fullKey = searchKey.startsWith('search:') ? searchKey : `search:${searchKey}`;

    const data = await dbService.getSearch(fullKey);

    if (!data) {
      return res.status(404).render('error', {
        message: 'Search not found.',
        activePage: 'search',
      });
    }

    // Get all bookmarked leads to sync bookmark status on the results page
    const savedLeads = filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));

    res.render('results', {
      title: `Results: ${data.keyword} in ${data.city}, ${data.state}`,
      activePage: 'search',
      keyword: data.keyword,
      city: data.city,
      state: data.state,
      maxResults: data.maxResults,
      results: data.results || [],
      searchKey: fullKey,
      targetFolderKey: data.targetFolderKey || '',
      targetFolderName: data.targetFolderName || '',
      savedLeads,
      message: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
