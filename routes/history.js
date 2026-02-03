const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

router.get('/', async (req, res, next) => {
  try {
    const searches = await dbService.getAllSearches();
    res.render('history', {
      title: 'Search History',
      activePage: 'history',
      searches,
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
