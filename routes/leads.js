const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const router = express.Router();
const dbService = require('../services/database');
const firecrawl = require('../services/firecrawl');
const webEnrichment = require('../services/webEnrichment');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const mapsEnrichFallback = require('../services/mapsEnrichFallback');
const betterContact = require('../services/betterContactClient');
const websiteAiAnalysis = require('../services/websiteAiAnalysis');
const pageSpeedInsights = require('../services/pageSpeedInsights');
const { createAuditReportToken } = require('../services/auditReportSign');
const { parseImportFile } = require('../services/csvLeadImport');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const { CHANNELS: OUTREACH_CHANNELS, buildOutreachLibrary } = require('../services/outreachChannelScripts');
const pipelineStagesService = require('../services/pipelineStagesService');
const { scoreLeadRecord } = require('../services/opportunityScore');
const { chatCompletion } = require('../services/llmClient');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
} = require('../services/leadListFilters');
const activationService = require('../services/activationService');
const sequenceEngine = require('../services/sequenceEngine');
const { autoAttachCadenceIfNeeded } = require('../services/leadCadence');
const dialerPacing = require('../services/dialerPacing');
const workspaceService = require('../services/workspaceService');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const googleDriveAccess = require('../services/googleDriveAccess');
const { downloadDriveFileAsCsvBuffer } = require('../services/googleDriveCsv');
const { uploadCsvToDrive, safeDriveFileName } = require('../services/googleDriveUpload');
const signalwire = require('../services/signalwire');
const salesScriptsStorage = require('../services/salesScriptsStorage');

async function importLeadRecordsFromBuffer(buffer, originalFilename, req, importOptions = {}) {
  const parseOpts =
    typeof importOptions.leadSource === 'string' && importOptions.leadSource.trim()
      ? { leadSource: importOptions.leadSource.trim() }
      : {};
  const parsed = parseImportFile(buffer, originalFilename || 'import.csv', parseOpts);
  const records = parsed.leads;
  const rawRowCount = parsed.rawRowCount;
  const wid = req.workspaceId;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of records) {
    if (!rec.title) {
      skipped += 1;
      continue;
    }
    let willMerge = false;
    if (rec.email && rec.email !== 'N/A') {
      const ex = await dbService.findLeadByEmail(rec.email, wid);
      willMerge = !!ex;
    } else if (rec.ip) {
      const ex = await dbService.findLeadByIp(rec.ip, wid);
      willMerge = !!ex;
    }
    try {
      const key = await dbService.saveLead({
        ...rec,
        workspaceId: wid,
      });
      try {
        await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: wid });
      } catch (_) {
        /* non-fatal */
      }
      if (willMerge) updated += 1;
      else created += 1;
    } catch (e) {
      console.error('[CSV import] row error:', rec.title, e.message);
      failed += 1;
    }
  }

  const applied = created + updated;
  if (applied > 0) {
    const ev =
      typeof importOptions.activationEvent === 'string' && importOptions.activationEvent.trim()
        ? importOptions.activationEvent.trim()
        : 'csv_import';
    await activationService.recordEvent(userEmail(req), ev);
  }

  const rejected = Math.max(0, rawRowCount - records.length);
  if (rawRowCount === 0) {
    console.warn('[CSV import] No data rows parsed from file:', originalFilename);
  } else if (records.length === 0) {
    console.warn(
      '[CSV import] Parsed',
      rawRowCount,
      'row(s) but 0 importable leads — check column headers (company_name, business_name, title, name, website, email):',
      originalFilename
    );
  }

  return {
    records,
    rawRowCount,
    rejected,
    created,
    updated,
    skipped,
    failed,
    applied,
    rows: records.length,
  };
}

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  return updates;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ok) cb(null, true);
    else cb(new Error('Upload a .csv or .xlsx file only.'));
  },
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = String(file.mimetype || '').toLowerCase();
    if (mt.startsWith('audio/')) return cb(null, true);
    cb(new Error('Upload an audio file only.'));
  },
});

// GET /leads — canonical URL is /prospecting?tab=pipeline (bookmark-safe redirect)
router.get('/', (req, res) => {
  const params = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => {
    if (k === 'tab') return;
    if (v == null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)));
    else params.set(k, String(v));
  });
  params.set('tab', 'pipeline');
  res.redirect(302, `/prospecting?${params.toString()}`);
});

// Legacy URL — warm leads now live on the main board with ?source=inbound
router.get('/inbound', (req, res) => {
  res.redirect(302, '/leads?source=inbound');
});

// GET /leads/saved — return all saved lead titles+keys for client-side bookmark state
router.get('/saved', async (req, res, next) => {
  try {
    const leads = filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
    const saved = leads.map((l) => ({ key: l.key, title: l.title }));
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// GET /leads/list.json — lightweight list for folders / client filtering
router.get('/list.json', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const filters = {
      folderKey: req.query.folderKey,
      excludeFolderAssigned:
        req.query.excludeFolderAssigned === '1' || req.query.excludeFolderAssigned === 'true',
      ...normalizeLeadListFilters(req.query),
    };
    const out = applyLeadListFilters(visible, filters);

    res.json({
      success: true,
      leads: out.map(mapLeadListJson),
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/save — bookmark a lead (called via fetch from client JS)
router.post('/save', async (req, res, next) => {
  try {
    const {
      title,
      phone,
      website,
      email,
      categoryName,
      address,
      city,
      state,
      totalScore,
      reviewsCount,
      url,
      facebook,
      instagram,
      twitter,
      note,
      source,
      folderKey,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Lead title is required.' });
    }

    const isManual =
      source === 'manual' || source === 'manual_offline' || String(source || '').startsWith('manual');

    const leadData = {
      title,
      phone: phone || 'N/A',
      website: website || 'N/A',
      email: email || 'N/A',
      categoryName:
        categoryName && String(categoryName).trim()
          ? categoryName
          : isManual
            ? 'Offline / word of mouth'
            : 'N/A',
      address: address || 'N/A',
      city: city || '',
      state: state || '',
      totalScore: parseFloat(totalScore) || 0,
      reviewsCount: parseInt(reviewsCount, 10) || 0,
      url: url || '',
      facebook: facebook || 'N/A',
      instagram: instagram || 'N/A',
      twitter: twitter || 'N/A',
      status: 'Not Contacted',
      loomUrl: '',
      savedAt: new Date().toISOString(),
      workspaceId: req.workspaceId,
    };

    if (isManual) {
      leadData.source = 'manual_offline';
    }
    if (folderKey && String(folderKey).trim()) {
      leadData.folderKey = String(folderKey).trim();
    }

    const noteText = note != null ? String(note).trim() : '';
    if (noteText) {
      leadData.updates = [
        {
          type: 'note',
          value: noteText,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    const key = await dbService.saveLead(leadData);
    try {
      await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: req.workspaceId });
    } catch (_) {
      /* non-fatal */
    }
    if (isManual) {
      try {
        await activationService.recordEvent(userEmail(req), 'manual_lead_added');
      } catch (_) {
        /* non-fatal */
      }
    }
    res.json({ success: true, key });
  } catch (err) {
    next(err);
  }
});

// GET /leads/google-drive/status — whether user linked Drive + Picker can run in browser
router.get('/google-drive/status', async (req, res) => {
  try {
    const email = userEmail(req);
    const row = email ? await dbService.getGoogleDriveTokens(email) : null;
    res.json({
      pickerReady: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_PICKER_API_KEY
      ),
      connected: !!(row && row.refreshToken),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'status failed' });
  }
});

// GET /leads/google-drive/access-token — short-lived token for Google Picker (same-origin only)
router.get('/google-drive/access-token', async (req, res) => {
  try {
    const token = await googleDriveAccess.getValidAccessToken(userEmail(req));
    if (!token) {
      return res.status(401).json({
        success: false,
        connected: false,
        error: 'Connect Google Drive from the Pipeline tab first.',
      });
    }
    res.json({ success: true, accessToken: token });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'token failed' });
  }
});

// POST /leads/google-drive/upload-csv — save a lead list CSV to the user's Google Drive
router.post('/google-drive/upload-csv', async (req, res) => {
  try {
    const csv = req.body && req.body.csv;
    if (csv == null || !String(csv).trim()) {
      return res.status(400).json({ success: false, error: 'csv content is required.' });
    }
    const access = await googleDriveAccess.getValidAccessToken(userEmail(req));
    if (!access) {
      return res.status(401).json({
        success: false,
        connected: false,
        error: 'Connect Google Drive from the Pipeline tab first (import & export).',
      });
    }
    const date = new Date().toISOString().slice(0, 10);
    const filename = safeDriveFileName(
      (req.body && req.body.filename) || `AdHello_Leads_${date}.csv`
    );
    const folderId =
      req.body && req.body.folderId ? String(req.body.folderId).trim() : '';
    const uploaded = await uploadCsvToDrive(access, {
      name: filename,
      content: String(csv),
      folderId: folderId || undefined,
      useDefaultFolder: !folderId,
    });
    res.json({
      success: true,
      fileId: uploaded.id,
      name: uploaded.name,
      webViewLink: uploaded.webViewLink || null,
    });
  } catch (e) {
    console.error('[drive-upload]', e);
    const scope = e && e.code === 'DRIVE_SCOPE';
    res.status(scope ? 403 : 400).json({
      success: false,
      error:
        e.message ||
        (scope
          ? 'Reconnect Google Drive to allow saving files (Connect Google Drive).'
          : 'Drive upload failed'),
      needsReconnect: scope,
    });
  }
});

// POST /leads/drive-import/google — import CSV or Google Sheet by Drive file id (after Picker)
router.post('/drive-import/google', async (req, res, next) => {
  try {
    const fileId = String((req.body && req.body.fileId) || '').trim();
    if (!fileId) {
      return res.status(400).json({ success: false, error: 'fileId is required.' });
    }
    const access = await googleDriveAccess.getValidAccessToken(userEmail(req));
    if (!access) {
      return res.status(401).json({ success: false, error: 'Google Drive is not connected for this account.' });
    }
    const { buffer, name } = await downloadDriveFileAsCsvBuffer(access, fileId);
    const pack = await importLeadRecordsFromBuffer(buffer, name, req, {
      leadSource: 'google_drive',
      activationEvent: 'drive_csv_import',
    });
    res.json({
      success: true,
      imported: pack.applied,
      created: pack.created,
      updated: pack.updated,
      skipped: pack.skipped,
      failed: pack.failed,
      totalRows: pack.rows,
      rawRows: pack.rawRowCount,
      rejected: pack.rejected,
    });
  } catch (e) {
    console.error('[drive-import]', e);
    res.status(400).json({ success: false, error: e.message || 'Drive import failed' });
  }
});

// POST /leads/import — bulk import from CSV (Agency OS / enrichment export shape)
router.post('/import', (req, res, next) => {
  upload.single('csvfile')(req, res, (err) => {
    if (err) {
      const wantsJson = req.get('accept') && req.get('accept').includes('application/json');
      const msg = err instanceof multer.MulterError ? err.message : err.message || 'Upload failed';
      if (wantsJson) {
        return res.status(400).json({ success: false, error: msg });
      }
      return res.redirect(`/prospecting?tab=pipeline&importError=${encodeURIComponent(msg)}`);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ success: false, error: 'No CSV file received (field name: csvfile).' });
      }
      return res.redirect(
        '/prospecting?tab=pipeline&rows=0&rawRows=0&rejected=0&created=0&updated=0&imported=0&skipped=0&failed=0'
      );
    }

    const pack = await importLeadRecordsFromBuffer(req.file.buffer, req.file.originalname || 'import.csv', req);
    const { created, updated, skipped, failed, rows, rawRowCount, rejected } = pack;
    const applied = pack.applied;
    const q = `rows=${rows}&rawRows=${rawRowCount}&rejected=${rejected}&created=${created}&updated=${updated}&imported=${applied}&skipped=${skipped}&failed=${failed}`;
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        success: true,
        imported: applied,
        created,
        updated,
        skipped,
        failed,
        totalRows: rows,
      });
    }
    res.redirect(`/prospecting?tab=pipeline&${q}`);
  } catch (err) {
    next(err);
  }
});

function leadKeyFromParam(key) {
  return key.startsWith('lead:') ? key : `lead:${key}`;
}

function parseWeeklyDay(raw) {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(6, n));
}

function parseWeeklyTime(raw) {
  const s = String(raw || '09:00').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return '09:00';
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function resolveWorkspaceCallerNumber(ws) {
  if (!ws || typeof ws !== 'object') return '';
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const fromLegacy = Array.isArray(telephony.numberBank)
    ? telephony.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  const bank = [...new Set([...fromEntries, ...fromLegacy])];
  const active = signalwire.normalizePhone(telephony.activeFromNumber || '');
  if (active && bank.includes(active)) return active;
  return bank[0] || '';
}

function workspaceCallerNumbers(ws) {
  if (!ws || typeof ws !== 'object') return [];
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entries = Array.isArray(telephony.numberBankEntries) ? telephony.numberBankEntries : [];
  const fromEntries = entries.map((e) => signalwire.normalizePhone(e && e.number)).filter(Boolean);
  const fromLegacy = Array.isArray(telephony.numberBank)
    ? telephony.numberBank.map((n) => signalwire.normalizePhone(n)).filter(Boolean)
    : [];
  return [...new Set([...fromEntries, ...fromLegacy])];
}

function resolveRequestedCallerNumber(ws, requested) {
  const bank = workspaceCallerNumbers(ws);
  const picked = signalwire.normalizePhone(requested || '');
  if (picked && bank.includes(picked)) return picked;
  return resolveWorkspaceCallerNumber(ws);
}

function resolveWorkspaceCallMode(ws) {
  const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const mode = String(telephony.callMode || '').trim().toLowerCase();
  if (mode === 'browser_device') return 'browser_device';
  if (mode === 'agent_first') return 'agent_first';
  return 'cloud_dial';
}

function resolveAgentFirstNumber(ws) {
  if (!ws || typeof ws !== 'object') return '';
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  return signalwire.normalizePhone(telephony.agentPhone || '');
}

async function buildContactedStagePatch(lead, workspaceId) {
  if (!lead || !workspaceId) return {};
  const status = String(lead.status || '').toLowerCase();
  if (status.includes('closed - won') || status.includes('closed - lost')) return {};
  const currentStageNum = parseInt(lead.pipelineStage, 10) || 1;
  if (currentStageNum > 1) return {};

  const stages = await pipelineStagesService.ensureWorkspaceStagesSeeded(workspaceId);
  if (!Array.isArray(stages) || !stages.length) return {};
  const sortedStages = [...stages].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const contacted =
    sortedStages.find((s) => String(s.key || '').toLowerCase() === 'contacted') ||
    sortedStages[Math.min(1, sortedStages.length - 1)];
  if (!contacted || !contacted.id) return {};
  return pipelineStagesService.patchLeadStageFields(lead, sortedStages, contacted.id);
}

/** Log outbound call on a lead (softphone dial with leadKey, or shared call flows). */
async function logLeadOutboundCallInitiated(req, fullKey, lead, opts = {}) {
  if (!fullKey || !lead) return lead;
  const updates = appendLeadUpdate(lead, {
    type: opts.updateType || 'call_outbound',
    value:
      opts.updateValue ||
      `Outbound call initiated (${opts.normalizedTo || lead.phone || 'unknown number'}).`,
    callSid: opts.callSid || '',
    provider: opts.provider || 'signalwire',
    to: opts.normalizedTo,
  });
  const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
  return dbService.updateLead(fullKey, {
    ...contactedPatch,
    status: opts.status || 'Called Lead',
    updates,
    logs: [
      {
        type: opts.logType || 'call_outbound',
        message: opts.logMessage || `Call initiated (${opts.callSid || 'no sid'})`,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

function normalizeVoicemailLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const audioUrl = String(item.audioUrl || item.url || '').trim();
      if (!audioUrl) return null;
      return {
        id: String(item.id || '').trim() || `vm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        audioUrl,
        fileName: String(item.fileName || item.name || '').trim(),
        mimeType: String(item.mimeType || '').trim(),
        uploadedAt: String(item.uploadedAt || item.createdAt || new Date().toISOString()),
      };
    })
    .filter(Boolean)
    .slice(-30);
}

function resolveActiveVoicemailAudioUrl(telephony) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const library = normalizeVoicemailLibrary(tp.voicemailLibrary);
  const activeId = String(tp.activeVoicemailId || '').trim();
  const activeFromLibrary = activeId ? library.find((x) => x.id === activeId) : null;
  const latestFromLibrary = library.length ? library[library.length - 1] : null;
  const legacy = String(tp.voicemailAudioUrl || '').trim();
  if (activeFromLibrary && activeFromLibrary.audioUrl) {
    return { audioUrl: activeFromLibrary.audioUrl, activeId: activeFromLibrary.id, library };
  }
  if (latestFromLibrary && latestFromLibrary.audioUrl) {
    return { audioUrl: latestFromLibrary.audioUrl, activeId: latestFromLibrary.id, library };
  }
  return { audioUrl: legacy, activeId: '', library };
}

// POST /leads/:key/sequence/start — attach persona cadence (Clay / Paul / Bob templates)
router.post('/:key/sequence/start', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const templateId = (req.body && req.body.templateId) || 'audit_local_14';
    await sequenceEngine.startSequence(fullKey, templateId);
    await activationService.recordEvent(userEmail(req), 'sequence_started');
    res.json({ success: true, templateId });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sequence/pause
router.post('/:key/sequence/pause', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    await sequenceEngine.pauseSequence(fullKey);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/** Pause cadence and set a future re-engagement marker (quarterly follow-up). */
router.post('/:key/cadence/snooze', express.json(), async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const days = Math.min(540, Math.max(7, parseInt((req.body && req.body.days) || 90, 10)));
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await sequenceEngine.pauseSequence(fullKey);
    await dbService.updateLead(
      fullKey,
      {
        cadenceSnooze: {
          until,
          days,
          note: String((req.body && req.body.note) || '').trim(),
          setAt: new Date().toISOString(),
        },
        logs: [
          {
            type: 'cadence_snooze',
            message: `Cadence snoozed ~${days}d — re-engage after ${until.slice(0, 10)} (re-run audit before outreach).`,
            timestamp: new Date().toISOString(),
          },
        ],
      },
      req.workspaceId,
    );
    const refreshed = await dbService.getLead(fullKey);
    return res.json({ success: true, until, days, lead: refreshed });
  } catch (err) {
    next(err);
  }
});

router.post('/:key/disposition', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const code = String((req.body && req.body.code) || '').trim().toLowerCase();
    const notes = String((req.body && req.body.notes) || '').trim();
    if (!code) return res.status(400).json({ success: false, error: 'Disposition code is required.' });

    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const now = new Date();
    const patch = {};
    let status = lead.status || 'Not Contacted';
    let nextStep = '';
    let automation = '';
    if (code === 'connected') {
      status = 'Connected - Follow Up';
      nextStep = 'Send a concise recap with next step.';
    } else if (code === 'no_answer') {
      status = 'No Answer';
      const next = new Date(now.getTime() + 18 * 60 * 60 * 1000);
      patch.nextActionAt = next.toISOString();
      const numbers = workspaceCallerNumbers(ws);
      const active = resolveWorkspaceCallerNumber(ws);
      const alternate = numbers.find((n) => n && n !== active) || '';
      if (alternate) {
        patch.nextCallerId = alternate;
        automation = `Retry queued in 18h using alternate caller ID ${alternate}.`;
      } else {
        automation = 'Retry queued in 18h.';
      }
      nextStep = 'Retry in the next window.';
    } else if (code === 'voicemail') {
      status = 'Voicemail Left';
      const auto = await autoAttachCadenceIfNeeded({ leadKey: fullKey, workspaceId: req.workspaceId });
      automation = auto && auto.attached ? `Follow-up cadence queued (${auto.templateId}).` : 'Follow-up cadence already active.';
      nextStep = 'Run immediate day-0 follow-up email task.';
    } else if (code === 'callback') {
      status = 'Callback Requested';
      const when = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const taskId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await dbService.saveUserTask(req.workspaceId, userEmail(req), {
        id: taskId,
        title: `Callback requested — ${lead.title || 'Lead'}`,
        column: 'todo',
        sort: Date.now(),
        createdAt: new Date().toISOString(),
        scheduledAt: when.toISOString(),
        leadKey: fullKey,
      });
      patch.nextActionAt = when.toISOString();
      patch.redialBlockedUntil = when.toISOString();
      patch.callbackTaskId = taskId;
      automation = 'Callback task created and redial paused until follow-up window.';
      nextStep = 'Confirm callback window and prepare notes.';
    } else if (code === 'gatekeeper') {
      status = 'Gatekeeper';
      patch.scriptVariant = 'gatekeeper_bypass';
      automation = 'Switched to gatekeeper bypass script variant.';
      nextStep = 'Use gatekeeper bypass opener on next touch.';
    } else if (code === 'wrong_number') {
      status = 'Bad Number';
      patch.needsReenrichment = true;
      automation = 'Lead flagged for re-enrichment and alternate contact lookup.';
      nextStep = 'Run contact enrichment before next dial.';
    }
    patch.status = status;
    patch.lastDisposition = code;
    patch.lastDispositionAt = new Date().toISOString();
    const updates = appendLeadUpdate(lead, {
      type: 'call_disposition',
      value: `Disposition: ${code}${notes ? ` — ${notes}` : ''}`,
      code,
      notes,
      automation,
    });
    patch.updates = updates;
    patch.logs = [
      {
        type: 'call_disposition',
        message: `Disposition set to ${code}${automation ? ` · ${automation}` : ''}`,
        timestamp: new Date().toISOString(),
      },
    ];
    if (code === 'connected' || code === 'callback') {
      try {
        await sequenceEngine.pauseSequence(fullKey);
      } catch (_) {
        /* ignore */
      }
    }
    const updated = await dbService.updateLead(fullKey, patch, req.workspaceId);
    return res.json({ success: true, lead: updated, status, nextStep, automation });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/assign — owner/admin only
router.post('/:key/assign', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Team admin required' });
    }
    const fullKey = leadKeyFromParam(req.params.key);
    const assignee =
      (req.body && (req.body.assigneeEmail || req.body.email || '').trim().toLowerCase()) || '';
    if (!assignee) return res.status(400).json({ success: false, error: 'assigneeEmail required' });
    await dbService.updateLead(fullKey, {
      assignedTo: assignee,
      logs: [
        {
          type: 'assignment',
          message: `Assigned to ${assignee}`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, assignedTo: assignee });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/assign-round-robin — owner/admin only
router.post('/:key/assign-round-robin', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Team admin required' });
    }
    const fullKey = leadKeyFromParam(req.params.key);
    const assignee = await workspaceService.pickRoundRobinAssignee(req.workspaceId);
    if (!assignee) return res.status(400).json({ success: false, error: 'No assignees in pool' });
    await dbService.updateLead(fullKey, {
      assignedTo: assignee,
      logs: [
        {
          type: 'assignment',
          message: `Round-robin assigned to ${assignee}`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, assignedTo: assignee });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/update — update lead metadata (status, etc.)
router.post('/:key/update', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = leadKeyFromParam(key);
    const updateData = { ...req.body };
    const existing = await dbService.getLead(fullKey);
    const wid = req.workspaceId;

    const stages = await pipelineStagesService.listStages(wid);
    if (updateData.stageId != null && String(updateData.stageId).trim() !== '') {
      const sid = String(updateData.stageId).trim();
      if (stages.some((s) => s.id === sid)) {
        Object.assign(updateData, pipelineStagesService.patchLeadStageFields(existing, stages, sid));
      }
      delete updateData.stageId;
    } else if (updateData.pipelineStage !== undefined && updateData.pipelineStage !== null) {
      const next = parseInt(updateData.pipelineStage, 10);
      if (!Number.isNaN(next) && next >= 1 && next <= stages.length) {
        const sid = stages[next - 1].id;
        Object.assign(updateData, pipelineStagesService.patchLeadStageFields(existing, stages, sid));
      }
    }

    if (
      existing &&
      updateData.pipelineStage !== undefined &&
      updateData.pipelineStage !== null
    ) {
      const prev = parseInt(existing.pipelineStage, 10) || 1;
      const next = parseInt(updateData.pipelineStage, 10);
      if (!Number.isNaN(next) && next >= 2 && next !== prev) {
        await activationService.recordEvent(userEmail(req), 'pipeline_advanced');
      }
    }

    // Add to activity log if status changed
    if (updateData.status && existing) {
      const lead = existing;
      const updates = lead.updates || [];
      updates.push({
        type: 'status_change',
        value: updateData.status,
        timestamp: new Date().toISOString()
      });
      updateData.updates = updates;
    }

    const newStatus = updateData.status && existing ? String(updateData.status) : '';
    const pauseCadenceOnEngagement =
      newStatus &&
      /(meeting|booked|proposal|signed|discovery done|closed\s*-\s*won|callback requested|connected\s*-\s*follow)/i.test(
        newStatus,
      );
    if (pauseCadenceOnEngagement && existing) {
      try {
        await sequenceEngine.pauseSequence(fullKey);
      } catch (_) {
        /* ignore */
      }
    }

    const updated = await dbService.updateLead(fullKey, updateData, wid);
    res.json({ success: true, lead: updated });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/notes — add a note to a lead
router.post('/:key/notes', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const { content } = req.body;
    
    const lead = await dbService.getLead(fullKey);
    const updates = lead.updates || [];
    updates.push({
      type: 'note',
      value: content,
      timestamp: new Date().toISOString()
    });

    await dbService.updateLead(fullKey, { updates });
    res.json({ success: true, updates });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/call — click-to-call outbound voice dial
router.post('/:key/call', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const callMode = resolveWorkspaceCallMode(ws);
    if (callMode !== 'browser_device' && !signalwire.configured()) {
      return res.status(400).json({
        success: false,
        error:
          'Telephony is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER, and BASE_URL.',
      });
    }
    const normalizedTo = signalwire.normalizePhone(lead.phone);
    if (!normalizedTo) {
      return res.status(400).json({
        success: false,
        error: 'Lead has no valid phone number for outbound calling.',
      });
    }
    if (callMode === 'browser_device') {
      const updates = appendLeadUpdate(lead, {
        type: 'call_browser_handoff',
        value: `Opened device dialer for ${normalizedTo}.`,
        to: normalizedTo,
        provider: 'device',
      });
      const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
      const updatedLead = await dbService.updateLead(fullKey, {
        ...contactedPatch,
        status: 'Call Started (Device)',
        updates,
        logs: [
          {
            type: 'call_browser_handoff',
            message: `Device dialer initiated (${normalizedTo})`,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      return res.json({
        success: true,
        dialMode: 'browser_device',
        phone: normalizedTo,
        lead: updatedLead,
      });
    }
    if (callMode === 'agent_first') {
      const agentTo = resolveAgentFirstNumber(ws);
      if (!agentTo) {
        return res.status(400).json({
          success: false,
          error:
            'Set your mobile number in Workspace → Phone number bank (Agent / your phone) for agent-first calling.',
        });
      }
    }
    const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
    const fromPick = dialerPacing.selectCallerIdForDial({
      workspace: ws,
      telephony,
      lead,
      requestedFrom: req.body && req.body.fromNumber,
      now: new Date(),
    });
    if (!fromPick.allowed) {
      return res.status(429).json({ success: false, error: fromPick.reason || 'Dial pacing blocked this call.' });
    }
    const call = await signalwire.createLeadCall({
      to: normalizedTo,
      leadKey: fullKey,
      workspaceId: req.workspaceId,
      action: 'call',
      from: fromPick.from,
      agentFirst: callMode === 'agent_first',
      agentTo: callMode === 'agent_first' ? resolveAgentFirstNumber(ws) : undefined,
    });
    dialerPacing.recordDialAttempt(telephony, {
      from: fromPick.from,
      to: normalizedTo,
      action: 'call',
      leadKey: fullKey,
      callSid: call.sid || '',
    });
    await dbService.saveWorkspace(req.workspaceId, ws);
    const updates = appendLeadUpdate(lead, {
      type: 'call_outbound',
      value: `Outbound call initiated (${lead.phone || 'unknown number'}).`,
      callSid: call.sid || '',
      provider: 'signalwire',
    });
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const updatedLead = await dbService.updateLead(fullKey, {
      ...contactedPatch,
      status: 'Called Lead',
      updates,
      logs: [
        {
          type: 'call_outbound',
          message: `SignalWire call initiated (${call.sid || 'no sid'})`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, callSid: call.sid || null, callerId: fromPick.from, lead: updatedLead });
  } catch (err) {
    next(err);
  }
});

// GET /leads/telephony/call-options — caller ID options for call widget
router.get('/telephony/call-options', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const numbers = workspaceCallerNumbers(ws);
    const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
    const pacingCfg = dialerPacing.getPacingConfig(ws, telephony);
    const callMode = resolveWorkspaceCallMode(ws);
    const cfg = signalwire.envConfig();
    const defaultFrom =
      signalwire.normalizePhone(resolveRequestedCallerNumber(ws, null)) ||
      signalwire.normalizePhone(cfg.callerId || cfg.fromNumber) ||
      '';
    return res.json({
      success: true,
      options: numbers,
      activeFromNumber: resolveWorkspaceCallerNumber(ws),
      callMode,
      agentPhone: resolveAgentFirstNumber(ws) || null,
      relayWebrtcAvailable:
        callMode !== 'browser_device' && callMode !== 'agent_first' && signalwire.relayWebrtcCanMint(),
      defaultFromNumber: defaultFrom,
      pacing: {
        perNumberHourCap: pacingCfg.perNumberHourCap,
        quietHoursStart: pacingCfg.quietStart,
        quietHoursEnd: pacingCfg.quietEnd,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/telephony/webrtc-token — Relay (Verto) JWT for browser WebRTC softphone
router.get('/telephony/webrtc-token', async (req, res, next) => {
  try {
    if (!signalwire.relayWebrtcCanMint || !signalwire.relayWebrtcCanMint()) {
      return res.status(400).json({
        success: false,
        error:
          'WebRTC softphone is not available. Set SIGNALWIRE_SPACE_URL, enable SIGNALWIRE_WEBRTC_ENABLED, and use Cloud dial (not “My device dialer”) in workspace settings.',
      });
    }
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    if (resolveWorkspaceCallMode(ws) === 'browser_device') {
      return res.status(400).json({
        success: false,
        error: 'WebRTC is disabled when Call routing mode is set to your device dialer.',
      });
    }
    const cfg = signalwire.envConfig();
    const fromQuery = String((req.query && req.query.fromNumber) || '').trim();
    const fromNumber =
      signalwire.normalizePhone(resolveRequestedCallerNumber(ws, fromQuery)) ||
      signalwire.normalizePhone(cfg.callerId || cfg.fromNumber) ||
      '';
    if (!fromNumber) {
      return res.status(400).json({
        success: false,
        error: 'Configure a workspace outbound number (or SIGNALWIRE_FROM_NUMBER) before using the browser softphone.',
      });
    }
    const resource = String(
      (req.query && req.query.resource) || `adhello-softphone-ws-${String(req.workspaceId).slice(0, 36)}`,
    )
      .trim()
      .slice(0, 200);
    let expires = parseInt(String((req.query && req.query.expires_in) || '30'), 10);
    if (!Number.isFinite(expires) || expires < 5) expires = 30;
    if (expires > 120) expires = 120;
    const { token, refresh } = await signalwire.createRelayBrowserJwt({
      resource,
      expires_in: expires,
    });
    return res.json({
      success: true,
      projectId: cfg.projectId,
      host: signalwire.relaySpaceHost(),
      token,
      refreshToken: refresh || undefined,
      fromNumber,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/dial — global softphone dial (no lead context required)
router.post('/telephony/dial', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const callMode = resolveWorkspaceCallMode(ws);
    const forceCloudVoicemail = ['1', 'true', 'yes', 'on'].includes(
      String(req.body && req.body.forceCloudVoicemail).trim().toLowerCase(),
    );
    const to = signalwire.normalizePhone(req.body && req.body.to);
    if (!to) {
      return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
    }

    const action = String((req.body && req.body.action) || 'call').trim().toLowerCase() === 'voicemail_drop'
      ? 'voicemail_drop'
      : 'call';

    const rawLeadKey = String((req.body && req.body.leadKey) || '').trim();
    let fullLeadKey = '';
    let leadForDial = null;
    if (rawLeadKey) {
      const stripped = rawLeadKey.replace(/^lead:/, '');
      fullLeadKey = leadKeyFromParam(stripped);
      leadForDial = await dbService.getLead(fullLeadKey);
      if (!leadForDial) fullLeadKey = '';
    }

    if (callMode === 'browser_device' && !(action === 'voicemail_drop' && forceCloudVoicemail)) {
      let updatedLead = leadForDial;
      if (fullLeadKey && leadForDial && action === 'call') {
        const updates = appendLeadUpdate(leadForDial, {
          type: 'call_browser_handoff',
          value: `Opened device dialer for ${to}.`,
          to,
          provider: 'device',
        });
        const contactedPatch = await buildContactedStagePatch(leadForDial, req.workspaceId);
        updatedLead = await dbService.updateLead(fullLeadKey, {
          ...contactedPatch,
          status: 'Call Started (Device)',
          updates,
          logs: [
            {
              type: 'call_browser_handoff',
              message: `Device dialer initiated (${to})`,
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }
      return res.json({
        success: true,
        dialMode: 'browser_device',
        phone: to,
        action,
        lead: updatedLead || undefined,
      });
    }

    if (callMode === 'agent_first' && action === 'voicemail_drop' && !forceCloudVoicemail) {
      return res.status(400).json({
        success: false,
        error:
          'Agent-first mode only supports normal calls. For voicemail drop in softphone, use the "Drop VM + Next" flow, or switch Workspace call mode to Cloud dial.',
      });
    }

    if (callMode === 'agent_first') {
      const agentTo = resolveAgentFirstNumber(ws);
      if (!agentTo) {
        return res.status(400).json({
          success: false,
          error:
            'Set your mobile number in Workspace → Phone number bank (Agent / your phone) for agent-first calling.',
        });
      }
    }

    if (!signalwire.configured()) {
      return res.status(400).json({
        success: false,
        error:
          'Telephony is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER, and BASE_URL.',
      });
    }

    const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
    const { audioUrl: voicemailAudioUrl } = resolveActiveVoicemailAudioUrl(telephony);
    const useAgent = callMode === 'agent_first' && !(action === 'voicemail_drop' && forceCloudVoicemail);
    const fromPick = dialerPacing.selectCallerIdForDial({
      workspace: ws,
      telephony,
      lead: leadForDial,
      requestedFrom: req.body && req.body.fromNumber,
      now: new Date(),
    });
    if (!fromPick.allowed) {
      return res.status(429).json({ success: false, error: fromPick.reason || 'Dial pacing blocked this call.' });
    }
    const call = await signalwire.createLeadCall({
      to,
      leadKey: fullLeadKey,
      workspaceId: req.workspaceId,
      action,
      voicemailAudioUrl: action === 'voicemail_drop' ? voicemailAudioUrl : '',
      from: fromPick.from,
      agentFirst: useAgent,
      agentTo: useAgent ? resolveAgentFirstNumber(ws) : undefined,
    });
    dialerPacing.recordDialAttempt(telephony, {
      from: fromPick.from,
      to,
      action,
      leadKey: fullLeadKey,
      callSid: call.sid || '',
    });
    await dbService.saveWorkspace(req.workspaceId, ws);
    let updatedLead = leadForDial;
    if (fullLeadKey && leadForDial && action === 'call') {
      updatedLead = await logLeadOutboundCallInitiated(req, fullLeadKey, leadForDial, {
        callSid: call.sid || '',
        normalizedTo: to,
        logMessage: `SignalWire call initiated (${call.sid || 'no sid'})`,
      });
    }
    return res.json({
      success: true,
      dialMode: useAgent ? 'agent_first' : 'cloud_dial',
      callSid: call.sid || null,
      action,
      callerId: fromPick.from,
      lead: updatedLead && action === 'call' ? updatedLead : undefined,
    });
  } catch (err) {
    console.error('[POST /leads/telephony/dial]', err && err.message ? err.message : err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: (err && err.message) || 'Telephony dial failed.',
      });
    }
    next(err);
  }
});

// POST /leads/telephony/ai-summary — AI wrap-up for completed calls
router.post('/telephony/ai-summary', async (req, res, next) => {
  try {
    const disposition = String((req.body && req.body.disposition) || '').trim();
    const notes = String((req.body && req.body.notes) || '').trim();
    const number = String((req.body && req.body.number) || '').trim();
    if (!disposition) {
      return res.status(400).json({ success: false, error: 'Disposition is required.' });
    }
    if (!notes) {
      return res.status(400).json({ success: false, error: 'Add brief notes before generating summary.' });
    }

    let summary = '';
    let nextStep = '';
    let followupSms = '';

    try {
      const prompt = [
        'You are a sales call assistant.',
        'Return STRICT JSON with keys: summary, nextStep, followupSms.',
        'summary: 1-2 short sentences.',
        'nextStep: one concrete action.',
        'followupSms: under 240 chars, plain text, optional but provide if useful.',
        `Disposition: ${disposition}`,
        `Called number: ${number || 'unknown'}`,
        `Rep notes:\n${notes}`,
      ].join('\n');
      const resp = await chatCompletion({
        provider: 'openai',
        model: process.env.OUTREACH_COACH_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 350,
      });
      const text = String((resp && resp.content) || '').trim();
      try {
        const parsed = JSON.parse(text);
        summary = String(parsed.summary || '').trim();
        nextStep = String(parsed.nextStep || '').trim();
        followupSms = String(parsed.followupSms || '').trim();
      } catch (_) {
        summary = text.slice(0, 320);
      }
    } catch (_) {
      /* graceful fallback */
    }

    if (!summary) summary = `Call disposition: ${disposition}. Notes captured for follow-up.`;
    if (!nextStep) {
      nextStep =
        disposition.toLowerCase().includes('callback')
          ? 'Schedule callback and send brief confirmation SMS.'
          : disposition.toLowerCase().includes('no')
            ? 'Retry in the next best contact window and send value-focused SMS.'
            : 'Log CRM notes and send a concise follow-up message.';
    }
    if (!followupSms) {
      followupSms = `Hi, thanks for your time today. Quick follow-up from our call: ${summary.slice(0, 140)} Reply here if you want to continue.`;
    }

    return res.json({ success: true, summary, nextStep, followupSms });
  } catch (err) {
    next(err);
  }
});

// GET /leads/telephony/call-status?callSid=... — poll live call status
router.get('/telephony/call-status', async (req, res, next) => {
  try {
    const callSid = String((req.query && req.query.callSid) || '').trim();
    if (!callSid) {
      return res.status(400).json({ success: false, error: 'callSid is required.' });
    }
    if (!signalwire.configured()) {
      return res.status(400).json({ success: false, error: 'Telephony is not configured.' });
    }
    const call = await signalwire.getCall(callSid);
    return res.json({
      success: true,
      callSid,
      status: String(call.status || call.call_status || '').trim().toLowerCase(),
      duration: call.duration != null ? String(call.duration) : '',
      from: String(call.from || ''),
      to: String(call.to || ''),
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/call-control — real call controls supported by provider
router.post('/telephony/call-control', async (req, res, next) => {
  try {
    const action = String((req.body && req.body.action) || '').trim().toLowerCase();
    const callSid = String((req.body && req.body.callSid) || '').trim();
    const recordingSidBody = String((req.body && req.body.recordingSid) || '').trim();
    if (!signalwire.configured()) {
      return res.status(400).json({ success: false, error: 'Telephony is not configured.' });
    }
    if (action === 'record_stop') {
      if (!recordingSidBody) {
        return res.status(400).json({ success: false, error: 'recordingSid is required.' });
      }
      await signalwire.stopCallRecording(recordingSidBody);
      return res.json({ success: true, action: 'record_stop', recordingSid: recordingSidBody });
    }
    if (!callSid) {
      return res.status(400).json({ success: false, error: 'callSid is required.' });
    }
    if (action === 'hangup') {
      await signalwire.completeCall(callSid);
      return res.json({ success: true, action: 'hangup', callSid });
    }
    if (action === 'record_start') {
      const cb = signalwire.buildAppUrl('/api/telephony/voice/recording-status', {});
      const raw = await signalwire.startCallRecording(callSid, {
        recordingStatusCallback: cb || undefined,
      });
      const recordingSid = signalwire.extractRecordingSid(raw);
      if (!recordingSid) {
        return res.status(502).json({
          success: false,
          error: 'Telephony provider did not return a recording id.',
        });
      }
      return res.json({ success: true, action: 'record_start', callSid, recordingSid });
    }
    return res.status(400).json({
      success: false,
      error: 'Unsupported action. Use hangup, record_start, or record_stop.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/voicemail-drop — automated voicemail playback call
router.post('/:key/voicemail-drop', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!signalwire.configured()) {
      return res.status(400).json({
        success: false,
        error:
          'Telephony is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER, and BASE_URL.',
      });
    }
    const normalizedTo = signalwire.normalizePhone(lead.phone);
    if (!normalizedTo) {
      return res.status(400).json({
        success: false,
        error: 'Lead has no valid phone number for voicemail drop.',
      });
    }
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    if (resolveWorkspaceCallMode(ws) === 'agent_first') {
      return res.status(400).json({
        success: false,
        error:
          'Voicemail drop needs Cloud dial. In Workspace → Phone number bank, set call routing to Cloud dial for automated voicemail, or use agent first only for live softphone calls.',
      });
    }
    const telephony = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
    const { audioUrl: voicemailAudioUrl } = resolveActiveVoicemailAudioUrl(telephony);
    const fromPick = dialerPacing.selectCallerIdForDial({
      workspace: ws,
      telephony,
      lead,
      requestedFrom: req.body && req.body.fromNumber,
      now: new Date(),
    });
    if (!fromPick.allowed) {
      return res.status(429).json({ success: false, error: fromPick.reason || 'Dial pacing blocked this call.' });
    }
    const call = await signalwire.createLeadCall({
      to: normalizedTo,
      leadKey: fullKey,
      workspaceId: req.workspaceId,
      action: 'voicemail_drop',
      voicemailAudioUrl,
      from: fromPick.from,
    });
    dialerPacing.recordDialAttempt(telephony, {
      from: fromPick.from,
      to: normalizedTo,
      action: 'voicemail_drop',
      leadKey: fullKey,
      callSid: call.sid || '',
    });
    await dbService.saveWorkspace(req.workspaceId, ws);
    const updates = appendLeadUpdate(lead, {
      type: 'voicemail_drop',
      value: 'Voicemail drop attempt started.',
      callSid: call.sid || '',
      provider: 'signalwire',
    });
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const updatedLead = await dbService.updateLead(fullKey, {
      ...contactedPatch,
      updates,
      logs: [
        {
          type: 'voicemail_drop',
          message: `SignalWire voicemail-drop initiated (${call.sid || 'no sid'})`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, callSid: call.sid || null, callerId: fromPick.from, lead: updatedLead });
  } catch (err) {
    next(err);
  }
});

// GET /leads/:key/panel-data — full lead JSON for detail sidebar (Cadences page, etc.)
router.get('/:key/panel-data', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return res.json({ success: true, lead });
  } catch (err) {
    next(err);
  }
});

// GET /leads/:key/call-events — recent call/voicemail events for call widget
router.get('/:key/call-events', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const updates = Array.isArray(lead.updates) ? lead.updates : [];
    const callEvents = updates
      .filter((u) =>
        u &&
        [
          'call_outbound',
          'call_browser_handoff',
          'call_status',
          'voicemail_drop',
          'voicemail_status',
          'voicemail_amd',
        ].includes(
          String(u.type || '')
        )
      )
      .slice(-30)
      .reverse();
    return res.json({ success: true, events: callEvents });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sms — send outbound SMS
router.post('/:key/sms', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Message body is required.' });
    if (!signalwire.configured()) {
      return res.status(400).json({
        success: false,
        error:
          'Telephony is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_FROM_NUMBER, and BASE_URL.',
      });
    }
    const sms = await signalwire.sendSms({
      to: lead.phone,
      body,
      leadKey: fullKey,
      workspaceId: req.workspaceId,
      from: resolveWorkspaceCallerNumber(await dbService.getWorkspace(req.workspaceId)),
    });
    const updates = appendLeadUpdate(lead, {
      type: 'sms_outbound',
      value: body,
      messageSid: sms.sid || '',
      provider: 'signalwire',
    });
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const updatedLead = await dbService.updateLead(fullKey, {
      ...contactedPatch,
      status: 'Follow-up',
      updates,
      logs: [
        {
          type: 'sms_outbound',
          message: `SignalWire SMS queued (${sms.sid || 'no sid'})`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    res.json({ success: true, messageSid: sms.sid || null, lead: updatedLead });
  } catch (err) {
    next(err);
  }
});

function buildWorkspaceOutreachScriptsPayload(ws) {
  const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
  const services = SCRIPT_LIBRARY_KEYS.map((k) => ({
    key: k,
    label: (mergedLibrary[k] && mergedLibrary[k].label) || k,
  }));
  const library = buildOutreachLibrary(mergedLibrary, SCRIPT_LIBRARY_KEYS);
  return {
    success: true,
    channels: OUTREACH_CHANNELS,
    services,
    library,
    defaultServiceKey: SCRIPT_LIBRARY_KEYS[0] || '',
  };
}

// GET /leads/outreach-library — workspace script library (no lead key required)
router.get('/outreach-library', async (req, res, next) => {
  try {
    const ws = await dbService.getWorkspace(req.workspaceId);
    return res.json(buildWorkspaceOutreachScriptsPayload(ws));
  } catch (err) {
    next(err);
  }
});

// GET /leads/:key/outreach-scripts — per-service scripts for call / text / voicemail / email
router.get('/:key/outreach-scripts', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const ws = await dbService.getWorkspace(req.workspaceId);
    const payload = buildWorkspaceOutreachScriptsPayload(ws);
    const leadServiceKey =
      (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) || lead.primaryServiceKey || '';
    payload.defaultServiceKey = SCRIPT_LIBRARY_KEYS.includes(leadServiceKey)
      ? leadServiceKey
      : payload.defaultServiceKey;

    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /leads/:key/sms-script-options — script choices for SMS modal
router.get('/:key/sms-script-options', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const savedItems = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);

    const leadServiceKey =
      (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) || lead.primaryServiceKey || '';
    const serviceKey = SCRIPT_LIBRARY_KEYS.includes(leadServiceKey)
      ? leadServiceKey
      : SCRIPT_LIBRARY_KEYS[0];
    const serviceDef = mergedLibrary[serviceKey] || SCRIPT_LIBRARY[serviceKey] || {};
    const serviceLabel = serviceDef.label || 'Primary offer';

    const sectionLabels = {
      opening: 'Opening',
      discovery: 'Discovery',
      valueProp: 'Value proposition',
      objectionHandling: 'Objection handling',
      close: 'Close',
    };

    const options = [];
    ['opening', 'valueProp', 'objectionHandling', 'close'].forEach((section) => {
      const text = String(serviceDef[section] || '').trim();
      if (!text) return;
      options.push({
        id: `${serviceKey}:${section}`,
        label: `${serviceLabel} — ${sectionLabels[section]}`,
        text,
      });
    });

    savedItems
      .filter((item) => item && String(item.text || '').trim())
      .slice(-12)
      .forEach((item) => {
        const itemService = String(item.serviceKey || '').trim();
        const itemSection = String(item.section || '').trim();
        const itemServiceLabel =
          itemService && mergedLibrary[itemService] && mergedLibrary[itemService].label
            ? mergedLibrary[itemService].label
            : itemService
              ? itemService
              : 'General';
        const suffix = itemSection ? ` · ${sectionLabels[itemSection] || itemSection}` : '';
        const title = String(item.title || '').trim();
        options.push({
          id: `saved:${item.id}`,
          label: title
            ? `Saved: ${title}`
            : `Saved script — ${itemServiceLabel}${suffix}`,
          text: String(item.text).trim(),
        });
      });

    return res.json({
      success: true,
      serviceKey,
      serviceLabel,
      options,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sms-personalize — AI personalize selected script for lead
router.post('/:key/sms-personalize', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const scriptText = String((req.body && req.body.scriptText) || '').trim();
    if (!scriptText) {
      return res.status(400).json({ success: false, error: 'scriptText is required.' });
    }

    const company = String(lead.title || 'your business').trim() || 'your business';
    const contact =
      String(lead.contactName || '').trim() ||
      (lead.email && lead.email !== 'N/A' ? String(lead.email).split('@')[0].replace(/[._]+/g, ' ') : '') ||
      'there';
    const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
    const insight = lead.kieServiceInsight && typeof lead.kieServiceInsight === 'object'
      ? lead.kieServiceInsight
      : {};
    const snapshot = {
      company,
      contact,
      cityState,
      category: lead.categoryName || '',
      rating: lead.totalScore || 0,
      reviewCount: lead.reviewsCount || 0,
      website: lead.website || '',
      primaryServiceLabel: insight.primaryServiceLabel || '',
      rationale: insight.rationale || '',
      talkTrack: insight.talkTrack || '',
      auditSummary: lead.auditSummary || '',
      buyingSignals: Array.isArray(lead.buyingSignals) ? lead.buyingSignals : [],
    };

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You personalize outbound SMS for local-business sales.

Rules:
- Return JSON only: {"message":"..."}
- Keep message concise: target 280 chars, hard max 480 chars.
- Keep tone human, respectful, and non-spammy.
- Use specific lead context when relevant (city/category/reviews/offer fit).
- Include one clear CTA.
- Do not use markdown, bullet points, or emojis unless already present.
- Preserve placeholders if they exist: [your name], [your company].`,
        },
        {
          role: 'user',
          content: `Lead context:\n${JSON.stringify(snapshot)}\n\nBase script:\n${scriptText}`,
        },
      ],
      jsonObject: true,
      max_tokens: 300,
      temperature: 0.45,
    });

    if (!ai.content || ai.error) {
      const fallback = scriptText
        .replace(/\{\{name\}\}/gi, contact)
        .replace(/\{\{company\}\}/gi, company)
        .replace(/\{\{city\}\}/gi, cityState || 'your area');
      return res.json({
        success: true,
        personalized: fallback,
        provider: 'fallback',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.status(500).json({ success: false, error: 'Invalid AI response' });
    }
    const personalized = String((parsed && parsed.message) || '').trim();
    if (!personalized) {
      return res.status(500).json({ success: false, error: 'AI did not return a message.' });
    }
    return res.json({
      success: true,
      personalized: personalized.slice(0, 480),
      provider: ai.provider || 'unknown',
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/telephony/voicemail/settings — current workspace voicemail automation settings
router.get('/telephony/voicemail/settings', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId, members: {} };
    const telephony = ws.telephony || {};
    const resolvedVoicemail = resolveActiveVoicemailAudioUrl(telephony);
    const weekly = telephony.weeklyVoicemail || {};
    const voicemailScript = String(
      telephony.voicemailScript ||
        'Hi, this is [your name] from [your company]. We help local businesses capture more ready-to-buy demand and turn missed opportunities into booked calls. I will send a short follow-up text with one idea tailored for your business. If that is useful, please call me back at [your number]. Thank you.',
    ).trim();
    res.json({
      success: true,
      settings: {
        audioUrl: String(resolvedVoicemail.audioUrl || ''),
        activeVoicemailId: String(resolvedVoicemail.activeId || ''),
        voicemailLibrary: resolvedVoicemail.library,
        enabled: !!weekly.enabled,
        dayOfWeek: parseWeeklyDay(weekly.dayOfWeek),
        time: parseWeeklyTime(weekly.time),
        timezone: String(weekly.timezone || ws.timezone || 'America/Los_Angeles'),
        maxLeadsPerRun: Math.max(1, parseInt(weekly.maxLeadsPerRun || '25', 10) || 25),
        voicemailScript,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/voicemail/active — choose active voicemail from saved library
router.post('/telephony/voicemail/active', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can select active voicemail audio.' });
    }
    const wid = req.workspaceId;
    const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
    const voicemailLibrary = normalizeVoicemailLibrary(telephony.voicemailLibrary);
    const activeVoicemailId = String((req.body && req.body.activeVoicemailId) || '').trim();
    const selected = voicemailLibrary.find((v) => v.id === activeVoicemailId);
    if (!selected) return res.status(404).json({ success: false, error: 'Selected voicemail recording was not found.' });
    telephony.voicemailLibrary = voicemailLibrary;
    telephony.activeVoicemailId = selected.id;
    telephony.voicemailAudioUrl = selected.audioUrl;
    telephony.voicemailUploadedAt = selected.uploadedAt || new Date().toISOString();
    ws.telephony = telephony;
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, activeVoicemailId: selected.id, audioUrl: selected.audioUrl });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/voicemail/delete — remove a saved voicemail recording
router.post('/telephony/voicemail/delete', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can delete voicemail audio.' });
    }
    const wid = req.workspaceId;
    const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
    const voicemailLibrary = normalizeVoicemailLibrary(telephony.voicemailLibrary);
    const voicemailId = String((req.body && req.body.voicemailId) || '').trim();
    if (!voicemailId) return res.status(400).json({ success: false, error: 'voicemailId is required.' });

    const existing = voicemailLibrary.find((v) => v.id === voicemailId);
    if (!existing) return res.status(404).json({ success: false, error: 'Recording not found.' });

    const nextLibrary = voicemailLibrary.filter((v) => v.id !== voicemailId);
    telephony.voicemailLibrary = nextLibrary;

    const wasActive = String(telephony.activeVoicemailId || '').trim() === voicemailId;
    if (wasActive) {
      const replacement = nextLibrary.length ? nextLibrary[nextLibrary.length - 1] : null;
      telephony.activeVoicemailId = replacement ? replacement.id : '';
      telephony.voicemailAudioUrl = replacement ? replacement.audioUrl : '';
      telephony.voicemailUploadedAt = replacement ? replacement.uploadedAt || new Date().toISOString() : '';
    } else if (!nextLibrary.length) {
      telephony.activeVoicemailId = '';
      telephony.voicemailAudioUrl = '';
      telephony.voicemailUploadedAt = '';
    }

    ws.telephony = telephony;
    await dbService.saveWorkspace(wid, ws);
    const resolved = resolveActiveVoicemailAudioUrl(telephony);
    return res.json({
      success: true,
      voicemailLibrary: resolved.library,
      activeVoicemailId: resolved.activeId,
      audioUrl: resolved.audioUrl || '',
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/voicemail/settings — update weekly voicemail automation settings
router.post('/telephony/voicemail/settings', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can update telephony settings.' });
    }
    const wid = req.workspaceId;
    const ws = (await dbService.getWorkspace(wid)) || { id: wid, members: {} };
    const body = req.body || {};
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
    const weekly =
      telephony.weeklyVoicemail && typeof telephony.weeklyVoicemail === 'object'
        ? { ...telephony.weeklyVoicemail }
        : {};
    weekly.enabled = !!body.enabled;
    weekly.dayOfWeek = parseWeeklyDay(body.dayOfWeek);
    weekly.time = parseWeeklyTime(body.time);
    weekly.timezone = String(body.timezone || ws.timezone || 'America/Los_Angeles')
      .trim()
      .slice(0, 64);
    weekly.maxLeadsPerRun = Math.max(1, Math.min(200, parseInt(body.maxLeadsPerRun || '25', 10) || 25));
    const voicemailScript = String(body.voicemailScript || '')
      .trim()
      .slice(0, 4000);
    telephony.weeklyVoicemail = weekly;
    if (voicemailScript) {
      telephony.voicemailScript = voicemailScript;
    } else if (body.voicemailScript !== undefined) {
      telephony.voicemailScript = '';
    }
    ws.telephony = telephony;
    await dbService.saveWorkspace(wid, ws);
    res.json({ success: true, settings: weekly });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/voicemail/upload — upload recorded/uploaded voicemail audio for workspace
router.post('/telephony/voicemail/upload', (req, res, next) => {
  voiceUpload.single('audio')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can upload voicemail audio.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Audio file is required.' });
    }
    const wid = String(req.workspaceId || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const extFromName = path.extname(String(req.file.originalname || '')).toLowerCase();
    const ext = extFromName && extFromName.length <= 8 ? extFromName : '.webm';
    const relDir = path.join('public', 'uploads', 'voicemail');
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });
    const stamp = Date.now();
    const filename = `${wid}_weekly_${stamp}${ext}`;
    const absPath = path.join(absDir, filename);
    await fs.writeFile(absPath, req.file.buffer);
    const publicUrl = `/uploads/voicemail/${filename}`;

    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId, members: {} };
    const telephony = ws.telephony && typeof ws.telephony === 'object' ? { ...ws.telephony } : {};
    const library = normalizeVoicemailLibrary(telephony.voicemailLibrary);
    const entry = {
      id: `vm_${stamp}_${Math.random().toString(36).slice(2, 8)}`,
      audioUrl: publicUrl,
      fileName: String(req.file.originalname || filename),
      mimeType: String(req.file.mimetype || ''),
      uploadedAt: new Date().toISOString(),
    };
    const nextLibrary = [...library, entry].slice(-30);
    telephony.voicemailLibrary = nextLibrary;
    telephony.activeVoicemailId = entry.id;
    telephony.voicemailAudioUrl = entry.audioUrl;
    telephony.voicemailUploadedAt = entry.uploadedAt;
    ws.telephony = telephony;
    await dbService.saveWorkspace(req.workspaceId, ws);

    res.json({
      success: true,
      audioUrl: publicUrl,
      activeVoicemailId: entry.id,
      voicemailLibrary: nextLibrary,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/delete — remove a saved lead
router.post('/:key/delete', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    await dbService.deleteLead(fullKey);

    // If request is from fetch (JSON), return JSON; otherwise redirect
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect('/prospecting?tab=pipeline');
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/generate-prompt — personalized outreach (KIE.ai preferred, then OpenAI, else template)
router.post('/:key/generate-prompt', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);

    const scored = scoreLeadRecord(lead);
    const summary = {
      title: lead.title,
      city: lead.city,
      state: lead.state,
      category: lead.categoryName,
      rating: lead.totalScore,
      reviews: lead.reviewsCount,
      website: lead.website,
      source: lead.source,
      pipelineStage: lead.pipelineStage,
      cmsPlatform: lead.cmsPlatform,
      gapTier: scored.tier,
      gapReasons: scored.reasons,
      localProspect: scored.localProspect,
    };

    let prompt = '';
    let llm = 'template';

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You write credible B2B agency / SaaS outreach emails. Do not invent metrics or claims not in context. Plain text only (no subject line). Under 170 words. Sign off as [Your Name].',
        },
        {
          role: 'user',
          content: `Write a first-touch email that references 1–2 concrete signals from the JSON (gaps, category, location, warm vs cold source). Offer a low-friction next step (15-minute call).\n\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
      jsonObject: false,
      max_tokens: 520,
      temperature: 0.55,
    });

    if (ai.content && !ai.error) {
      prompt = ai.content.trim();
      llm = ai.provider || 'template';
    } else {
      prompt = `Hi ${lead.title},\n\nI noticed your business in ${lead.city} has a ${lead.totalScore} rating with ${lead.reviewsCount} reviews. We help ${lead.categoryName} operators like you turn visibility into booked calls.\n\nOpen to a 15-minute fit call next week?\n\nBest,\n[Your Name]`;
    }

    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    await dbService.updateLead(fullKey, {
      ...contactedPatch,
      outreachPrompt: prompt,
    });
    res.json({ success: true, prompt, llm });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/insights — KIE/OpenAI: best service to sell + rationale (cached 7d)
router.post('/:key/insights', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const refresh = !!(req.body && req.body.refresh);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (
      !refresh &&
      lead.kieServiceInsight &&
      typeof lead.kieServiceInsight === 'object' &&
      lead.kieServiceInsightAt
    ) {
      const age = Date.now() - new Date(lead.kieServiceInsightAt).getTime();
      const hasWarRoomOpener =
        typeof lead.kieServiceInsight.warRoomOpener === 'string' &&
        lead.kieServiceInsight.warRoomOpener.trim().length > 0;
      if (age >= 0 && age < maxAgeMs && hasWarRoomOpener) {
        return res.json({ success: true, cached: true, ...lead.kieServiceInsight });
      }
    }

    const offeringCatalog = Object.entries(SCRIPT_LIBRARY)
      .map(([id, s]) => `- ${id}: ${s.label} — ${s.valueProp}`)
      .join('\n');
    const serviceKeyList = SCRIPT_LIBRARY_KEYS.join(', ');

    const snapshot = {
      company: lead.title,
      category: lead.categoryName,
      city: lead.city,
      state: lead.state,
      address: lead.address,
      website: lead.website,
      email: lead.email,
      phone: lead.phone,
      mapsRating: lead.totalScore,
      reviewCount: lead.reviewsCount,
      pipelineStage: lead.pipelineStage,
      source: lead.source,
      gaps: {
        hasWebsite: !!(lead.website && lead.website !== 'N/A'),
        hasSchemaMarkup: lead.hasSchemaMarkup,
        hasChatbot: lead.hasChatbot,
        hasClickToCall: lead.hasClickToCall,
        isMobileFriendly: lead.isMobileFriendly,
        isOutdated: lead.isOutdated,
        aeoScore: lead.aeoScore,
        cmsPlatform: lead.cmsPlatform,
      },
      auditSummary: lead.auditSummary,
    };

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You are a senior agency seller for a local SMB digital agency. Pick exactly ONE primary offering from the catalog that is the most logical first sale for this lead, based on their category, location, ratings/reviews, website presence, and technical gaps.

Catalog (primaryServiceKey must be exactly one of: ${serviceKeyList}):
${offeringCatalog}

Respond with JSON only, no markdown:
{"primaryServiceKey":"<one of the keys above>","primaryServiceLabel":"string","rationale":"2-4 sentences: why this offer fits now","talkTrack":"One conversational sentence to open a call or email","warRoomOpener":"Plain text only: 4-8 short sentences for a respectful cold-call opener. Use placeholders [your name] and optionally [your company]. Only mention technical or conversion gaps that are actually true in the snapshot gaps object—say them in plain English (e.g. mobile experience, lead-capture chat, local/schema SEO for AI search, click-to-call, dated design). Tie those pains naturally to primaryServiceLabel as a logical first project. No bullets, markdown, or nested quotes."}`,
        },
        {
          role: 'user',
          content: JSON.stringify(snapshot),
        },
      ],
      jsonObject: true,
      max_tokens: 1000,
      temperature: 0.35,
    });

    if (!ai.content || ai.error) {
      return res.json({
        success: false,
        error:
          'No AI provider configured (set KIE_AI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) or request failed.',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.json({ success: false, error: 'Invalid AI response' });
    }

    const keyOk = SCRIPT_LIBRARY_KEYS.includes(parsed.primaryServiceKey);
    const insight = {
      primaryServiceKey: keyOk ? parsed.primaryServiceKey : 'aiWebsites',
      primaryServiceLabel: parsed.primaryServiceLabel || SCRIPT_LIBRARY.aiWebsites.label,
      rationale: parsed.rationale || '',
      talkTrack: parsed.talkTrack || '',
      warRoomOpener: typeof parsed.warRoomOpener === 'string' ? parsed.warRoomOpener.trim() : '',
      provider: ai.provider || 'unknown',
    };

    await dbService.updateLead(fullKey, {
      kieServiceInsight: insight,
      kieServiceInsightAt: new Date().toISOString(),
    });

    return res.json({ success: true, cached: false, ...insight });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/review-intelligence — strengths / weaknesses from review snippets + rating (cached 7d)
router.post('/:key/review-intelligence', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const refresh = !!(req.body && req.body.refresh);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (
      !refresh &&
      lead.reviewIntel &&
      typeof lead.reviewIntel === 'object' &&
      lead.reviewIntelAt
    ) {
      const age = Date.now() - new Date(lead.reviewIntelAt).getTime();
      if (age >= 0 && age < maxAgeMs) {
        const ri = lead.reviewIntel;
        return res.json({
          success: true,
          cached: true,
          strengths: Array.isArray(ri.strengths) ? ri.strengths : [],
          weaknesses: Array.isArray(ri.weaknesses) ? ri.weaknesses : [],
          sourceNote: typeof ri.sourceNote === 'string' ? ri.sourceNote : '',
        });
      }
    }

    const snippets = Array.isArray(lead.reviewSnippets) ? lead.reviewSnippets : [];
    const snapshot = {
      company: lead.title,
      category: lead.categoryName,
      city: lead.city,
      state: lead.state,
      mapsRating: lead.totalScore,
      reviewCount: lead.reviewsCount,
      auditSummary: lead.auditSummary || '',
      reviewSnippets: snippets,
    };

    const ai = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `You analyze local business reputation for agency sales. Input is JSON with optional verbatim customer quotes in reviewSnippets, star rating mapsRating (0-5), reviewCount, category, location, and auditSummary.

Rules:
- If reviewSnippets has one or more strings: derive strengths and weaknesses only from themes in those quotes plus rating/count. Do not invent incidents not supported by the quotes.
- If reviewSnippets is empty: infer plausible strengths and weaknesses from category, location, mapsRating, reviewCount, and auditSummary only. Use cautious wording ("Often…", "May…", "Typical risk…"). Do not claim you read specific reviews.

Return JSON only, no markdown:
{"strengths":["bullet 1",...],"weaknesses":["bullet 1",...],"sourceNote":"One sentence: cite verbatim snippets vs rating-only inference."}`,
        },
        {
          role: 'user',
          content: JSON.stringify(snapshot),
        },
      ],
      jsonObject: true,
      max_tokens: 800,
      temperature: 0.35,
    });

    if (!ai.content || ai.error) {
      return res.json({
        success: false,
        error:
          'No AI provider configured (set KIE_AI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) or request failed.',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      return res.json({ success: false, error: 'Invalid AI response' });
    }

    const intel = {
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map((s) => String(s || '').trim()).filter(Boolean) : [],
      weaknesses: Array.isArray(parsed.weaknesses)
        ? parsed.weaknesses.map((s) => String(s || '').trim()).filter(Boolean)
        : [],
      sourceNote: typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '',
    };

    await dbService.updateLead(fullKey, {
      reviewIntel: intel,
      reviewIntelAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      cached: false,
      strengths: intel.strengths,
      weaknesses: intel.weaknesses,
      sourceNote: intel.sourceNote,
    });
  } catch (err) {
    next(err);
  }
});

async function runLeadEnhancement(lead, workspaceId) {
  if (!lead || !lead.key) return { success: false, error: 'Lead not found.' };
  const fullKey = lead.key.startsWith('lead:') ? lead.key : `lead:${lead.key}`;

  let deepData = null;
  let firecrawlViaSearch = false;
  let mapsFallbackUsed = false;
  let betterContactUsed = false;
  let urlToSave = null;

  const leadWorkspaceId = (lead && lead.workspaceId) || workspaceId;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);
  const leadProfile = { title: lead.title, city: lead.city, state: lead.state };

  const bcPromise =
    betterContact.isConfigured(integrationEnv) ?
      betterContact
        .enrichLeadForBusiness(lead, integrationEnv)
        .catch((e) => {
          console.warn('[ENHANCE] BetterContact failed:', e.message);
          return null;
        })
    : Promise.resolve(null);

  if (lead.website && lead.website !== 'N/A') {
    console.log(`[ENHANCE] Triggering enrich for ${lead.title} (${lead.website})...`);
    const pack = await webEnrichment.enrichLeadSmartWithMapsFallback(lead.website, leadProfile, {
      integrationEnv,
    });
    deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(pack.merged, deepData || {});
    mapsFallbackUsed = pack.mapsUsed;
  } else {
    console.log(`[ENHANCE] Website missing. Firecrawl search + Maps fallback for ${lead.title}...`);
    firecrawlViaSearch = true;
    const searchQuery = `${lead.title} business in ${lead.city}${lead.state ? ', ' + lead.state : ''} official website contact`;
    let searchExtract = {};
    let firecrawlFoundUrl = null;
    try {
      const searchResults = await firecrawl.searchBusiness(searchQuery, integrationEnv);

      if (searchResults && searchResults.length > 0) {
        const bestResult =
          searchResults.find(
            (r) =>
              r.extract &&
              (r.extract.email ||
                r.extract.phone ||
                r.extract.address ||
                r.extract.total_score != null ||
                r.extract.reviews_count != null ||
                r.extract.facebook ||
                r.extract.instagram)
          ) || searchResults[0];
        searchExtract = bestResult.extract || {};
        firecrawlFoundUrl = searchResults.find((r) => r.url)?.url || null;
      }
    } catch (e) {
      console.warn('[ENHANCE] Firecrawl search failed:', e.message);
    }

    let websiteHint = null;
    const missingCoreContact = mapsEnrichFallback.extractMissingCoreContact(searchExtract);
    if (
      !mapsEnrichFallback.extractHasContactSignal(searchExtract) ||
      missingCoreContact ||
      !firecrawlFoundUrl
    ) {
      const pack = await mapsEnrichFallback.enrichFromMapsForLead(lead, integrationEnv);
      if (pack) {
        searchExtract = mapsEnrichFallback.mergeExtractPreferFirecrawl(searchExtract, pack.extract);
        websiteHint = pack.websiteHint;
        mapsFallbackUsed = true;
      }
    }
    deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(searchExtract, deepData || {});
    if (!lead.website || lead.website === 'N/A') {
      urlToSave = websiteHint || firecrawlFoundUrl || null;
    }
  }

  let bcExtract = null;
  const bcPack = await bcPromise;
  if (bcPack && bcPack.extract && betterContact.extractHasSignal(bcPack.extract)) {
    bcExtract = bcPack.extract;
    betterContactUsed = true;
    deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(deepData || {}, bcExtract);
  }

  const baseUpdates = [...(lead.updates || [])];
  const patch = {};
  const priorUpdateLen = baseUpdates.length;

  const hadExtract = deepData && Object.keys(deepData).length > 0;
  if (hadExtract) {
    const enrichUpdates = firecrawlExtractToLeadUpdates(deepData);
    Object.assign(patch, enrichUpdates);

    if ((!lead.email || lead.email === 'N/A') && deepData.email) patch.email = deepData.email;
    if ((!lead.facebook || lead.facebook === 'N/A') && deepData.facebook) patch.facebook = deepData.facebook;
    if ((!lead.instagram || lead.instagram === 'N/A') && deepData.instagram) patch.instagram = deepData.instagram;
    if ((!lead.twitter || lead.twitter === 'N/A') && deepData.twitter) patch.twitter = deepData.twitter;
    if (!lead.linkedin && deepData.linkedin) patch.linkedin = deepData.linkedin;
    if (!lead.decisionMakerName && deepData.decision_maker_name) {
      patch.decisionMakerName = deepData.decision_maker_name;
    }
    if (!lead.decisionMakerTitle && deepData.decision_maker_title) {
      patch.decisionMakerTitle = deepData.decision_maker_title;
    }

    if (lead.phone && lead.phone !== 'N/A') delete patch.phone;
    if (lead.address && lead.address !== 'N/A') delete patch.address;
    if (lead.email && lead.email !== 'N/A') delete patch.email;
    if (lead.totalScore != null && Number(lead.totalScore) > 0) delete patch.totalScore;
    if (lead.reviewsCount != null && Number(lead.reviewsCount) > 0) delete patch.reviewsCount;
  }

  if ((!lead.website || lead.website === 'N/A') && urlToSave) {
    patch.website = urlToSave;
  }

  if (hadExtract || urlToSave || mapsFallbackUsed || betterContactUsed) {
    const via = [
      betterContactUsed ? 'BetterContact' : null,
      firecrawlViaSearch ? 'web search' : null,
      !firecrawlViaSearch && lead.website && lead.website !== 'N/A' && hadExtract ? 'website' : null,
      mapsFallbackUsed ? 'Maps backup' : null,
    ]
      .filter(Boolean)
      .join(' + ');
    baseUpdates.push({
      type: 'enrichment',
      value: `Deep hunt completed${via ? ` (${via})` : ''}.`,
      timestamp: new Date().toISOString(),
    });
  }

  const hasNewUpdates = baseUpdates.length > priorUpdateLen;
  const patchKeys = Object.keys(patch).filter((k) => k !== 'updates');
  if (patchKeys.length > 0 || hasNewUpdates) {
    patch.updates = baseUpdates;
    const updatedLead = await dbService.updateLead(fullKey, patch, leadWorkspaceId);
    return { success: true, lead: updatedLead };
  }

  if (!betterContact.isConfigured(integrationEnv)) {
    return {
      success: false,
      error:
        'No new contact data discovered yet. Add BETTERCONTACT_API_KEY under Workspace → API integrations to enable BetterContact waterfall enrichment.',
    };
  }

  return { success: false, error: 'No new contact data discovered yet. BetterContact and website search did not find new contacts.' };
}

// POST /leads/enhance-missing-contacts — admin backfill for leads missing phone/email
router.post('/enhance-missing-contacts', async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Team admin required' });
    }
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const needsBackfill = visible.filter((lead) => mapsEnrichFallback.extractMissingCoreContact(lead));
    const maxLeads = Math.min(200, Math.max(1, parseInt((req.body && req.body.limit) || '80', 10) || 80));
    const queue = needsBackfill.slice(0, maxLeads);

    let updated = 0;
    let attempted = 0;
    let lastError = '';
    for (const lead of queue) {
      attempted += 1;
      try {
        const result = await runLeadEnhancement(lead, req.workspaceId);
        if (result && result.success) updated += 1;
        else if (result && result.error) lastError = String(result.error);
      } catch (err) {
        lastError = err && err.message ? String(err.message) : 'Enhancement failed for one lead.';
      }
    }

    return res.json({
      success: true,
      attempted,
      updated,
      totalMissing: needsBackfill.length,
      remaining: Math.max(0, needsBackfill.length - attempted),
      lastError,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/enhance — Firecrawl scrape/search + Maps (Outscraper/Apify) fallback
router.post('/:key/enhance', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    const result = await runLeadEnhancement(lead, req.workspaceId);
    if (result && result.success) {
      const refreshed = await dbService.getLead(fullKey);
      const contactedPatch = await buildContactedStagePatch(refreshed || lead, req.workspaceId);
      if (Object.keys(contactedPatch).length) {
        await dbService.updateLead(fullKey, contactedPatch);
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Manual enhancement error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:key/ai-analysis', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const prevAnalysis = lead.aiWebsiteAnalysis || null;
    let analysis = await websiteAiAnalysis.analyzeWebsite(lead.website || lead.url || '');
    analysis = websiteAiAnalysis.mergePriorAuditSnapshot(analysis, prevAnalysis);
    const ownerSignal = websiteAiAnalysis.buildOwnerSignal(lead, analysis);
    const patch = {
      aiWebsiteAnalysis: analysis,
      aiWebsiteAnalysisScore: Number(analysis.analysisScore || 0),
      ownerSignal,
      aiWebsiteAnalysisUpdatedAt: new Date().toISOString(),
    };
    const updated = await dbService.updateLead(fullKey, patch, req.workspaceId);
    res.json({ success: true, lead: updated, analysis, ownerSignal });
  } catch (err) {
    res.status(500).json({ success: false, error: err && err.message ? err.message : 'Analysis failed' });
  }
});

/** POST /leads/:key/pagespeed-audit — on-demand Lighthouse via Google PageSpeed Insights API */
router.post('/:key/pagespeed-audit', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const apiKey =
      integrationEnv.PAGESPEED_API_KEY ||
      process.env.PAGESPEED_API_KEY ||
      process.env.GOOGLE_PAGESPEED_API_KEY ||
      '';

    const strategy =
      req.body && String(req.body.strategy || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile';

    const { audit } = await pageSpeedInsights.runPageSpeedAudit(lead.website || lead.url || '', {
      apiKey,
      strategy,
    });

    const ownerSignal = pageSpeedInsights.buildOwnerSignalFromAudit(lead.title, audit);
    const updated = await dbService.updateLead(
      fullKey,
      {
        pageSpeedAudit: audit,
        pageSpeedAuditAt: audit.fetchedAt,
        ownerSignal,
        logs: [
          {
            type: 'pagespeed_audit',
            message: `Lighthouse (PageSpeed, ${strategy}): average ${audit.averageScore ?? '—'}/100`,
            timestamp: audit.fetchedAt,
          },
        ],
      },
      req.workspaceId
    );

    return res.json({ success: true, lead: updated, audit, ownerSignal });
  } catch (err) {
    const code = err && err.code;
    if (code === 'PAGESPEED_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, error: err.message });
    }
    if (code === 'NO_WEBSITE') {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : 'PageSpeed audit failed',
    });
  }
});

/** Signed public URL for hosted audit + PDF (text on cold calls, email PDF next day). */
router.post('/:key/audit-report-link', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!lead.aiWebsiteAnalysis || typeof lead.aiWebsiteAnalysis !== 'object') {
      return res.status(400).json({ success: false, error: 'Run AI analysis first to generate a hosted report.' });
    }
    const token = createAuditReportToken({ leadKey: fullKey, workspaceId: req.workspaceId });
    const base = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
    const reportUrl = `${base}/audit/report/${token}`;
    const pdfUrl = `${base}/audit/report/${encodeURIComponent(token)}/download.pdf`;
    const company = String(lead.title || 'your team').trim() || 'your team';
    const followUpSubject = 'Your audit, attached — plus the 3 fixes we discussed.';
    const followUpBody = `Hi ${company},\n\nGreat speaking with you. Attached is the one-page website audit PDF from our call.\n\nThe three fixes we walked through are still the fastest wins — happy to implement or QA anything your dev pushes live.\n\nIf you want the deeper pass (competitor benchmark, Core Web Vitals, and a 30-day plan), grab a slot here: ${String(
      process.env.ADHELLO_BOOK_URL || 'https://adhello.ai/book',
    ).trim()}\n\nBest,\n`;
    const smsSnippet = `I'll send you a quick link to your website audit now while we're on the phone — you can open it on your phone: ${reportUrl}`;
    return res.json({
      success: true,
      reportUrl,
      pdfUrl,
      followUpEmail: { subject: followUpSubject, body: followUpBody },
      smsSnippet,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Link failed' });
  }
});

router.post('/ai-analysis/export-csv', express.json(), async (req, res) => {
  try {
    const keys = Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [];
    if (!keys.length) return res.status(400).json({ success: false, error: 'No lead keys provided.' });
    const rows = [];
    const headers = [
      'Company','Category','Phone','Website','Email','Address','Rating','Reviews','Facebook','Instagram','Twitter',
      'Site health (0-100)','AI audit gap (0-10)','Signal','Primary emails (filtered)','Phones Found','Page Title','Meta Description','Has HTTPS',
      'Page Load Seconds','Mobile Responsive','Copyright Year','Signals','Flag 404','Flag Slow (>5s)','Flag No SSL',
      'Audit rubric','Audited at','Prior site health (0-100)','Prior audited at',
      'Google Place ID','Latitude','Longitude',
      'Local prospect (Hot/Warm/Low/Skip)','Website status','Prospect confidence','Why prospect',
    ];
    for (const rawKey of keys) {
      const fullKey = String(rawKey || '').startsWith('lead:') ? String(rawKey) : `lead:${String(rawKey || '')}`;
      const lead = await dbService.getLead(fullKey);
      if (!lead || String(lead.workspaceId || '') !== String(req.workspaceId || '')) continue;
      let analysis = lead.aiWebsiteAnalysis || null;
      let ownerSignal = String(lead.ownerSignal || '').trim();
      if (!analysis) {
        analysis = await websiteAiAnalysis.analyzeWebsite(lead.website || lead.url || '');
        ownerSignal = websiteAiAnalysis.buildOwnerSignal(lead, analysis);
        await dbService.updateLead(fullKey, {
          aiWebsiteAnalysis: analysis,
          aiWebsiteAnalysisScore: Number(analysis.analysisScore || 0),
          ownerSignal,
          aiWebsiteAnalysisUpdatedAt: new Date().toISOString(),
        }, req.workspaceId);
      } else if (!ownerSignal) {
        ownerSignal = websiteAiAnalysis.buildOwnerSignal(lead, analysis);
        await dbService.updateLead(fullKey, { ownerSignal }, req.workspaceId);
      }
      if (!Array.isArray(analysis.topGapLabels) || !analysis.topGapLabels.length) {
        analysis.topGapLabels = websiteAiAnalysis.computeTopGapLabels(analysis, 5);
      }
      const rawAiScore = Number(analysis.analysisScore || 0);
      const aiGapForCsv =
        rawAiScore > 10
          ? Math.min(10, Math.max(0, Math.round((100 - rawAiScore) / 10)))
          : Math.min(10, Math.max(0, rawAiScore));
      let siteHealthCsv = Number(analysis.siteHealth100);
      if (!Number.isFinite(siteHealthCsv)) {
        siteHealthCsv =
          rawAiScore > 10 ? Math.min(100, Math.max(0, Math.round(rawAiScore))) : Math.min(100, Math.max(0, 100 - aiGapForCsv * 10));
      } else {
        siteHealthCsv = Math.min(100, Math.max(0, Math.round(siteHealthCsv)));
      }
      const primaryEmailCsv = websiteAiAnalysis.pickPrimaryEmail(analysis.emails || []);
      const priorSnap = analysis.priorAuditSnapshot || null;
      const leadForProspect = { ...lead, aiWebsiteAnalysis: analysis };
      const lp = scoreLeadRecord(leadForProspect).localProspect;
      rows.push([
        lead.title || '',
        lead.categoryName || '',
        lead.phone || '',
        lead.website || '',
        lead.email || '',
        lead.address || '',
        lead.totalScore || '',
        lead.reviewsCount || '',
        lead.facebook || '',
        lead.instagram || '',
        lead.twitter || '',
        siteHealthCsv,
        aiGapForCsv,
        ownerSignal || '',
        primaryEmailCsv,
        (analysis.phones || []).join(' | '),
        analysis.pageTitle || '',
        analysis.metaDescription || '',
        analysis.hasHttps ? 'yes' : 'no',
        analysis.pageLoadSeconds != null ? analysis.pageLoadSeconds : '',
        analysis.mobileResponsive ? 'yes' : 'no',
        analysis.copyrightYear || '',
        (analysis.signals || []).join(' | '),
        analysis.flags && analysis.flags.returned404 ? 'yes' : 'no',
        analysis.flags && analysis.flags.slowLoad ? 'yes' : 'no',
        analysis.flags && analysis.flags.noSsl ? 'yes' : 'no',
        analysis.rubricVersion || websiteAiAnalysis.AUDIT_RUBRIC_VERSION || '',
        analysis.auditedAt || lead.aiWebsiteAnalysisUpdatedAt || '',
        priorSnap && priorSnap.siteHealth100 != null ? priorSnap.siteHealth100 : '',
        priorSnap && priorSnap.auditedAt ? priorSnap.auditedAt : '',
        lead.placeId || '',
        lead.latitude || '',
        lead.longitude || '',
        lp.prospectTier || '',
        lp.websiteStatusLabel || '',
        lp.confidence || '',
        lp.why || '',
      ]);
    }
    const escapeCsv = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
    const filename = `AdHello_Leads_Enriched_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'CSV export failed' });
  }
});

module.exports = router;
