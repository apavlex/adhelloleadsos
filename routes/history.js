const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { findTabForJobType } = require('../services/searchTypeConfig');

/** First paint only — full history can be thousands of rows and stalled the nav frost. */
const HISTORY_PAGE_LIMIT = 80;

function runAgainHref(search) {
  const params = new URLSearchParams();
  const type = findTabForJobType(search.jobType);
  if (type && type !== 'maps') params.set('type', type);
  for (const field of ['keyword', 'city', 'state']) {
    if (search[field]) params.set(field, String(search[field]));
  }
  if (search.maxResults) params.set('maxResults', String(search.maxResults));
  const qs = params.toString();
  return `/leads/find${qs ? `?${qs}` : ''}`;
}

function searchMatchesWorkspace(search, wid) {
  const sw = String((search && search.workspaceId) || 'default').trim() || 'default';
  return sw === wid;
}

router.get('/', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const keys = await dbService.listSearches();
    const searches = [];
    let historyTruncated = false;
    // Newest keys first. Stop as soon as we have a page — scanning every remaining
    // search key just to count starved other menu hops on the same Node process.
    for (const key of keys) {
      if (searches.length >= HISTORY_PAGE_LIMIT) {
        historyTruncated = true;
        break;
      }
      const data = await dbService.getSearch(key);
      if (!data || !searchMatchesWorkspace(data, wid)) continue;
      searches.push({
        ...data,
        key,
        // Use stored folder labels — never rewrite folders on a history GET.
        targetFolderKey: data.targetFolderKey || '',
        targetFolderName: data.targetFolderName || '',
        runAgainHref: runAgainHref(data),
      });
    }

    const activeJob = await dbService.getActiveJob(wid);
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
      searchesTotal: searches.length,
      historyTruncated,
      activeJob: showSearchProgress ? activeJob : null,
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
