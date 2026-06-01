const dbService = require('../services/database');

/** Exposes active lead search job for the global progress banner in navbar. */
async function leadRunBanner(req, res, next) {
  res.locals.leadRunBannerVisible = req.query.searchInProgress === '1';
  res.locals.leadRunActiveJob = null;
  try {
    const activeJob = await dbService.getActiveJob();
    if (activeJob && activeJob.status === 'processing') {
      res.locals.leadRunBannerVisible = true;
      res.locals.leadRunActiveJob = activeJob;
    }
  } catch (_) {
    /* banner falls back to query flag only */
  }
  next();
}

module.exports = leadRunBanner;
