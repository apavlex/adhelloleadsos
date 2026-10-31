/**
 * Document prefetch (nav-prefetch.js) must not run full page renders.
 * Hover / idle warm used to fire full getAllLeads HTML routes and jam
 * the event loop so real navigations stalled under the nav spinner.
 *
 * Browser link-prefetch and fetch(..., Purpose: prefetch) both send
 * Sec-Purpose / Purpose: prefetch — answer 204 so the response is cheap.
 * Real navigations use Sec-Fetch-Mode: navigate and are unaffected.
 */
function isDocumentPrefetch(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const purpose = String(req.get('sec-purpose') || req.get('purpose') || '');
  if (!/prefetch/i.test(purpose)) return false;
  // JSON / XHR APIs still need real data when prefetched intentionally.
  const accept = String(req.get('accept') || '').toLowerCase();
  if (accept.includes('application/json')) return false;
  if (req.xhr) return false;
  const path = String(req.path || '');
  if (path.startsWith('/api/')) return false;
  if (/\.json$/i.test(path)) return false;
  return true;
}

function skipDocumentPrefetch(req, res, next) {
  if (!isDocumentPrefetch(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(204).end();
}

module.exports = skipDocumentPrefetch;
module.exports.isDocumentPrefetch = isDocumentPrefetch;
