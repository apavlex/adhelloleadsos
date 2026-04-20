const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const scrapeCostAdvisor = require('../services/scrapeCostAdvisor');
const crawl4aiClient = require('../services/crawl4aiClient');
const outscraperClient = require('../services/outscraperClient');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { normalizeWorkspaceAccentHex, WORKSPACE_UI_ACCENTS } = require('../lib/workspaceAccent');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const {
  sanitizeBlockOverrides,
  sanitizeLibraryItems,
  normalizeLibraryItem,
} = salesScriptsStorage;

router.get('/', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    const pool = workspaceService.assignablePool(ws);
    const integrationMasks = workspaceIntegrations.integrationMasks(ws);
    const integrationsReady = workspaceIntegrations.isEncryptionAvailable();
    const q = req.query.integrations;
    let integrationsMessage = null;
    if (q === 'saved') {
      integrationsMessage = {
        type: 'ok',
        text: 'Saved. These keys apply to every member of this workspace (including admins) for Maps search, Enhance, and ingest auto-enrich.',
      };
    }
    if (q === 'need_secret') {
      integrationsMessage = {
        type: 'err',
        text: 'The server must set WORKSPACE_INTEGRATIONS_SECRET (at least 16 characters) before API keys can be stored from this page.',
      };
    }

    const wid = req.workspaceId;
    const resolvedEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    let scrapeLive = {};
    if (process.env.SCRAPE_SOURCES_LIVE_PING === '1') {
      const [c4, os] = await Promise.all([
        crawl4aiClient.pingHealth(resolvedEnv),
        outscraperClient.pingHealth(resolvedEnv),
      ]);
      scrapeLive = { crawl4ai: c4, outscraper: os };
    }
    const scrapeAdvisor = scrapeCostAdvisor.getDashboardPayload(scrapeLive, resolvedEnv);
    const scriptServiceLabels = Object.fromEntries(
      SCRIPT_LIBRARY_KEYS.map((k) => [k, SCRIPT_LIBRARY[k].label])
    );
    const SCRIPT_LIBRARY_MERGED = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const initialScriptLibraryItems = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);

    res.render('workspace', {
      title: 'Workspace & team',
      activePage: 'workspace',
      workspace: ws,
      assignPool: pool,
      envHintSdr: !!process.env.WORKSPACE_SDR_EMAILS,
      integrationMasks,
      integrationsReady,
      integrationsMessage,
      scrapeAdvisor,
      scrapeSourcesLivePing: process.env.SCRAPE_SOURCES_LIVE_PING === '1',
      scrapeCostOnWorkspace: true,
      workspaceAccentChoices: WORKSPACE_UI_ACCENTS,
      SCRIPT_LIBRARY: SCRIPT_LIBRARY_MERGED,
      SCRIPT_LIBRARY_KEYS,
      scriptServiceLabels,
      initialScriptLibraryItems,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/integrations', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).render('error', {
        message: 'Only workspace owners and admins can manage API integrations.',
        activePage: 'workspace',
      });
    }
    if (!workspaceIntegrations.isEncryptionAvailable()) {
      return res.redirect('/workspace?integrations=need_secret');
    }
    const wid = req.workspaceId;
    const ws = await dbService.getWorkspace(wid);
    let plain = workspaceIntegrations.decryptedFromWorkspace(ws);
    plain = workspaceIntegrations.applyClears(plain, req.body);
    plain = workspaceIntegrations.mergeIntegrationUpdates(plain, req.body);
    await workspaceIntegrations.saveWorkspaceIntegrations(wid, plain);
    res.redirect('/workspace?integrations=saved');
  } catch (e) {
    next(e);
  }
});

/** @deprecated — use POST /workspaces/switch */
router.post('/switch', express.urlencoded({ extended: true }), async (req, res) => {
  const id = String(req.body.workspaceId || '').trim();
  if (!id) return res.redirect('/workspace');
  const email = workspaceService.userEmail(req);
  const ws = await dbService.getWorkspace(id);
  if (!email || !ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
    return res.redirect('/workspace');
  }
  await dbService.saveUserPrefs(email, { activeWorkspaceId: id });
  if (req.session) {
    req.session.activeWorkspaceId = id;
    req.session.workspaceId = id;
  }
  res.redirect('/today');
});

/** POST JSON: ICP defaults (Today modal, Find preset). */
router.post('/icp', express.json(), async (req, res) => {
  try {
    const wid = req.workspaceId;
    await persistWorkspaceIcp(wid, {
      keyword: req.body && req.body.keyword,
      city: req.body && req.body.city,
      state: req.body && req.body.state,
      qty: req.body && req.body.qty,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Server error' });
  }
});

/** POST JSON: revenue defaults (avg deal, timezone for morning brief). */
router.post('/settings', express.json(), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can change workspace settings.' });
    }
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    if (req.body && req.body.avgDealValue != null && req.body.avgDealValue !== '') {
      const n = parseFloat(String(req.body.avgDealValue).replace(/,/g, ''), 10);
      if (Number.isFinite(n) && n > 0) ws.avgDealValue = n;
    }
    if (req.body && typeof req.body.timezone === 'string' && req.body.timezone.trim()) {
      ws.timezone = req.body.timezone.trim().slice(0, 64);
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'accentColor')) {
      const raw = req.body.accentColor;
      if (raw != null && String(raw).trim() !== '') {
        const norm = normalizeWorkspaceAccentHex(raw);
        if (!norm) {
          return res.status(400).json({ success: false, error: 'Invalid accent color.' });
        }
        ws.accentColor = norm;
      }
    }
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Server error' });
  }
});

/** GET JSON: script library + block overrides (workspace-scoped). */
router.get('/scripts.json', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    const items = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);
    const overrides =
      ws && ws.salesScriptBlockOverrides && typeof ws.salesScriptBlockOverrides === 'object'
        ? ws.salesScriptBlockOverrides
        : {};
    res.json({ success: true, libraryItems: items, blockOverrides: overrides });
  } catch (e) {
    next(e);
  }
});

/** PATCH JSON: merge script textarea overrides into workspace (all members). */
router.patch('/scripts/blocks', express.json({ limit: '500kb' }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const blocks = req.body && req.body.blocks;
    const patch = sanitizeBlockOverrides(blocks, SCRIPT_LIBRARY_KEYS);
    const prev =
      ws.salesScriptBlockOverrides && typeof ws.salesScriptBlockOverrides === 'object'
        ? ws.salesScriptBlockOverrides
        : {};
    const merged = { ...prev };
    for (const k of Object.keys(patch)) {
      merged[k] = { ...(merged[k] || {}), ...patch[k] };
    }
    ws.salesScriptBlockOverrides = merged;
    ws.salesScriptsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** POST JSON: add one saved library snippet. */
router.post('/scripts/library', express.json({ limit: '256kb' }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const item = normalizeLibraryItem(req.body || {}, SCRIPT_LIBRARY_KEYS);
    if (!item) return res.status(400).json({ success: false, error: 'Text required.' });
    const cur = Array.isArray(ws.salesScriptLibraryItems) ? [...ws.salesScriptLibraryItems] : [];
    cur.push(item);
    ws.salesScriptLibraryItems = cur;
    ws.salesScriptsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, item, libraryItems: cur });
  } catch (e) {
    next(e);
  }
});

/** DELETE: remove a library item by id. */
router.delete('/scripts/library/:id', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const id = String(req.params.id || '').trim();
    const cur = Array.isArray(ws.salesScriptLibraryItems) ? ws.salesScriptLibraryItems : [];
    const nextItems = cur.filter((x) => x && String(x.id) !== id);
    if (nextItems.length === cur.length) {
      return res.status(404).json({ success: false, error: 'Not found.' });
    }
    ws.salesScriptLibraryItems = nextItems;
    ws.salesScriptsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, libraryItems: nextItems });
  } catch (e) {
    next(e);
  }
});

/** POST JSON: bulk-import library items (e.g. migrate from localStorage). */
router.post('/scripts/library/import', express.json({ limit: '512kb' }), async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const incoming = req.body && req.body.items;
    const cleaned = sanitizeLibraryItems(incoming, SCRIPT_LIBRARY_KEYS);
    const cur = Array.isArray(ws.salesScriptLibraryItems) ? [...ws.salesScriptLibraryItems] : [];
    const existingIds = new Set(cur.map((x) => x && x.id).filter(Boolean));
    let n = 0;
    for (const it of cleaned) {
      let id = it.id;
      if (existingIds.has(id)) {
        id = `sv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        it.id = id;
      }
      existingIds.add(id);
      cur.push(it);
      n += 1;
    }
    ws.salesScriptLibraryItems = cur;
    ws.salesScriptsUpdatedAt = new Date().toISOString();
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, libraryItems: cur, imported: n });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
