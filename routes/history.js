const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { resolveSearchRecordFolderContext } = require('../services/pipelineFolders');
const { findTabForJobType } = require('../services/searchTypeConfig');

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

router.get('/', async (req, res, next) => {
  try {
    const allSearches = await dbService.getAllSearches();
    const wid = req.workspaceId;
    const scoped = allSearches.filter((s) => (s.workspaceId || 'default') === wid);
    const searches = await Promise.all(
      scoped.map(async (search) => {
        const folderCtx = await resolveSearchRecordFolderContext(wid, search);
        return {
          ...search,
          targetFolderKey: folderCtx.targetFolderKey || search.targetFolderKey || '',
          targetFolderName: folderCtx.targetFolderName || search.targetFolderName || '',
          runAgainHref: runAgainHref(search),
        };
      }),
    );
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
