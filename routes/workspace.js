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

const WORKSPACE_SECTION_SLUGS = new Set([
  'pipeline',
  'branding',
  'team',
  'integrations',
  'phones',
  'voicemail',
  'scrape',
  'routing',
  'revenue',
  'advanced',
]);

const WORKSPACE_SECTION_META = {
  pipeline: {
    title: 'Pipeline stages',
    description: 'Reorder stages, apply presets, or redesign with AI. Leads stay mapped when you change the board.',
  },
  branding: {
    title: 'Brand accent',
    description: 'Primary buttons, nav highlights, and the workspace chip use this color.',
  },
  team: {
    title: 'Members & roles',
    description: 'Who belongs to this workspace and what they can do.',
  },
  integrations: {
    title: 'Integrations',
    description: 'API keys and provider preferences for this workspace.',
  },
  phones: {
    title: 'Phone number bank',
    description: 'Outbound numbers, routing mode, and CNAM status.',
  },
  voicemail: {
    title: 'Weekly voicemail automation',
    description: 'Recordings, active message, and scheduled drops.',
  },
  scrape: {
    title: 'Scrape stack',
    description: 'Cost-aware guidance for Maps search and enrichment providers.',
  },
  routing: {
    title: 'Round-robin pool',
    description: 'Next inbound assignee cycles through admins and SDRs.',
  },
  revenue: {
    title: 'Revenue defaults',
    description: 'Fallback values for pipeline metrics and the morning brief.',
  },
  advanced: {
    title: 'Advanced',
    description: 'Power-user options for this workspace.',
  },
};

function defaultWorkspaceHomePath(req, workspace) {
  if (!req.canManageWorkspace) return '/workspace/team';
  if (workspace && workspace.id) return '/workspace/pipeline';
  return '/workspace/integrations';
}

async function loadWorkspacePageLocals(req) {
  const ws = await dbService.getWorkspace(req.workspaceId);
  const pool = workspaceService.orderedRoundRobinPool(ws);
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
      text: 'Integration keys cannot be saved from the browser until your operator configures the workspace integrations secret on the server. Until then, only deployment environment variables apply.',
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

  return {
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
    showWorkspaceSwitchForm: process.env.ADHELLO_WORKSPACE_SWITCH === '1',
  };
}

router.get('/settings', (req, res) => res.redirect(302, '/workspace/team'));
// Tolerate common typo slugs that appeared in old/shared links.
router.get('/voicernail', (req, res) => res.redirect(302, '/workspace/voicemail'));
router.get('/voicenail', (req, res) => res.redirect(302, '/workspace/voicemail'));
router.get('/scripts', (req, res) => res.redirect(302, '/scripts'));

router.get('/', async (req, res, next) => {
  try {
    const iq = req.query && req.query.integrations;
    if (iq === 'saved' || iq === 'need_secret') {
      return res.redirect(
        302,
        `/workspace/integrations?integrations=${encodeURIComponent(String(iq))}`,
      );
    }
    const locals = await loadWorkspacePageLocals(req);
    res.redirect(302, defaultWorkspaceHomePath(req, locals.workspace));
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
      return res.redirect('/workspace/integrations?integrations=need_secret');
    }
    const wid = req.workspaceId;
    const ws = await dbService.getWorkspace(wid);
    let plain = workspaceIntegrations.decryptedFromWorkspace(ws);
    plain = workspaceIntegrations.applyClears(plain, req.body);
    plain = workspaceIntegrations.mergeIntegrationUpdates(plain, req.body);
    await workspaceIntegrations.saveWorkspaceIntegrations(wid, plain);
    res.redirect('/workspace/integrations?integrations=saved');
  } catch (e) {
    next(e);
  }
});

/** @deprecated — use POST /workspaces/switch */
router.post('/switch', express.urlencoded({ extended: true }), async (req, res) => {
  const id = String(req.body.workspaceId || '').trim();
  if (!id) return res.redirect('/workspace/team');
  const email = workspaceService.userEmail(req);
  const ws = await dbService.getWorkspace(id);
  if (!email || !ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
    return res.redirect('/workspace/team');
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

/** POST JSON: round-robin member order (admins + SDRs). */
router.post('/routing-order', express.json(), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can change round-robin order.' });
    }
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const incoming = req.body && Array.isArray(req.body.emails) ? req.body.emails : [];
    const normalized = workspaceService.normalizeRoundRobinOrder(ws, incoming);
    ws.roundRobinOrder = normalized;
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, emails: normalized });
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
        Object.prototype.hasOwnProperty.call(req.body, 'agentPhone') ||
        Object.prototype.hasOwnProperty.call(req.body, 'perNumberHourCap') ||
        Object.prototype.hasOwnProperty.call(req.body, 'quietHoursStart') ||
        Object.prototype.hasOwnProperty.call(req.body, 'quietHoursEnd'))
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
      if (Object.prototype.hasOwnProperty.call(req.body, 'perNumberHourCap')) {
        const cap = parseInt(String(req.body.perNumberHourCap || '').trim(), 10);
        if (!Number.isFinite(cap) || cap < 1 || cap > 120) {
          return res.status(400).json({
            success: false,
            error: 'Per-number dial cap must be between 1 and 120 calls per hour.',
          });
        }
        telephony.perNumberHourCap = cap;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'quietHoursStart')) {
        const s = String(req.body.quietHoursStart || '').trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) {
          return res.status(400).json({ success: false, error: 'Quiet hours start must be HH:MM.' });
        }
        telephony.quietHoursStart = s.length === 4 ? `0${s}` : s;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'quietHoursEnd')) {
        const s = String(req.body.quietHoursEnd || '').trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) {
          return res.status(400).json({ success: false, error: 'Quiet hours end must be HH:MM.' });
        }
        telephony.quietHoursEnd = s.length === 4 ? `0${s}` : s;
      }
      ws.telephony = telephony;
    }
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Server error' });
  }
});

/** GET JSON: phone numbers in the SignalWire project (for phone bank dropdown / datalist). */
router.get('/phone-bank/available-numbers', async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can view this.' });
    }
    const { numbers, error } = await signalwire.listIncomingPhoneNumbers();
    res.json({ success: true, numbers: numbers || [], error: error || null });
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

router.get('/:section', async (req, res, next) => {
  try {
    const section = String(req.params.section || '').toLowerCase();
    if (!WORKSPACE_SECTION_SLUGS.has(section)) {
      return next();
    }
    const locals = await loadWorkspacePageLocals(req);
    const ws = locals.workspace;
    const managerSections = new Set(['integrations', 'phones', 'voicemail', 'revenue']);
    if (managerSections.has(section) && !req.canManageWorkspace) {
      return res.redirect(302, '/workspace/team');
    }
    if (
      (section === 'pipeline' || section === 'branding') &&
      (!req.canManageWorkspace || !ws || !ws.id)
    ) {
      return res.redirect(302, '/workspace/team');
    }
    if (section === 'scrape' && !locals.scrapeAdvisor) {
      return res.redirect(302, '/workspace/team');
    }
    const meta = WORKSPACE_SECTION_META[section] || { title: 'Workspace', description: '' };
    res.render('workspace', {
      ...locals,
      title: `${meta.title} · Workspace`,
      workspaceSection: section,
      workspaceSectionTitle: meta.title,
      workspaceSectionDescription: meta.description,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
