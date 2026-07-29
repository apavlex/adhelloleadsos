const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { resolveSearchRecordFolderContext } = require('../services/pipelineFolders');

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
        };
      }),
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
