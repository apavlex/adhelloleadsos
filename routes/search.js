const express = require('express');
const router = express.Router();
const apifyService = require('../services/apify');
const dbService = require('../services/database');
const enricher = require('../services/enricher');
const activationService = require('../services/activationService');
const { userEmail, filterLeadsForRequest } = require('../services/workspaceService');

// POST /search — trigger an Apify search
router.post('/', async (req, res, next) => {
  try {
    const { keyword, city, state, maxResults, mode, frequency } = req.body;

    if (mode !== 'schedule' && !process.env.APIFY_API_TOKEN) {
      return res.status(503).render('error', {
        message: 'Apify is not configured. Set APIFY_API_TOKEN in your environment (Cloud Run → Variables & secrets).',
        activePage: 'search',
      });
    }

    if (!keyword || !city || !state) {
      return res.status(400).render('error', {
        message: 'Keyword, City, and State are all required.',
        activePage: 'search',
      });
    }

    // --- HANDLE AUTOPILOT SCHEDULING ---
    if (mode === 'schedule') {
      const { scheduledTime, timezone } = req.body;
      console.log(`[SEARCH] Saving new Autopilot schedule for "${keyword}" in "${city}" at ${scheduledTime} (${timezone})...`);
      await dbService.saveSchedule({
        keyword,
        city,
        state,
        maxResults: parseInt(maxResults, 10) || 20,
        frequency: frequency || 'daily',
        scheduledTime: scheduledTime || '09:00',
        timezone: timezone || 'UTC',
        createdAt: new Date().toISOString(),
        workspaceId: req.workspaceId || 'default',
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      return res.redirect('/schedules?success=true');
    }

    // --- START BACKGROUND PROCESSING ---
    await dbService.setActiveJob({ 
      type: 'search', 
      keyword, 
      city, 
      state, 
      maxResults: parseInt(maxResults, 10) || 20 
    });

    const activationUserEmail = userEmail(req);
    const activationWorkspaceId = req.workspaceId || 'default';

    // We use setImmediate to run this in the background without blocking the response
    setImmediate(async () => {
      try {
        if (!process.env.APIFY_API_TOKEN) {
          console.error('[SEARCH-BG] APIFY_API_TOKEN is not configured.');
          return;
        }

        // Run the Apify search
        console.log(`[SEARCH-BG] Starting Apify search for "${keyword}" in "${city}, ${state}"...`);
        let results = await apifyService.searchGoogleMaps({
          keyword,
          city,
          state,
          maxResults: maxResults || 20,
        });

        // Enrich with socials and emails if missing
        console.log(`[SEARCH-BG] Starting deep enrichment pass...`);
        results = await enricher.enrichLeads(results);

        // Save to database
        const searchRecord = {
          keyword,
          city,
          state,
          maxResults: parseInt(maxResults, 10) || 20,
          resultCount: results.length,
          results,
          timestamp: new Date().toISOString(),
          workspaceId: activationWorkspaceId,
        };

        const searchKey = await dbService.saveSearch(searchRecord);
        console.log(`[SEARCH-BG] Saved results to DB with key: ${searchKey}`);
        if (activationUserEmail) {
          await activationService.recordEvent(activationUserEmail, 'search_saved');
        }
        
        // Finalize the job status
        await dbService.clearActiveJob();
      } catch (err) {
        console.error('[SEARCH-BG] Background search failed:', err);
        // Even on failure, clear the active job so the spinner stops
        await dbService.clearActiveJob();
      }
    });

    // Redirect user immediately to history (or a search status page)
    res.redirect('/history?status=searching');
  } catch (err) {
    console.error('Search error:', err);

    if (err.message && err.message.includes('401')) {
      return res.status(401).render('error', {
        message: 'Invalid Apify API token. Check your APIFY_API_TOKEN.',
        activePage: 'search',
      });
    }
    if (err.message && err.message.includes('402')) {
      return res.status(402).render('error', {
        message: 'Insufficient Apify credits. Please top up your Apify account.',
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
    const savedLeads = filterLeadsForRequest(req, await dbService.getAllLeads());

    res.render('results', {
      title: `Results: ${data.keyword} in ${data.city}, ${data.state}`,
      activePage: 'search',
      keyword: data.keyword,
      city: data.city,
      state: data.state,
      maxResults: data.maxResults,
      results: data.results || [],
      searchKey: fullKey,
      savedLeads,
      message: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
