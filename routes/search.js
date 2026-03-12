const express = require('express');
const router = express.Router();
const apifyService = require('../services/apify');
const dbService = require('../services/database');

// POST /search — trigger an Apify search
router.post('/', async (req, res, next) => {
  try {
    const { keyword, city, state, maxResults } = req.body;

    if (!keyword || !city || !state) {
      return res.status(400).render('error', {
        message: 'Keyword, City, and State are all required.',
        activePage: 'search',
      });
    }

    if (!process.env.APIFY_API_TOKEN) {
      return res.status(500).render('error', {
        message: 'APIFY_API_TOKEN is not configured. Please add it to your Cloud Run Environment Variables.',
        activePage: 'search',
      });
    }

    // Run the Apify search
    const results = await apifyService.searchGoogleMaps({
      keyword,
      city,
      state,
      maxResults: maxResults || 20,
    });

    // Save to database
    const searchRecord = {
      keyword,
      city,
      state,
      maxResults: parseInt(maxResults, 10) || 20,
      resultCount: results.length,
      results,
      timestamp: new Date().toISOString(),
    };

    const searchKey = await dbService.saveSearch(searchRecord);

    res.render('results', {
      title: `Results: ${keyword} in ${city}, ${state}`,
      activePage: 'search',
      keyword,
      city,
      state,
      maxResults,
      results,
      searchKey,
      message: null,
    });
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

    res.render('results', {
      title: `Results: ${data.keyword} in ${data.city}, ${data.state}`,
      activePage: 'search',
      keyword: data.keyword,
      city: data.city,
      state: data.state,
      maxResults: data.maxResults,
      results: data.results || [],
      searchKey: fullKey,
      message: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
