const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

router.get('/', async (req, res, next) => {
  try {
    const allSearches = await dbService.getAllSearches();
    const wid = (req.workspaceId || 'default');
    const searches = allSearches.filter(
      (s) => (s.workspaceId || 'default') === wid
    );
    const activeJob = await dbService.getActiveJob();
    const searchingParam = String(req.query.status || '').toLowerCase() === 'searching';
    const jobIsSearch =
      activeJob &&
      activeJob.type === 'search' &&
      activeJob.status === 'processing';
    const showSearchProgress = jobIsSearch || searchingParam;

    res.render('history', {
      title: 'Search History',
      activePage: 'history',
      searches,
      activeJob: jobIsSearch ? activeJob : null,
      showSearchProgress,
    });
  } catch (err) {
    next(err);
  }
});

// POST /history/:key/delete — delete a saved search
router.post('/:key/delete', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('search:') ? key : `search:${key}`;
    await dbService.deleteSearch(fullKey);
    res.redirect('/history');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
