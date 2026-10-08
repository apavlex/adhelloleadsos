/**
 * Blocks page navigations to sidebar pages a role has been switched off for
 * (Team page → Roles & access). Owners and platform admins are never blocked.
 */
const rolePermissions = require('../services/rolePermissions');
const { seesOnlyAssignedLeads } = require('../services/workspaceService');

function isPageNavigation(req) {
  if (req.method !== 'GET') return false;
  const mode = String(req.get('sec-fetch-mode') || '').toLowerCase();
  if (mode) return mode === 'navigate';
  return String(req.get('accept') || '').toLowerCase().includes('text/html');
}

function rolePageGate(req, res, next) {
  const ws = req.workspace;
  const role = req.workspaceRole || '';
  res.locals.navCan = (pageId) => !ws || rolePermissions.canAccessPage(ws, role, pageId);
  res.locals.onlyAssignedLeads = !!ws && seesOnlyAssignedLeads(req);
  if (!ws || role === 'owner' || res.locals.canManageDemo) return next();

  const path = String(req.path || '');
  if (!isPageNavigation(req) || rolePermissions.isAlwaysOpen(path)) return next();
  const pageId = rolePermissions.pageForPath(path);
  if (!pageId || rolePermissions.canAccessPage(ws, role, pageId)) return next();

  if (pageId === 'today') {
    const home = rolePermissions.homePath(ws, role);
    if (home) return res.redirect(home);
  }
  const page = rolePermissions.PAGES.find((p) => p.id === pageId);
  return res.status(403).render('error', {
    message: `Your role in this workspace doesn't include ${page ? page.label : 'this page'}. Ask a workspace owner if you need it.`,
    activePage: '',
  });
}

module.exports = rolePageGate;
