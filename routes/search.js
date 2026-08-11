const express = require('express');
const router = express.Router();
const mapsSearch = require('../services/mapsSearch');
const directoryLeadSearch = require('../services/directoryLeadSearch');
const dbService = require('../services/database');
const enricher = require('../services/enricher');
const activationService = require('../services/activationService');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const { parseSchedulePayload } = require('../services/scheduleHelpers');
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const { formatSearchKeywordDisplay } = require('../services/formatSearchKeywordDisplay');
const {
  resolveTargetFolder,
  resolveSearchRecordFolderContext,
  leadMetadataForJobType,
} = require('../services/pipelineFolders');
const { parseAutoTags, resolveAutoTagKeys } = require('../services/folderSearchPreset');

// POST /search — Google Maps list (RapidAPI → SearchAPI.io → SerpAPI → Outscraper → Apify in Auto)
router.post('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const {
      keyword,
      city,
      state,
      maxResults,
      mode,
      directorySupplement,
      mapsProvider,
      minRating,
      minReviews,
      autoTags,
      searchNotes,
    } = req.body;
    const activationUserEmail = userEmail(req);
    const activationWorkspaceId = wid;

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    const wantDirectorySupplement =
      String(directorySupplement || '').toLowerCase() === 'on' ||
      (directorySupplement == null && directoryLeadSearch.directorySupplementEnabled(integrationEnv));

    const folderResolved = await resolveTargetFolder(wid, {
      folderKey: req.body.folderKey,
      newFolderName: req.body.newFolderName,
      jobType: JOB_TYPES.MAPS_BUSINESS,
    });
    if (folderResolved.error) {
      return res.status(400).render('error', {
        message: folderResolved.error,
        activePage: 'search',
      });
    }
    const targetFolderKey = folderResolved.targetFolderKey;
    const targetFolderName = folderResolved.targetFolderName;

    const userPickedFolder = !!(
      req.body.folderKey &&
      String(req.body.folderKey).trim() &&
      String(req.body.folderKey).trim() !== '__new__'
    );

    async function startBackgroundSearchRun() {
      await dbService.setActiveJob({
        type: 'search',
        jobType: JOB_TYPES.MAPS_BUSINESS,
        keyword,
        city,
        state,
        maxResults: parseInt(maxResults, 10) || 20,
        targetFolderKey,
        targetFolderName,
      });
      setImmediate(async () => {
        try {
          if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
            console.error('[SEARCH-BG] No Maps provider for workspace:', activationWorkspaceId);
            await dbService.clearActiveJob({
              failed: true,
              error:
                'Maps search is not configured. Add a RapidAPI, SearchAPI.io, SerpAPI, Outscraper, Monid, or Apify key under Workspace → API integrations.',
            });
            return;
          }
          console.log(`[SEARCH-BG] Starting Maps search for "${keyword}" in "${city}, ${state}"...`);
          const maxRes = parseInt(maxResults, 10) || 20;
          let results = await mapsSearch.searchGoogleMaps({
            keyword,
            city,
            state,
            maxResults: maxRes,
            integrationEnv,
            mapsProvider: String(mapsProvider || '').trim() || undefined,
          });
          if (!results || results.length === 0) {
            throw new Error(
              'No businesses found for this keyword and area. Try a broader keyword, check city/state, and run Test connection on RapidAPI under Workspace → API integrations.'
            );
          }
          results = mapsSearch.filterMapsResults(results, { minRating, minReviews });
          if (!results || results.length === 0) {
            throw new Error(
              'No businesses matched your search criteria after rating/review filters. Try lowering min rating or review count.'
            );
          }
          if (wantDirectorySupplement) {
            console.log('[SEARCH-BG] Supplementing with directory listings (Outscraper: Yelp, Angi, YP, Zillow agents + BBB)…');
            try {
              const directoryLeads = await directoryLeadSearch.searchDirectoryLeads({
                keyword,
                city,
                state,
                maxResults: Math.min(25, maxRes),
                integrationEnv,
              });
              const before = results.length;
              results = directoryLeadSearch.mergeMapsAndDirectoryLeads(results, directoryLeads, maxRes);
              console.log(
                `[SEARCH-BG] Directory supplement: +${Math.max(0, results.length - before)} leads (${results.length} total)`
              );
            } catch (dirErr) {
              console.warn('[SEARCH-BG] Directory supplement failed (Maps results kept):', dirErr.message);
            }
          }
          console.log('[SEARCH-BG] Starting deep enrichment pass...');
          results = await enricher.enrichLeads(results, { workspaceId: activationWorkspaceId });
          const searchRecord = {
            jobType: JOB_TYPES.MAPS_BUSINESS,
            keyword,
            city,
            state,
            maxResults: parseInt(maxResults, 10) || 20,
            targetFolderKey,
            targetFolderName,
            mapsProvider: String(mapsProvider || '').trim() || 'auto',
            minRating: minRating != null && minRating !== '' ? parseFloat(minRating) : null,
            minReviews: minReviews != null && minReviews !== '' ? parseInt(minReviews, 10) : null,
            autoTags: parseAutoTags(autoTags),
            searchNotes: String(searchNotes || '').trim(),
            resultCount: results.length,
            results,
            timestamp: new Date().toISOString(),
            workspaceId: activationWorkspaceId,
          };
          const searchKey = await dbService.saveSearch(searchRecord);
          console.log(`[SEARCH-BG] Saved results to DB with key: ${searchKey}`);

          let savedCount = 0;
          if (userPickedFolder && targetFolderKey && results.length) {
            const tagKeys = parseAutoTags(autoTags).length
              ? await resolveAutoTagKeys(activationWorkspaceId, parseAutoTags(autoTags))
              : [];
            for (const row of results) {
              const meta = leadMetadataForJobType(JOB_TYPES.MAPS_BUSINESS, {
                folderKey: targetFolderKey,
              });
              const payload = {
                ...row,
                ...meta,
                workspaceId: activationWorkspaceId,
                savedAt: new Date().toISOString(),
              };
              if (tagKeys.length) payload.tags = tagKeys;
              // eslint-disable-next-line no-await-in-loop
              const saved = await dbService.saveLeadWithMeta(payload);
              if (!saved.merged) savedCount += 1;
            }
            console.log(
              `[SEARCH-BG] Auto-saved ${savedCount} lead(s) into folder ${targetFolderKey}`
            );
          }

          if (activationUserEmail) await activationService.recordEvent(activationUserEmail, 'search_saved');
          await dbService.clearActiveJob({ resultCount: results.length, searchKey, savedCount });
        } catch (err) {
          console.error('[SEARCH-BG] Background search failed:', err);
          const msg = err && err.message ? String(err.message) : 'Search failed';
          await dbService.clearActiveJob({ failed: true, error: msg });
        }
      });
    }

    if (mode !== 'schedule' && !mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message:
          'Maps search is not configured for this workspace. Add keys under Workspace → API integrations, or set RAPIDAPI_KEY / SEARCHAPI_API_KEY / SERPAPI_API_KEY / OUTSCRAPER_API_KEY / MONID_API_KEY / APIFY_API_TOKEN on the server.',
        activePage: 'search',
      });
    }

    if (!keyword || !city || !state) {
      return res.status(400).render('error', {
        message: 'Keyword, City, and State are all required.',
        activePage: 'search',
      });
    }

    // --- Scheduled scrape (one-time or recurring) ---
    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).render('error', {
          message: parsed.message,
          activePage: 'search',
        });
      }

      console.log(
        `[SEARCH] Saving scheduled Maps scrape for "${keyword}" in "${city}" (${parsed.data.scheduleKind})`
      );
      await dbService.saveSchedule({
        jobType: JOB_TYPES.MAPS_BUSINESS,
        keyword,
        city,
        state,
        maxResults: parseInt(maxResults, 10) || 20,
        targetFolderKey,
        targetFolderName,
        ...parsed.data,
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
        message:
          'Invalid API credentials for Maps search. Check RAPIDAPI_KEY, SEARCHAPI_API_KEY, SERPAPI_API_KEY, OUTSCRAPER_API_KEY, and/or APIFY_API_TOKEN.',
        activePage: 'search',
      });
    }
    if (err.message && err.message.includes('402')) {
      return res.status(402).render('error', {
        message:
          'Billing issue or insufficient credits on RapidAPI, SearchAPI.io, SerpAPI, Outscraper, or Apify. Check the provider that ran last in server logs.',
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
    const folderCtx = await resolveSearchRecordFolderContext(req.workspaceId, data);
    const folders = folderCtx.folders;
    const targetFolderKey = folderCtx.targetFolderKey;
    const targetFolderName = folderCtx.targetFolderName;
    const jobType = folderCtx.jobType;

    let autoTagKeys = [];
    if (data.autoTags && data.autoTags.length) {
      autoTagKeys = await resolveAutoTagKeys(req.workspaceId, data.autoTags);
    }

    const displayKeyword = formatSearchKeywordDisplay(data.keyword);
    res.render('results', {
      title: `Results: ${displayKeyword} in ${data.city}, ${data.state}`,
      activePage: 'search',
      keyword: data.keyword,
      city: data.city,
      state: data.state,
      maxResults: data.maxResults,
      jobType: data.jobType || JOB_TYPES.MAPS_BUSINESS,
      results: data.results || [],
      searchKey: fullKey,
      targetFolderKey,
      targetFolderName,
      autoTags: data.autoTags || [],
      autoTagKeys,
      searchNotes: data.searchNotes || '',
      mapsProvider: data.mapsProvider || 'auto',
      savedLeads,
      folders,
      message: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
