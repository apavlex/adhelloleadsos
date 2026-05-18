const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { wantsJsonResponse } = require('../lib/httpRequest');
const { getGoogleMapsApiKey } = require('../services/googleMapsKey');

/**
 * After auth: bootstrap workspaces, resolve active workspace (?ws= slug → session → user prefs → first),
 * attach req.workspace / req.workspaceId, res.locals for nav + accent.
 */
async function withWorkspace(req, res, next) {
  try {
    const email = workspaceService.userEmail(req);
    await workspaceBootstrap.ensureUserHasWorkspaces(email);

    let wid = null;
    const slugQ =
      req.query && req.query.ws ? String(req.query.ws).trim().toLowerCase() : '';
    if (slugQ) {
      const bySlug = await dbService.getWorkspaceIdForSlug(slugQ);
      const wsSlug = bySlug ? await dbService.getWorkspace(bySlug) : null;
      if (
        !wsSlug ||
        !workspaceBootstrap.userCanAccessWorkspace(wsSlug, email)
      ) {
        if (wantsJsonResponse(req)) {
          return res.status(404).json({ success: false, error: 'Workspace not found.' });
        }
        return res.status(404).render('error', {
          message: 'Workspace not found.',
          activePage: '',
        });
      }
      wid = wsSlug.id;
    }

    if (!wid && req.session) {
      wid =
        (req.session.activeWorkspaceId && String(req.session.activeWorkspaceId)) ||
        (req.session.workspaceId && String(req.session.workspaceId)) ||
        null;
    }

    if (!wid) {
      const prefs = await dbService.getUserPrefs(email);
      wid = prefs && prefs.activeWorkspaceId ? String(prefs.activeWorkspaceId) : null;
    }

    if (!wid) {
      const ids = await dbService.getUserWorkspaceIds(email);
      wid = ids[0] || null;
    }

    let ws = wid ? await dbService.getWorkspace(wid) : null;
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      const ids = await dbService.getUserWorkspaceIds(email);
      wid = ids[0] || null;
      ws = wid ? await dbService.getWorkspace(wid) : null;
    }

    if (!ws || !wid) {
      return next(new Error('No workspace available for this account.'));
    }

    await workspaceService.ensureWorkspaceAndMember(ws.id, email);

    const refreshed = await dbService.getWorkspace(ws.id);
    ws = refreshed || ws;

    req.workspace = ws;
    req.workspaceId = ws.id;
    req.workspaceRole = workspaceService.roleForEmail(ws, email);
    req.canManageWorkspace = workspaceService.canManageTeam(req.workspaceRole);

    if (req.session) {
      req.session.activeWorkspaceId = ws.id;
      req.session.workspaceId = ws.id;
    }

    const summaries = [];
    const allIds = await dbService.getUserWorkspaceIds(email);
    for (const id of allIds) {
      const w = await dbService.getWorkspace(id);
      if (!w) continue;
      summaries.push({
        id: w.id,
        name: w.name || 'Workspace',
        slug: w.slug || '',
        accentColor: w.accentColor || '#CA8A04',
      });
    }

    res.locals.workspace = ws;
    res.locals.workspaceId = ws.id;
    res.locals.workspaceRole = req.workspaceRole;
    res.locals.canManageWorkspace = req.canManageWorkspace;
    res.locals.workspaceSwitcherList = summaries;
    res.locals.workspaceAccent = ws.accentColor || '#CA8A04';
    res.locals.googleMapsStaticKey = getGoogleMapsApiKey();

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = withWorkspace;
