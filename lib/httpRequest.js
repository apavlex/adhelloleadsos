/**
 * True when the client expects JSON (API / fetch), not an HTML redirect or error page.
 */
function wantsJsonResponse(req) {
  const accept = String(req.get('accept') || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  const ct = String(req.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) return true;
  if (req.xhr) return true;
  const p = String(req.path || '');
  if (p.startsWith('/api/')) return true;
  if (p.startsWith('/leads/google-drive') || p.startsWith('/leads/drive-import')) return true;
  if (p === '/leads/ai-analysis/export-csv') return true;
  return false;
}

module.exports = { wantsJsonResponse };
