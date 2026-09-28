/**
 * Records team activity for search endpoints that don't log it themselves.
 * Runs after attachWorkspace; writes only when the response succeeds.
 */
const teamActivity = require('../services/teamActivity');

const SEARCH_ROUTES = [
  { path: '/permits/search', action: 'permit_search', label: 'Permit search' },
  { path: '/formations/search', action: 'formation_search', label: 'Business formation search' },
  { path: '/real-estate/search', action: 'real_estate_search', label: 'Real estate search' },
  { path: '/listings/search', action: 'listing_search', label: 'Listing search' },
  { path: '/mobile-homes/search', action: 'mobile_home_search', label: 'Mobile home search' },
];

function firstText(...values) {
  for (const v of values) {
    const s = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function searchSummary(route, body) {
  const what = firstText(body.keyword, body.permitKeyword, body.category, body.query, body.propertyType);
  const where = firstText(
    [firstText(body.city, body.permitCity, body.location), firstText(body.state, body.stateCodes)].filter(Boolean),
    body.zip,
  );
  let summary = route.label;
  if (what) summary += ` "${what}"`;
  if (where) summary += ` in ${where}`;
  if (String(body.mode || '').toLowerCase() === 'schedule') summary = `Scheduled ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
  return summary;
}

module.exports = function teamActivityCapture(req, res, next) {
  if (req.method !== 'POST') return next();
  const route = SEARCH_ROUTES.find((r) => req.path === r.path);
  if (!route) return next();
  const ctx = teamActivity.captureContext(req);
  const body = req.body || {};
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    teamActivity.record(ctx, {
      category: 'search',
      action: route.action,
      summary: searchSummary(route, body),
      meta: body.folderKey ? { folderKey: String(body.folderKey) } : null,
    });
  });
  next();
};

module.exports._test = { searchSummary, SEARCH_ROUTES };
