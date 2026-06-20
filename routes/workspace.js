const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const dbService = require('../services/database');
const workspaceService = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const dataPersistence = require('../services/dataPersistence');
const scrapeCostAdvisor = require('../services/scrapeCostAdvisor');
const mapsSearch = require('../services/mapsSearch');
const crawl4aiClient = require('../services/crawl4aiClient');
const outscraperClient = require('../services/outscraperClient');
const integrationProviderTests = require('../services/integrationProviderTests');
const ghlClient = require('../services/ghlClient');
const ghlSync = require('../services/ghlSync');
const lobClient = require('../services/lobClient');
const multer = require('multer');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { normalizeWorkspaceAccentHex, WORKSPACE_UI_ACCENTS } = require('../lib/workspaceAccent');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const signalwire = require('../services/signalwire');
const inboundForwardStats = require('../services/inboundForwardStats');
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
    const forwardNumber = signalwire.normalizePhone(item.forwardNumber || item.forwardTo || '');
    out.push({
      number,
      callerName,
      cnamStatus,
      cnamNotes,
      ...(forwardNumber ? { forwardNumber } : {}),
      inboundStats: inboundForwardStats.sanitizeInboundStats(item.inboundStats),
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

/** Keep server-side inbound counters when the UI saves CNAM / forward fields (client omits stats). */
function mergePhoneBankPreservingInboundStats(normalizedEntries, prevTelephony) {
  const prev = prevTelephony && Array.isArray(prevTelephony.numberBankEntries) ? prevTelephony.numberBankEntries : [];
  const map = new Map();
  prev.forEach((e) => {
    const n = signalwire.normalizePhone(e && e.number);
    if (n) map.set(n, e);
  });
  return normalizedEntries.map((e) => {
    const old = map.get(e.number);
    if (!old) return e;
    const merged = { ...e };
    if (old.inboundStats && typeof old.inboundStats === 'object') {
      merged.inboundStats = inboundForwardStats.sanitizeInboundStats(old.inboundStats);
    }
    if (old.lastInboundAt && !merged.lastInboundAt) merged.lastInboundAt = old.lastInboundAt;
    return merged;
  });
}

function upsertEntryByNumber(entries, patch) {
  const number = signalwire.normalizePhone(patch.number || '');
  if (!number) return entries;
  const idx = entries.findIndex((e) => e.number === number);
  const now = new Date().toISOString();
  if (idx === -1) {
    const fn = signalwire.normalizePhone(patch.forwardNumber || '');
    return [
      ...entries,
      {
        number,
        callerName: String(patch.callerName || '').trim().slice(0, 40),
        cnamStatus: normalizeCnamStatus(patch.cnamStatus || 'not_submitted'),
        cnamNotes: String(patch.cnamNotes || '').trim().slice(0, 280),
        ...(fn ? { forwardNumber: fn } : {}),
        inboundStats: inboundForwardStats.sanitizeInboundStats(patch.inboundStats),
        submittedAt: patch.submittedAt ? String(patch.submittedAt) : undefined,
        updatedAt: now,
      },
    ];
  }
  const cur = entries[idx];
  const next = {
    ...cur,
    number,
    cnamStatus: normalizeCnamStatus(patch.cnamStatus || cur.cnamStatus),
    callerName:
      patch.callerName != null ? String(patch.callerName).trim().slice(0, 40) : String(cur.callerName || ''),
    cnamNotes:
      patch.cnamNotes != null ? String(patch.cnamNotes).trim().slice(0, 280) : String(cur.cnamNotes || ''),
    updatedAt: now,
  };
  if (patch.forwardNumber != null) {
    const fn = signalwire.normalizePhone(patch.forwardNumber);
    if (fn) next.forwardNumber = fn;
    else delete next.forwardNumber;
  }
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

function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

function buildInvitePublicUrl(req, token) {
  const base = String(process.env.BASE_URL || '').trim() || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/workspace/invite/${encodeURIComponent(token)}`;
}

const WORKSPACE_SECTION_SLUGS = new Set([
  'pipeline',
  'branding',
  'team',
  'integrations',
  'phones',
  'voicemail',
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
    description:
      'API keys and provider preferences for this workspace, plus a cost-aware guide to how Find Leads and Enhance use each provider.',
  },
  phones: {
    title: 'Phone number bank',
    description: 'Outbound numbers, routing mode, and CNAM status.',
  },
  voicemail: {
    title: 'Voicemail',
    description: 'Recordings, voicemail script, active message, and scheduled drops.',
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
  const mapsProviderStatus = mapsSearch.getMapsProviderStatusList(resolvedEnv);
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

  const persistenceDeploymentHint = dataPersistence.deploymentPersistenceHint();
  const persistenceIntegrationsHint = dataPersistence.workspaceIntegrationsPersistenceHint(ws);

  const base = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  const ghlWebhookTokenHint = String(process.env.GHL_WEBHOOK_SECRET || process.env.API_INGEST_KEY || '').trim()
    ? 'configured-on-server'
    : '';
  const ghlStatus = ghlSync.statusFromEnv(resolvedEnv);
  return {
    title: 'Workspace & team',
    activePage: 'workspace',
    workspace: ws,
    publicAppBaseUrl: base,
    ghlWebhookTokenHint,
    ghlStatus,
    telephonyWebhookTokenConfigured: !!String(process.env.TELEPHONY_WEBHOOK_TOKEN || '').trim(),
    assignPool: pool,
    envHintSdr: !!process.env.WORKSPACE_SDR_EMAILS,
    integrationMasks,
    integrationsReady,
    integrationsMessage,
    persistenceDeploymentHint,
    persistenceIntegrationsHint,
    mapsSearchPrimary,
    mapsProviderStatus,
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
/** Legacy slug: scrape stack now lives on the Integrations page. */
router.get('/scrape', (req, res) => {
  res.redirect(302, '/workspace/integrations#workspace-scrape-cost');
});

/** Step-by-step GHL connection guide (linked from Integrations CRM card). */
router.get('/integrations/ghl-setup', async (req, res, next) => {
  try {
    const locals = await loadWorkspacePageLocals(req);
    const resolvedEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ghlStatus = { ...ghlSync.statusFromEnv(resolvedEnv) };
    if (ghlStatus.configured) {
      try {
        const test = await ghlClient.testConnection(resolvedEnv);
        ghlStatus.connected = true;
        ghlStatus.connectionMessage = test.message || 'Connected';
      } catch (e) {
        ghlStatus.connected = false;
        ghlStatus.connectionError = e && e.message ? e.message : 'Connection test failed';
      }
    }
    res.render('workspace', {
      ...locals,
      ghlStatus,
      title: 'Connect Go High Level · Workspace',
      workspaceSection: 'ghl-setup',
      workspaceSectionTitle: 'Connect Go High Level',
      workspaceSectionDescription:
        'Step-by-step instructions to link your GHL sub-account, verify the connection, and start syncing contacts.',
    });
  } catch (e) {
    next(e);
  }
});

/** Step-by-step Lob direct mail + design upload guide. */
router.get('/integrations/lob-setup', async (req, res, next) => {
  try {
    const locals = await loadWorkspacePageLocals(req);
    const resolvedEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const lobStatus = {
      configured: lobClient.isConfigured(resolvedEnv),
      testMode: lobClient.isTestMode(resolvedEnv),
      connectionMessage: '',
    };
    if (lobStatus.configured) {
      try {
        const test = await lobClient.testConnection(resolvedEnv);
        lobStatus.connectionMessage = test.message || 'Connected';
      } catch (e) {
        lobStatus.connectionError = e && e.message ? e.message : 'Connection test failed';
      }
    }
    res.render('workspace', {
      ...locals,
      lobStatus,
      title: 'Lob direct mail setup · Workspace',
      workspaceSection: 'lob-setup',
      workspaceSectionTitle: 'Postcard & letter designs',
      workspaceSectionDescription:
        'Design specs, PDF upload, and how to send test postcards through Lob.',
    });
  } catch (e) {
    next(e);
  }
});

const lobDesignUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mt = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    if (mt === 'application/pdf' || name.endsWith('.pdf')) return cb(null, true);
    cb(new Error('Upload a PDF file only.'));
  },
});

const LOB_DESIGN_FIELD_BY_SLOT = {
  postcard_front: 'lobPostcardFrontUrl',
  postcard_back: 'lobPostcardBackUrl',
  letter: 'lobLetterPdfUrl',
};

router.post('/integrations/lob-designs/upload', lobDesignUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can upload designs.' });
    }
    if (!workspaceIntegrations.isEncryptionAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'Workspace integrations secret is not configured on the server.',
      });
    }
    const slot = String(req.body && req.body.slot ? req.body.slot : req.query.slot || '').trim();
    const field = LOB_DESIGN_FIELD_BY_SLOT[slot];
    if (!field || !req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Choose a design slot and upload a PDF.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!lobClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Save your Lob API key and return address first, then upload designs.',
      });
    }

    const uploaded = await lobClient.uploadPdfAsset({
      buffer: req.file.buffer,
      filename: req.file.originalname || `${slot}.pdf`,
      integrationEnv,
    });

    const wid = req.workspaceId;
    const ws = await dbService.getWorkspace(wid);
    let plain = workspaceIntegrations.decryptedFromWorkspace(ws);
    plain[field] = uploaded.url;
    await workspaceIntegrations.saveWorkspaceIntegrations(wid, plain);

    res.json({
      success: true,
      slot,
      field,
      url: uploaded.url,
      uploadId: uploaded.id,
    });
  } catch (e) {
    if (e && e.message && /pdf/i.test(e.message)) {
      return res.status(400).json({ success: false, error: e.message });
    }
    next(e);
  }
});

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
    try {
      dataPersistence.backupSqliteSnapshot();
    } catch (e) {
      console.warn('[persist] Post-save backup skipped:', e && e.message ? e.message : e);
    }
    res.redirect('/workspace/integrations?integrations=saved');
  } catch (e) {
    next(e);
  }
});

async function integrationEnvForTest(req) {
  const base = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
  return integrationProviderTests.mergeBodyIntoIntegrationEnv(base, req.body);
}

async function saveIntegrationsFromRequest(req) {
  if (!workspaceIntegrations.isEncryptionAvailable()) {
    const err = new Error(
      'Integration keys cannot be saved until the workspace integrations secret is configured on the server.',
    );
    err.code = 'NEED_SECRET';
    throw err;
  }
  const wid = req.workspaceId;
  const ws = await dbService.getWorkspace(wid);
  let plain = workspaceIntegrations.decryptedFromWorkspace(ws);
  plain = workspaceIntegrations.applyClears(plain, req.body);
  plain = workspaceIntegrations.mergeIntegrationUpdates(plain, req.body);
  await workspaceIntegrations.saveWorkspaceIntegrations(wid, plain);
}

router.get('/integrations/test', async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can test integrations.' });
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const providers = await integrationProviderTests.runAllProviderTests(integrationEnv);
    const okCount = providers.filter((p) => p.ok).length;
    return res.json({
      success: true,
      providers,
      okCount,
      total: providers.length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e && e.message ? e.message : 'Test failed' });
  }
});

router.post('/integrations/test/:provider', async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can test integrations.' });
    }
    const providerId = String(req.params.provider || '').toLowerCase();
    if (!integrationProviderTests.PROVIDERS[providerId]) {
      return res.status(400).json({ success: false, error: `Unknown provider: ${providerId}` });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const shouldSave = Object.keys(body).length > 0;
    if (shouldSave) {
      await saveIntegrationsFromRequest(req);
      try {
        dataPersistence.backupSqliteSnapshot();
      } catch (e) {
        console.warn('[persist] Post-save backup skipped:', e && e.message ? e.message : e);
      }
    }
    const integrationEnv = shouldSave
      ? await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId)
      : await integrationEnvForTest(req);
    const result = await integrationProviderTests.runProviderTest(providerId, integrationEnv);
    return res.json({
      success: result.ok,
      provider: providerId,
      saved: shouldSave,
      ...result,
    });
  } catch (e) {
    const status = e && e.code === 'NEED_SECRET' ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: e && e.message ? e.message : 'Test failed',
    });
  }
});

router.post('/integrations/test', async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only admins can test integrations.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const shouldSave = Object.keys(body).length > 0;
    if (shouldSave) {
      await saveIntegrationsFromRequest(req);
      try {
        dataPersistence.backupSqliteSnapshot();
      } catch (e) {
        console.warn('[persist] Post-save backup skipped:', e && e.message ? e.message : e);
      }
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const providers = await integrationProviderTests.runAllProviderTests(integrationEnv);
    const okCount = providers.filter((p) => p.ok).length;
    return res.json({
      success: true,
      saved: shouldSave,
      providers,
      okCount,
      total: providers.length,
    });
  } catch (e) {
    const status = e && e.code === 'NEED_SECRET' ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: e && e.message ? e.message : 'Test failed',
    });
  }
});

router.post('/team/invite', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).render('error', {
        message: 'Only workspace owners and admins can invite members.',
        activePage: 'workspace',
      });
    }
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const email = String((req.body && req.body.email) || '')
      .trim()
      .toLowerCase();
    const roleRaw = String((req.body && req.body.role) || 'viewer')
      .trim()
      .toLowerCase();
    const allowedRoles = new Set(['viewer', 'sdr', 'admin']);
    const role = allowedRoles.has(roleRaw) ? roleRaw : 'viewer';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.redirect('/workspace/team?invite=invalid_email');
    }
    if (!email.endsWith('@adhello.ai')) {
      return res.redirect('/workspace/team?invite=domain_restricted');
    }
    if (ws.members && ws.members[email]) {
      return res.redirect('/workspace/team?invite=already_member');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashInviteToken(token);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const pending = Array.isArray(ws.pendingInvites) ? ws.pendingInvites : [];
    const filtered = pending.filter((x) => {
      if (!x || typeof x !== 'object') return false;
      const accepted = !!x.acceptedAt;
      const sameEmail = String(x.email || '').toLowerCase() === email;
      return !accepted && !sameEmail;
    });
    filtered.push({
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email,
      role,
      tokenHash,
      invitedBy: workspaceService.userEmail(req),
      invitedAt: nowIso,
      expiresAt,
      acceptedAt: '',
    });
    ws.pendingInvites = filtered.slice(-100);
    await dbService.saveWorkspace(wid, ws);
    const inviteLink = buildInvitePublicUrl(req, token);
    return res.redirect(
      `/workspace/team?invite=created&email=${encodeURIComponent(email)}&link=${encodeURIComponent(inviteLink)}`,
    );
  } catch (e) {
    return res.redirect('/workspace/team?invite=error');
  }
});

router.get('/invite/:token', async (req, res, next) => {
  try {
    const token = String((req.params && req.params.token) || '').trim();
    if (!token) return res.redirect('/workspace/team?invite=invalid');
    const tokenHash = hashInviteToken(token);
    const me = workspaceService.userEmail(req).toLowerCase();
    const workspaceIds = await dbService.listWorkspaceIds();
    for (const wid of workspaceIds) {
      const ws = await dbService.getWorkspace(wid);
      if (!ws || typeof ws !== 'object') continue;
      const pending = Array.isArray(ws.pendingInvites) ? ws.pendingInvites : [];
      const idx = pending.findIndex((x) => x && x.tokenHash === tokenHash);
      if (idx === -1) continue;
      const inv = pending[idx];
      const invEmail = String(inv.email || '').toLowerCase();
      if (!invEmail || invEmail !== me) {
        return res.redirect('/workspace/team?invite=wrong_account');
      }
      if (inv.acceptedAt) {
        return res.redirect('/workspace/team?invite=already_used');
      }
      if (inv.expiresAt && Date.parse(inv.expiresAt) < Date.now()) {
        return res.redirect('/workspace/team?invite=expired');
      }
      const role = new Set(['viewer', 'sdr', 'admin']).has(String(inv.role || 'viewer'))
        ? String(inv.role)
        : 'viewer';
      ws.members = {
        ...(ws.members || {}),
        [invEmail]: {
          role,
          joinedAt: new Date().toISOString(),
          invitedAt: inv.invitedAt || new Date().toISOString(),
          invitedBy: inv.invitedBy || '',
          userId: invEmail,
        },
      };
      if (Array.isArray(ws.roundRobinOrder)) {
        const has = ws.roundRobinOrder.some((x) => String(x || '').toLowerCase() === invEmail);
        if (!has && (role === 'sdr' || role === 'admin')) ws.roundRobinOrder = [...ws.roundRobinOrder, invEmail];
      }
      pending[idx] = { ...inv, acceptedAt: new Date().toISOString() };
      ws.pendingInvites = pending;
      await dbService.saveWorkspace(wid, ws);
      await dbService.addUserWorkspaceId(invEmail, wid);
      await dbService.saveUserPrefs(invEmail, { activeWorkspaceId: wid });
      if (req.session) {
        req.session.activeWorkspaceId = wid;
        req.session.workspaceId = wid;
      }
      return res.redirect('/workspace/team?invite=accepted');
    }
    return res.redirect('/workspace/team?invite=invalid');
  } catch (e) {
    next(e);
  }
});

/** Remove a pending (not yet accepted) invite. */
router.post('/team/invite/revoke', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).render('error', {
        message: 'Only workspace owners and admins can revoke invites.',
        activePage: 'workspace',
      });
    }
    const wid = req.workspaceId;
    const inviteId = String((req.body && req.body.inviteId) || '').trim();
    if (!inviteId) return res.redirect('/workspace/team?invite=revoke_error');
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const pending = Array.isArray(ws.pendingInvites) ? ws.pendingInvites : [];
    const next = pending.filter((x) => {
      if (!x || String(x.id || '') !== inviteId) return true;
      if (x.acceptedAt) return true;
      return false;
    });
    if (next.length === pending.length) {
      return res.redirect('/workspace/team?invite=revoke_not_found');
    }
    ws.pendingInvites = next;
    await dbService.saveWorkspace(wid, ws);
    return res.redirect('/workspace/team?invite=revoked');
  } catch (e) {
    return res.redirect('/workspace/team?invite=revoke_error');
  }
});

/** Issue a new token for an existing pending invite (invalidates old link). */
router.post('/team/invite/regenerate', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).render('error', {
        message: 'Only workspace owners and admins can regenerate invite links.',
        activePage: 'workspace',
      });
    }
    const wid = req.workspaceId;
    const inviteId = String((req.body && req.body.inviteId) || '').trim();
    if (!inviteId) return res.redirect('/workspace/team?invite=regen_error');
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const pending = Array.isArray(ws.pendingInvites) ? [...ws.pendingInvites] : [];
    const idx = pending.findIndex((x) => x && String(x.id || '') === inviteId);
    if (idx === -1) return res.redirect('/workspace/team?invite=regen_not_found');
    const inv = pending[idx];
    if (inv.acceptedAt) return res.redirect('/workspace/team?invite=already_accepted');
    const email = String(inv.email || '')
      .trim()
      .toLowerCase();
    if (!email) return res.redirect('/workspace/team?invite=regen_error');
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashInviteToken(token);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    pending[idx] = {
      ...inv,
      tokenHash,
      invitedBy: workspaceService.userEmail(req),
      invitedAt: nowIso,
      expiresAt,
    };
    ws.pendingInvites = pending;
    await dbService.saveWorkspace(wid, ws);
    const inviteLink = buildInvitePublicUrl(req, token);
    return res.redirect(
      `/workspace/team?invite=created&email=${encodeURIComponent(email)}&link=${encodeURIComponent(inviteLink)}`,
    );
  } catch (e) {
    return res.redirect('/workspace/team?invite=regen_error');
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
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'coffeeCouponLink')) {
      const raw = String(req.body.coffeeCouponLink || '').trim();
      if (!raw) {
        ws.coffeeCouponLink = '';
      } else {
        let parsed = null;
        try {
          parsed = new URL(raw);
        } catch (e) {
          return res.status(400).json({ success: false, error: 'Coffee coupon link must be a valid URL.' });
        }
        if (!/^https?:$/i.test(parsed.protocol)) {
          return res.status(400).json({ success: false, error: 'Coffee coupon link must start with http:// or https://.' });
        }
        ws.coffeeCouponLink = parsed.toString();
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
        const bankEntries = mergePhoneBankPreservingInboundStats(
          normalizePhoneBankEntries(
            Object.prototype.hasOwnProperty.call(req.body, 'phoneBankEntries')
              ? req.body.phoneBankEntries
              : req.body.phoneBank,
          ),
          ws.telephony,
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

/** POST JSON: create / rotate / disable client-facing phone analytics share link (read-only public URL). */
router.post('/phone-analytics-share', express.json(), async (req, res) => {
  try {
    if (!req.canManageWorkspace) {
      return res
        .status(403)
        .json({ success: false, error: 'Only workspace admins can manage the share link.' });
    }
    const action = String((req.body && req.body.action) || '').trim().toLowerCase();
    const wid = req.workspaceId;
    let ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};

    function buildShareUrl(token) {
      const base = String(process.env.BASE_URL || '').trim() || `${req.protocol}://${req.get('host')}`;
      return `${base.replace(/\/+$/, '')}/share/phone-analytics/${encodeURIComponent(wid)}/${encodeURIComponent(token)}`;
    }

    if (action === 'disable') {
      delete telephony.phoneAnalyticsShareTokenHash;
      delete telephony.phoneAnalyticsShareCreatedAt;
      ws.telephony = telephony;
      await dbService.saveWorkspace(wid, ws);
      return res.json({ success: true, active: false, shareUrl: null });
    }

    if (action === 'rotate' || action === 'generate') {
      const token = crypto.randomBytes(24).toString('hex');
      telephony.phoneAnalyticsShareTokenHash = hashInviteToken(token);
      telephony.phoneAnalyticsShareCreatedAt = new Date().toISOString();
      ws.telephony = telephony;
      await dbService.saveWorkspace(wid, ws);
      return res.json({
        success: true,
        active: true,
        shareUrl: buildShareUrl(token),
        token,
        createdAt: telephony.phoneAnalyticsShareCreatedAt,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Use action "generate", "rotate", or "disable".',
    });
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
    const managerSections = new Set(['phones', 'voicemail', 'revenue']);
    if (managerSections.has(section) && !req.canManageWorkspace) {
      return res.redirect(302, '/workspace/team');
    }
    if (
      (section === 'pipeline' || section === 'branding') &&
      (!req.canManageWorkspace || !ws || !ws.id)
    ) {
      return res.redirect(302, '/workspace/team');
    }
    const meta = WORKSPACE_SECTION_META[section] || { title: 'Workspace', description: '' };
    const inviteStatus = section === 'team' ? String((req.query && req.query.invite) || '') : '';
    const inviteEmail = section === 'team' ? String((req.query && req.query.email) || '') : '';
    const inviteLink = section === 'team' ? String((req.query && req.query.link) || '') : '';
    res.render('workspace', {
      ...locals,
      title: `${meta.title} · Workspace`,
      workspaceSection: section,
      workspaceSectionTitle: meta.title,
      workspaceSectionDescription: meta.description,
      inviteStatus,
      inviteEmail,
      inviteLink,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
