/** Exposes lead search banner flag for SSR (no DB hit — client polls /api/status). */
function leadRunBanner(req, res, next) {
  res.locals.leadRunBannerVisible = req.query.searchInProgress === '1';
  res.locals.leadRunActiveJob = null;
  next();
}

module.exports = leadRunBanner;
