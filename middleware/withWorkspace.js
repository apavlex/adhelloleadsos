const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const workspaceScriptBootstrap = require('../services/workspaceScriptBootstrap');
const { wantsJsonResponse } = require('../lib/httpRequest');
const { getGoogleMapsApiKey } = require('../services/googleMapsKey');
const { isAgencySalesWorkspace } = require('../services/leadPanelWorkspace');
const { getQuickLogClientPayload } = require('../services/quickLogConfig');
const { resolveScriptSignOffProfile } = require('../services/scriptPlaceholders');
const { resolveAccentTextColor } = require('../lib/workspaceAccent');
const { normalizeCustomMenuLinks } = require('../services/customMenuLinks');

function attachWorkspaceQuickLog(res, ws) {
  const agencySales = isAgencySalesWorkspace(ws);
  res.locals.isAgencySalesWorkspace = agencySales;
  res.locals.quickLogClient = getQuickLogClientPayload({ agencySales });
}

/** In-process cache for sidebar workspace switcher (avoids N getWorkspace calls per nav). */
const SWITCHER_TTL_MS = 60_000;
const _switcherCache = new Map();

function switcherCacheKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * After auth: bootstrap workspaces, resolve active workspace (?ws= slug → session → user prefs → first),
 * attach req.workspace / req.workspaceId, res.locals for nav + accent.
 */
async function withWorkspace(req, res, next) {
  try {
    const email = workspaceService.userEmail(req);
    const path = String(req.path || '');
    const original = String(req.originalUrl || '');
    // Dial / status / softphone options need workspace id fast — skip switcher list + script seed.
    const telephonyFastPath =
      /\/telephony\//.test(path) ||
      /\/telephony\//.test(original) ||
      /\/leads\/[^/]+\/call/.test(original);

    // API key auth — no session, use 'default' workspace directly
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const isApiKeyAuth = apiKey && apiKey === (process.env.API_INGEST_KEY || 'adhello_secret_123');

    if (isApiKeyAuth && !email) {
      const wid = 'default';
      let ws = (await dbService.getWorkspace(wid)) || { id: wid, name: 'Default', slug: 'default' };
      req.workspace = ws;
      req.workspaceId = ws.id;
      res.locals.workspace = ws;
      res.locals.workspaceId = ws.id;
      res.locals.workspaceAccent = ws.accentColor || '#CA8A04';
      res.locals.workspaceAccentText = resolveAccentTextColor(ws.accentColor, ws.accentTextColor);
      attachWorkspaceQuickLog(res, ws);
      res.locals.scriptSignOffProfile = resolveScriptSignOffProfile({ user: req.user, workspace: ws });
      res.locals.customMenuLinks = normalizeCustomMenuLinks(ws.customMenuLinks);
      return next();
    }

    // ensureUserHasWorkspaces can scan all leads (agency prune) — once per session is enough.
    if (!(req.session && req.session._wsBootstrapped)) {
      await workspaceBootstrap.ensureUserHasWorkspaces(email);
      if (req.session) req.session._wsBootstrapped = 1;
    }

    let wid = null;
    const slugQ = req.query && req.query.ws ? String(req.query.ws).trim().toLowerCase() : '';
    if (slugQ) {
      const bySlug = await dbService.getWorkspaceIdForSlug(slugQ);
      const wsSlug = bySlug ? await dbService.getWorkspace(bySlug) : null;
      if (!wsSlug || !workspaceBootstrap.userCanAccessWorkspace(wsSlug, email)) {
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
      const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
      wid = ids[0] || null;
    }

    let ws = wid ? await dbService.getWorkspace(wid) : null;
    if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
      const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
      wid = null;
      ws = null;
      for (const id of ids) {
        const cand = await dbService.getWorkspace(id);
        if (cand && workspaceBootstrap.userCanAccessWorkspace(cand, email)) {
          wid = id;
          ws = cand;
          break;
        }
      }
    }

    if (!ws || !wid) {
      const inviteAccept =
        req.method === 'GET' && /^\/workspace\/invite\/[^/]+\/?$/.test(String(req.path || ''));
      if (inviteAccept) {
        req.workspace = null;
        req.workspaceId = '';
        req.workspaceRole = '';
        req.canManageWorkspace = false;
        res.locals.workspace = null;
        res.locals.workspaceId = '';
        res.locals.workspaceRole = '';
        res.locals.canManageWorkspace = false;
        res.locals.workspaceSwitcherList = [];
        res.locals.workspaceAccent = '#CA8A04';
        res.locals.customMenuLinks = [];
        res.locals.workspaceReturnPath = req.originalUrl || '/workspace/team';
        return next();
      }
      if (wantsJsonResponse(req)) {
        return res.status(403).json({
          success: false,
          error: 'This account is not on a workspace yet. Open your invite link first.',
        });
      }
      return res.status(403).render('error', {
        message:
          'This account is not on a workspace yet. Open the invite link, then sign in with that same Google account.',
        activePage: '',
      });
    }

    ws = (await workspaceService.ensureWorkspaceAndMember(ws.id, email)) || ws;

    if (!telephonyFastPath) {
      const needsScriptSeed =
        !workspaceScriptBootstrap.workspaceScriptsAlreadySeeded(ws) ||
        workspaceScriptBootstrap.shouldRepairAgencyCatalogLeak(ws);
      if (needsScriptSeed) {
        const refreshed = await workspaceScriptBootstrap.ensureWorkspaceScriptsSeeded(ws.id);
        ws = refreshed || ws;
      }
    }

    req.workspace = ws;
    req.workspaceId = ws.id;
    req.workspaceRole = workspaceService.roleForEmail(ws, email);
    req.canManageWorkspace = workspaceService.canManageTeam(req.workspaceRole);

    if (req.session) {
      req.session.activeWorkspaceId = ws.id;
      req.session.workspaceId = ws.id;
    }

    let summaries = [];
    if (!telephonyFastPath) {
      const sk = switcherCacheKey(email);
      const hit = sk && _switcherCache.get(sk);
      if (hit && Date.now() - hit.at < SWITCHER_TTL_MS) {
        summaries = hit.summaries;
      } else {
        const allIds = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
        const docs = await Promise.all(allIds.map((id) => dbService.getWorkspace(id)));
        for (const w of docs) {
          if (!w || w.archivedAt) continue;
          summaries.push({
            id: w.id,
            name: w.name || 'Workspace',
            slug: w.slug || '',
            accentColor: w.accentColor || '#CA8A04',
          });
        }
        if (sk) _switcherCache.set(sk, { at: Date.now(), summaries });
      }
    }

    res.locals.workspace = ws;
    res.locals.workspaceId = ws.id;
    res.locals.workspaceRole = req.workspaceRole;
    res.locals.canManageWorkspace = req.canManageWorkspace;
    res.locals.workspaceSwitcherList = summaries;
    res.locals.workspaceAccent = ws.accentColor || '#CA8A04';
    res.locals.workspaceAccentText = resolveAccentTextColor(ws.accentColor, ws.accentTextColor);
    res.locals.workspaceReturnPath = req.originalUrl || '/today';
    res.locals.googleMapsStaticKey = getGoogleMapsApiKey();
    attachWorkspaceQuickLog(res, ws);
    res.locals.scriptSignOffProfile = resolveScriptSignOffProfile({ user: req.user, workspace: ws });
    res.locals.customMenuLinks = normalizeCustomMenuLinks(ws.customMenuLinks);

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = withWorkspace;
