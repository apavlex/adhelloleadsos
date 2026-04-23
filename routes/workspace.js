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
const signalwire = require('../services/signalwire');
const {
  sanitizeBlockOverrides,
  sanitizeLibraryItems,
  normalizeLibraryItem,
} = salesScriptsStorage;

function normalizeCnamStatus(raw) {
  const v = String(raw || 'not_submitted')
    .trim()
    .toLowerCase();
  const allowed = new Set(['not_submitted', 'submitted', 'in_review', 'approved', 'rejected', 'live']);
  return allowed.has(v) ? v : 'not_submitted';
}

function normalizePhoneBankEntries(raw) {
  const out = [];
  const pushEntry = (item) => {
    if (!item) return;
    const number = signalwire.normalizePhone(item.number || item.phone || item.value || item);
    if (!number) return;
    const callerName = String(item.callerName || item.cnamName || '').trim().slice(0, 40);
    const cnamStatus = normalizeCnamStatus(item.cnamStatus || item.status);
    const cnamNotes = String(item.cnamNotes || item.notes || '').trim().slice(0, 280);
    out.push({
      number,
      callerName,
      cnamStatus,
      cnamNotes,
      submittedAt: item.submittedAt ? String(item.submittedAt) : undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  if (Array.isArray(raw)) {
    raw.forEach(pushEntry);
  } else if (raw && typeof raw === 'object') {
    Object.values(raw).forEach(pushEntry);
  } else {
    String(raw || '')
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((n) => pushEntry({ number: n }));
  }

  const dedup = new Map();
  out.forEach((entry) => {
    dedup.set(entry.number, entry);
  });
  return [...dedup.values()].slice(0, 50);
}

function numberListFromEntries(entries) {
  return entries.map((e) => e.number).filter(Boolean);
}

function upsertEntryByNumber(entries, patch) {
  const number = signalwire.normalizePhone(patch.number || '');
  if (!number) return entries;
  const idx = entries.findIndex((e) => e.number === number);
  const now = new Date().toISOString();
  if (idx === -1) {
    return [
      ...entries,
      {
        number,
        callerName: String(patch.callerName || '').trim().slice(0, 40),
        cnamStatus: normalizeCnamStatus(patch.cnamStatus || 'not_submitted'),
        cnamNotes: String(patch.cnamNotes || '').trim().slice(0, 280),
        submittedAt: patch.submittedAt ? String(patch.submittedAt) : undefined,
        updatedAt: now,
      },
    ];
  }
  const cur = entries[idx];
  const next = {
    ...cur,
    ...patch,
    number,
    cnamStatus: normalizeCnamStatus(patch.cnamStatus || cur.cnamStatus),
    callerName:
      patch.callerName != null ? String(patch.callerName).trim().slice(0, 40) : String(cur.callerName || ''),
    cnamNotes:
      patch.cnamNotes != null ? String(patch.cnamNotes).trim().slice(0, 280) : String(cur.cnamNotes || ''),
    updatedAt: now,
  };
  const cloned = [...entries];
  cloned[idx] = next;
  return cloned;
}

function normalizeCallMode(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'browser_device') return 'browser_device';
  if (mode === 'agent_first') return 'agent_first';
  return 'cloud_dial';
}

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
    const mapsSearchPrimary = String(
      (resolvedEnv && resolvedEnv.SEARCH_MAPS_PRIMARY) || process.env.SEARCH_MAPS_PRIMARY || 'auto',
    )
      .trim()
      .toLowerCase();
    const enrichPrimary = String(
      (resolvedEnv && resolvedEnv.ENRICH_PRIMARY) || process.env.ENRICH_PRIMARY || 'auto',
    )
      .trim()
      .toLowerCase();
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
      mapsSearchPrimary,
      enrichPrimary,
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
    if (
      req.body &&
      (Object.prototype.hasOwnProperty.call(req.body, 'phoneBank') ||
        Object.prototype.hasOwnProperty.call(req.body, 'phoneBankEntries') ||
        Object.prototype.hasOwnProperty.call(req.body, 'callMode') ||
        Object.prototype.hasOwnProperty.call(req.body, 'agentPhone'))
    ) {
      const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
      if (
        Object.prototype.hasOwnProperty.call(req.body, 'phoneBankEntries') ||
        Object.prototype.hasOwnProperty.call(req.body, 'phoneBank')
      ) {
        const bankEntries = normalizePhoneBankEntries(
          Object.prototype.hasOwnProperty.call(req.body, 'phoneBankEntries')
            ? req.body.phoneBankEntries
            : req.body.phoneBank
        );
        const bank = numberListFromEntries(bankEntries);
        telephony.numberBankEntries = bankEntries;
        telephony.numberBank = bank;
        const requestedActive = signalwire.normalizePhone(req.body.activeCallerId || req.body.activeFromNumber || '');
        if (requestedActive && bank.includes(requestedActive)) {
          telephony.activeFromNumber = requestedActive;
        } else if (telephony.activeFromNumber && bank.includes(telephony.activeFromNumber)) {
          // keep existing active number
        } else {
          telephony.activeFromNumber = bank[0] || '';
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'callMode')) {
        telephony.callMode = normalizeCallMode(req.body.callMode);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'agentPhone')) {
        const raw = String(req.body.agentPhone || '').trim();
        if (!raw) {
          telephony.agentPhone = '';
        } else {
          const n = signalwire.normalizePhone(req.body.agentPhone);
          if (!n) {
            return res
              .status(400)
              .json({ success: false, error: 'Agent phone must be a valid E.164 number (e.g. +15551234567).' });
          }
          telephony.agentPhone = n;
        }
      }
      ws.telephony = telephony;
    }
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Server error' });
  }
});

/** POST JSON: mark a number's CNAM request as submitted (and optionally notify webhook). */
router.post('/phone-bank/cnam-submit', express.json(), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can submit CNAM requests.' });
    }
    const wid = req.workspaceId;
    const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
    let entries = normalizePhoneBankEntries(telephony.numberBankEntries || telephony.numberBank || []);
    const number = signalwire.normalizePhone(req.body && req.body.number);
    if (!number) return res.status(400).json({ success: false, error: 'Valid number required.' });
    entries = upsertEntryByNumber(entries, {
      number,
      callerName: req.body && req.body.callerName,
      cnamStatus: 'submitted',
      cnamNotes: req.body && req.body.cnamNotes,
      submittedAt: new Date().toISOString(),
    });
    telephony.numberBankEntries = entries;
    telephony.numberBank = numberListFromEntries(entries);
    if (!telephony.activeFromNumber) telephony.activeFromNumber = number;
    ws.telephony = telephony;
    await dbService.saveWorkspace(wid, ws);

    const hook = String(process.env.CNAM_REQUEST_WEBHOOK_URL || '').trim();
    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'cnam.request_submitted',
            workspaceId: wid,
            number,
            callerName: String((req.body && req.body.callerName) || ''),
            notes: String((req.body && req.body.cnamNotes) || ''),
            submittedAt: new Date().toISOString(),
          }),
        });
      } catch (_) {
        /* non-fatal */
      }
    }
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
