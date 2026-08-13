const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const router = express.Router();
const dbService = require('../services/database');
const { folderKeyForJobType, leadMetadataForJobType } = require('../services/pipelineFolders');
const { normalizeJobType } = require('../services/scrapeJobTypes');
const firecrawl = require('../services/firecrawl');
const webEnrichment = require('../services/webEnrichment');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');
const { sanitizeExtractSocials } = require('../services/socialUrlNormalize');
const {
  normalizeLeadCategoryName,
  sanitizeLeadCategoryName,
} = require('../services/leadCategory');
const mapsEnrichFallback = require('../services/mapsEnrichFallback');
const reviewHunt = require('../services/reviewHunt');
const outscraperGmbEnrich = require('../services/outscraperGmbEnrich');
const outscraperLeadEnrich = require('../services/outscraperLeadEnrich');
const leadPanelEnrich = require('../services/leadPanelEnrich');
const rapidapiWebsiteEnrich = require('../services/rapidapiWebsiteEnrich');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const builtWithEnrich = require('../services/builtWithEnrich');
const outscraper = require('../services/outscraperClient');
const { generateReviewIntelForLead } = require('../services/reviewIntel');
const {
  normalizeLeadForPanel,
  coalesceReviewSnippets,
  leadMissingCoreContact,
  hasContactValue,
} = require('../services/leadPanelNormalize');
const betterContact = require('../services/betterContactClient');
const monidLeadEnrich = require('../services/monidLeadEnrich');
const tikHub = require('../services/tikHubClient');
const websiteAiAnalysis = require('../services/websiteAiAnalysis');
const pageSpeedInsights = require('../services/pageSpeedInsights');
const { createAuditReportToken } = require('../services/auditReportSign');
const {
  generateAssessment,
  mergeAssessment,
  normalizeAssessment,
} = require('../services/aiToolsAssessment');
const { buildAiToolsReportViewModel } = require('../services/aiToolsReportModel');
const { parseImportFile } = require('../services/csvLeadImport');
const { findExistingLead, upsertLeadInMemoryList } = require('../services/leadDedupe');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const { CHANNELS: OUTREACH_CHANNELS, buildOutreachLibrary } = require('../services/outreachChannelScripts');
const pipelineStagesService = require('../services/pipelineStagesService');
const { scoreLeadRecord } = require('../services/opportunityScore');
const { chatCompletion, parseLlmJson } = require('../services/llmClient');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { upsertOpenTaskForLead } = require('../services/userTasks');
const { applyLeadDisposition, applyAutoNoAnswerAfterDial } = require('../services/leadDispositionApply');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
  leadMatchesSearchQuery,
  scoreLeadSearchMatch,
  buildLeadSearchContext,
} = require('../services/leadListFilters');
const activationService = require('../services/activationService');
const sequenceEngine = require('../services/sequenceEngine');
const { autoAttachCadenceIfNeeded } = require('../services/leadCadence');
const dialerPacing = require('../services/dialerPacing');
const workspaceService = require('../services/workspaceService');
const googleDriveAccess = require('../services/googleDriveAccess');
const { getGoogleDriveAccount } = googleDriveAccess;
const { downloadDriveFileAsCsvBuffer } = require('../services/googleDriveCsv');
const { uploadCsvToDrive, safeDriveFileName } = require('../services/googleDriveUpload');
const { getMapPreviewImage } = require('../services/mapPreview');
const { getWebsitePreviewImage } = require('../services/websitePreview');
const signalwire = require('../services/signalwire');
const { shortLeadKey } = require('../services/focusQueue');
const ghlClient = require('../services/ghlClient');
const ghlMessaging = require('../services/ghlMessaging');
const websiteEnrichQueue = require('../services/websiteEnrichQueue');
const { resolveLeadsBySelectedKeys, parseBulkSelectionKeys } = require('../services/bulkSelectionKeys');
const smsOutbound = require('../services/smsOutbound');
const smsPersonalize = require('../services/smsPersonalize');
const {
  resolveInfoPackForLead,
  materializeInfoPackForLead,
  sendInfoPackToLead,
  buildAuditReportUrl,
  packNeedsAuditUrl,
  mergePackOverrides,
  parseInfoPackFromBody,
  resolveAuditUrlForInfoPack,
} = require('../services/infoPack');
const { triggerGhlProspectSync } = require('../services/ghlProspectSync');
const { maybeRerunAutoOutreachAfterEmailFix } = require('../services/prospectingEnroll');
const agentSessionStore = require('../services/agentSessionStore');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const contactHuntJobs = require('../services/contactHuntJobs');
const { mergeLeadsByKeys } = require('../services/leadMerge');
const { quickLogItemForStatus, quickLogLabelForDisposition } = require('../services/quickLogConfig');
const {
  findDeletableLeadNote,
  isDeletableLeadNote,
  removeLeadNoteFromLead,
} = require('../services/leadNotes');

const GHL_CONTACT_SYNC_FIELDS = [
  'email',
  'phone',
  'title',
  'website',
  'address',
  'city',
  'state',
  'zip',
  'tags',
];

function leadContactFieldsChanged(body, existing) {
  if (!body || typeof body !== 'object' || !existing) return false;
  return GHL_CONTACT_SYNC_FIELDS.some((field) => {
    if (body[field] === undefined) return false;
    const prev = existing[field];
    const next = body[field];
    if (Array.isArray(prev) || Array.isArray(next)) {
      return JSON.stringify(prev || []) !== JSON.stringify(next || []);
    }
    return String(prev || '').trim() !== String(next || '').trim();
  });
}

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
  const workspaceLeads = await dbService.getAllLeads(wid);

  for (const rec of records) {
    if (!rec.title) {
      skipped += 1;
      continue;
    }
    const payload = { ...rec, workspaceId: wid };
    const existing = findExistingLead(workspaceLeads, payload, wid);
    try {
      const result = await dbService.saveLeadWithMeta(payload);
      try {
        await autoAttachCadenceIfNeeded({ leadKey: result.key, workspaceId: wid });
      } catch (_) {
        /* non-fatal */
      }
      if (result.lead) upsertLeadInMemoryList(workspaceLeads, result.lead);
      if (existing || result.merged) updated += 1;
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

  const realEstateCount = records.filter((r) => r.jobType === 'real_estate').length;
  const realEstateImport =
    realEstateCount > 0 && realEstateCount >= Math.max(1, Math.floor(records.length * 0.5));

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
    realEstateImport,
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

// GET /leads/map-preview — server-side static map image for lead panel sidebar
router.get('/map-preview', async (req, res, next) => {
  try {
    const center = String(req.query.center || req.query.q || '').trim();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const width = parseInt(req.query.w, 10) || 640;
    const height = parseInt(req.query.h, 10) || 300;
    if (!center && !(Number.isFinite(lat) && Number.isFinite(lng))) {
      return res.status(400).json({ error: 'center or lat/lng required' });
    }
    const preview = await getMapPreviewImage({
      center,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      width,
      height,
    });
    if (!preview) {
      return res.status(404).json({ error: 'map_preview_unavailable' });
    }
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Map-Preview-Source', preview.source);
    res.type(preview.contentType).send(preview.buffer);
  } catch (err) {
    next(err);
  }
});

// GET /leads/website-preview — screenshot for hold-to-preview (avoids X-Frame-Options blocks)
router.get('/website-preview', async (req, res, next) => {
  try {
    const url = String(req.query.url || '').trim();
    const width = parseInt(req.query.w, 10) || 520;
    const height = parseInt(req.query.h, 10) || 340;
    if (!url) {
      return res.status(400).json({ error: 'url required' });
    }
    const preview = await getWebsitePreviewImage(url, { width, height });
    if (!preview) {
      return res.status(404).json({ error: 'website_preview_unavailable' });
    }
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Website-Preview-Source', preview.source);
    res.type(preview.contentType).send(preview.buffer);
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
    const q = String(filters.q || '').trim();
    if (q) {
      const [tags, folders] = await Promise.all([
        dbService.listTags(req.workspaceId),
        dbService.listFolders(req.workspaceId),
      ]);
      filters.searchContext = buildLeadSearchContext(tags, folders);
    }
    const out = applyLeadListFilters(visible, filters);

    res.json({
      success: true,
      leads: out.map(mapLeadListJson),
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/search.json — app-wide lead lookup (all folders)
router.get('/search.json', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(25, Math.max(1, parseInt(req.query.limit, 10) || 10));
    if (q.length < 2) {
      return res.json({ success: true, q, leads: [], total: 0 });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const [folders, tags] = await Promise.all([
      dbService.listFolders(req.workspaceId),
      dbService.listTags(req.workspaceId),
    ]);
    const searchContext = buildLeadSearchContext(tags, folders);
    const folderByKey = new Map(
      (folders || []).filter((f) => f && f.key).map((f) => [String(f.key), String(f.name || 'Folder')]),
    );

    const matched = visible.filter((l) => {
      try {
        return leadMatchesSearchQuery(l, q, searchContext);
      } catch (err) {
        console.warn('[search.json] skip lead', l && l.key, err && err.message);
        return false;
      }
    });
    matched.sort((a, b) => {
      let sa = 99;
      let sb = 99;
      try {
        sa = scoreLeadSearchMatch(a, q, searchContext);
      } catch (err) {
        console.warn('[search.json] score lead', a && a.key, err && err.message);
      }
      try {
        sb = scoreLeadSearchMatch(b, q, searchContext);
      } catch (err) {
        console.warn('[search.json] score lead', b && b.key, err && err.message);
      }
      if (sa !== sb) return sa - sb;
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    });

    const leads = matched.slice(0, limit).map((l) => {
      const folderKey = String(l.folderKey || '').trim();
      return {
        key: l.key,
        title: l.title || 'Lead',
        phone: l.phone || '',
        email: l.email || '',
        website: l.website || '',
        city: l.city || '',
        state: l.state || '',
        folderKey,
        folderName: folderKey ? folderByKey.get(folderKey) || '' : '',
        sourceChannel: l.sourceChannel || '',
      };
    });

    res.json({
      success: true,
      q,
      total: matched.length,
      leads,
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
      jobType,
      sourceType,
      tagKeys,
      listing,
      realEstate,
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
      categoryName: normalizeLeadCategoryName(
        categoryName,
        isManual ? 'Offline / word of mouth' : 'N/A',
      ),
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
    } else if (jobType) {
      Object.assign(leadData, leadMetadataForJobType(jobType, { listing, realEstate }));
    } else if (sourceType) {
      leadData.sourceType = String(sourceType).trim();
      if (source && String(source).trim()) leadData.source = String(source).trim();
    } else if (source && String(source).trim()) {
      leadData.source = String(source).trim();
    }

    let resolvedFolderKey = folderKey && String(folderKey).trim() ? String(folderKey).trim() : '';
    if (!resolvedFolderKey && jobType) {
      resolvedFolderKey = await folderKeyForJobType(req.workspaceId, normalizeJobType(jobType));
    }
    if (resolvedFolderKey) {
      leadData.folderKey = resolvedFolderKey;
    }

    const incomingTags = dbService.normalizeTagKeys(
      Array.isArray(tagKeys) ? tagKeys : tagKeys ? [tagKeys] : []
    );
    if (incomingTags.length) {
      leadData.tags = incomingTags;
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
    const connected = !!(row && row.refreshToken);
    let googleAccountEmail = (row && row.googleAccountEmail) || '';
    let googleAccountName = (row && row.googleAccountName) || '';
    if (connected && !googleAccountEmail) {
      const acct = await getGoogleDriveAccount(email);
      if (acct) {
        googleAccountEmail = acct.email;
        googleAccountName = acct.displayName;
      }
    }
    res.json({
      pickerReady: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_PICKER_API_KEY
      ),
      connected,
      googleAccountEmail,
      googleAccountName,
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
      realEstateImport: !!pack.realEstateImport,
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
    const { created, updated, skipped, failed, rows, rawRowCount, rejected, realEstateImport } = pack;
    const applied = pack.applied;
    let q = `rows=${rows}&rawRows=${rawRowCount}&rejected=${rejected}&created=${created}&updated=${updated}&imported=${applied}&skipped=${skipped}&failed=${failed}`;
    if (realEstateImport) {
      q += '&realEstate=1&origin=csv&includeFoldered=1&source=all';
    }
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        success: true,
        imported: applied,
        created,
        updated,
        skipped,
        failed,
        totalRows: rows,
        realEstateImport: !!realEstateImport,
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

async function leadInRequestWorkspace(lead, req) {
  return dbService.leadBelongsToWorkspace(lead, req && req.workspaceId);
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

function formatCallModeLabel(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'agent_first') return 'Agent first';
  if (m === 'browser_device') return 'My device dialer';
  return 'Cloud dial (browser mic)';
}

function humanizeDisposition(code) {
  const label = quickLogLabelForDisposition(code);
  if (label) return label;
  return String(code || '')
    .trim()
    .replace(/_/g, ' ');
}

function resolveAgentFirstNumber(ws) {
  if (!ws || typeof ws !== 'object') return '';
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  return signalwire.normalizePhone(telephony.agentPhone || '');
}

function resolveLeadCallerId(ws) {
  if (!ws || typeof ws !== 'object') return '';
  const telephony = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const bank = workspaceCallerNumbers(ws);
  const agent = resolveAgentFirstNumber(ws);
  const preferred = signalwire.normalizePhone(telephony.leadCallerId || '');
  if (preferred && (bank.includes(preferred) || (agent && preferred === agent))) {
    return preferred;
  }
  return resolveWorkspaceCallerNumber(ws);
}

function resolveRequestedLeadCallerId(ws, requested) {
  const bank = workspaceCallerNumbers(ws);
  const agent = resolveAgentFirstNumber(ws);
  const picked = signalwire.normalizePhone(requested || '');
  if (picked && (bank.includes(picked) || (agent && picked === agent))) return picked;
  return resolveLeadCallerId(ws);
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
  let updated = await dbService.updateLead(fullKey, {
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
  if (opts.skipAutoDisposition) return updated;
  try {
    updated = await applyAutoNoAnswerAfterDial({
      workspaceId: req.workspaceId,
      userEmail: userEmail(req),
      fullKey,
      lead: updated,
      deferGhlSync: true,
    });
  } catch (e) {
    console.warn('[dial] auto no-answer disposition failed:', e && e.message);
  }
  return updated;
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
router.post('/:key/sequence/start', express.json(), async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const templateId = (req.body && req.body.templateId) || 'audit_local_14';
    const result = await sequenceEngine.startSequence(fullKey, templateId);
    await activationService.recordEvent(userEmail(req), 'sequence_started');
    const refreshed = await dbService.getLead(fullKey);
    res.json({
      success: true,
      templateId,
      sequenceState: result && result.sequenceState,
      lead: refreshed,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sequence/pause
router.post('/:key/sequence/pause', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    await sequenceEngine.pauseSequence(fullKey);
    const refreshed = await dbService.getLead(fullKey);
    res.json({ success: true, lead: refreshed });
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
    const clientScheduledAt = req.body && req.body.scheduledAt ? String(req.body.scheduledAt).trim() : '';
    const skipFollowUp = !!(req.body && req.body.skipFollowUp);
    if (!code) return res.status(400).json({ success: false, error: 'Disposition code is required.' });

    const result = await applyLeadDisposition({
      workspaceId: req.workspaceId,
      userEmail: userEmail(req),
      fullKey,
      lead,
      code,
      notes,
      scheduledAt: clientScheduledAt,
      skipFollowUp,
      deferGhlSync: !!(req.body && req.body.deferGhlSync),
      source: 'api',
    });

    return res.json({
      success: true,
      lead: result.lead,
      status: result.status,
      nextStep: result.nextStep,
      automation: result.automation,
      followUpTask: result.followUpTask,
      scheduledAt: result.scheduledAt,
      skipFollowUp: result.skipFollowUp,
    });
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

    if (updateData.categoryName !== undefined && existing) {
      updateData.categoryName = sanitizeLeadCategoryName(
        updateData.categoryName,
        existing.title,
        normalizeLeadCategoryName(updateData.categoryName, 'N/A'),
      );
    }

    if (
      req.body &&
      (req.body.onPipelineBoard === true ||
        req.body.onPipelineBoard === 'true' ||
        req.body.onPipelineBoard === 1 ||
        req.body.onPipelineBoard === '1')
    ) {
      updateData.onPipelineBoard = true;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'bookmarked')) {
      updateData.bookmarked =
        req.body.bookmarked === true ||
        req.body.bookmarked === 'true' ||
        req.body.bookmarked === 1 ||
        req.body.bookmarked === '1';
    }

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
      const quickItem = quickLogItemForStatus(updateData.status);
      if (quickItem && quickItem.disposition) {
        updateData.lastDisposition = quickItem.disposition;
        updateData.lastDispositionAt = new Date().toISOString();
      }
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

    const emailChanging =
      existing &&
      updateData.email !== undefined &&
      String(existing.email || '').trim() !== String(updateData.email || '').trim();
    if (emailChanging && ghlClient.isValidEmailForGhl(updateData.email)) {
      updateData.emailValidationStatus = 'manual_fixed';
    }

    const previousEmailForRerun = existing ? existing.email : '';
    const updated = await dbService.updateLead(fullKey, updateData, wid);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    let autoOutreachRerun = null;
    if (emailChanging) {
      try {
        autoOutreachRerun = await maybeRerunAutoOutreachAfterEmailFix({
          leadKey: fullKey,
          workspaceId: wid,
          previousEmail: previousEmailForRerun,
          nextEmail: updateData.email,
        });
      } catch (rerunErr) {
        console.warn(
          '[leads/update] auto-outreach email-fix rerun failed:',
          rerunErr && rerunErr.message,
        );
        autoOutreachRerun = {
          rerun: false,
          reason: (rerunErr && rerunErr.message) || 'rerun_failed',
        };
      }
    }

    const rerunHandledGhl = !!(autoOutreachRerun && autoOutreachRerun.rerun);
    const shouldSyncGhl =
      !rerunHandledGhl &&
      (updateData.lastTouchChannel !== undefined ||
        updateData.status ||
        updateData.lastDisposition !== undefined ||
        updateData.nextActionAt !== undefined ||
        updateData.pipelineStage !== undefined ||
        (req.body && req.body.stageId != null) ||
        leadContactFieldsChanged(req.body, existing));
    if (shouldSyncGhl) {
      triggerGhlProspectSync(fullKey, wid, {
        trigger: updateData.lastTouchChannel
          ? `channel:${updateData.lastTouchChannel}`
          : leadContactFieldsChanged(req.body, existing)
            ? 'contact_update'
            : 'lead_update',
      });
    }

    const freshLead =
      rerunHandledGhl ? (await dbService.getLead(fullKey, wid)) || updated : updated;
    res.json({
      success: true,
      lead: freshLead,
      autoOutreachRerun: autoOutreachRerun || undefined,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/notes/delete — remove a manual panel note
router.post('/:key/notes/delete', express.json(), async (req, res, next) => {
  try {
    const rawKey = req.params.key;
    const fullKey =
      (await dbService.resolveLeadStorageKey(rawKey, req.workspaceId)) ||
      leadKeyFromParam(rawKey);
    const timestamp = String((req.body && req.body.timestamp) || '').trim();
    const value = String((req.body && req.body.value) || '').trim();
    if (!timestamp) {
      return res.status(400).json({ success: false, error: 'Note timestamp is required.' });
    }

    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const match = { timestamp, value };
    const target = findDeletableLeadNote(lead, match);
    if (!target || !isDeletableLeadNote(target)) {
      return res.status(404).json({ success: false, error: 'Note not found or cannot be deleted.' });
    }

    const { updates, logs } = removeLeadNoteFromLead(lead, match);
    const updated = await dbService.updateLead(
      fullKey,
      { updates, logs, logsMode: 'replace' },
      req.workspaceId,
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    res.json({ success: true, updates: updated.updates || updates, lead: updated });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/notes — add a note to a lead
router.post('/:key/notes', express.json(), async (req, res, next) => {
  try {
    const rawKey = req.params.key;
    const fullKey =
      (await dbService.resolveLeadStorageKey(rawKey, req.workspaceId)) ||
      leadKeyFromParam(rawKey);
    const content = String((req.body && req.body.content) || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, error: 'Note text is required.' });
    }

    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const rawType = String((req.body && req.body.type) || 'note').trim().toLowerCase();
    const entryType = rawType === 'quick_log' ? 'quick_log' : 'note';
    const ts = new Date().toISOString();
    const entry = {
      type: entryType,
      value: content,
      timestamp: ts,
      source: entryType === 'quick_log' ? 'quick_log_pill' : 'panel_post',
    };
    if (req.body && req.body.disposition) {
      entry.disposition = String(req.body.disposition).trim();
    }
    if (req.body && req.body.statusChange) {
      entry.statusChange = String(req.body.statusChange).trim();
    }
    const updates = appendLeadUpdate(lead, entry);
    const deferGhlSync = !!(req.body && req.body.deferGhlSync);

    const updated = await dbService.updateLead(
      fullKey,
      {
        updates,
        logs: [
          {
            type: entryType === 'quick_log' ? 'quick_log' : 'note',
            message: content,
            timestamp: ts,
          },
        ],
      },
      req.workspaceId,
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (!deferGhlSync) {
      triggerGhlProspectSync(fullKey, req.workspaceId, {
        trigger: entryType === 'quick_log' ? 'quick_log' : 'note_added',
        note: content,
      });
    }
    res.json({ success: true, updates: updated.updates || updates, lead: updated });
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
      let updatedLead = await dbService.updateLead(fullKey, {
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
      try {
        updatedLead = await applyAutoNoAnswerAfterDial({
          workspaceId: req.workspaceId,
          userEmail: userEmail(req),
          fullKey,
          lead: updatedLead,
        });
      } catch (e) {
        console.warn('[dial] auto no-answer disposition failed:', e && e.message);
      }
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

      // ── Session mode: if a session is already active, queue this lead instead of placing a new call ──
      const existingSession = agentSessionStore.getSession(req.workspaceId);
      if (existingSession) {
        const queued = agentSessionStore.queueNextLead(req.workspaceId, fullKey);
        if (queued) {
          const updates = appendLeadUpdate(lead, {
            type: 'call_queued',
            value: `Queued for active calling session (${lead.phone || 'unknown number'}).`,
            provider: 'signalwire',
          });
          const updatedLead = await dbService.updateLead(fullKey, {
            status: 'Queued for Call',
            updates,
            logs: [
              {
                type: 'call_queued',
                message: `Queued for continuous calling session`,
                timestamp: new Date().toISOString(),
              },
            ],
          });
          return res.json({
            success: true,
            sessionActive: true,
            queued: true,
            lead: updatedLead,
          });
        }
        return res.status(400).json({ success: false, error: 'Failed to queue lead in active session.' });
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
    const leadCallerId = resolveRequestedLeadCallerId(
      ws,
      req.body && (req.body.leadCallerId || req.body.callerId),
    );
    const call = await signalwire.createLeadCall({
      to: normalizedTo,
      leadKey: fullKey,
      workspaceId: req.workspaceId,
      action: 'call',
      from: fromPick.from,
      leadCallerId,
      agentFirst: callMode === 'agent_first',
      agentTo: callMode === 'agent_first' ? resolveAgentFirstNumber(ws) : undefined,
      session: callMode === 'agent_first',  // enable continuous session for agent-first mode
    });
    dialerPacing.recordDialAttempt(telephony, {
      from: fromPick.from,
      to: normalizedTo,
      action: 'call',
      leadKey: fullKey,
      callSid: call.sid || '',
    });
    await dbService.saveWorkspace(req.workspaceId, ws);

    // ── Create agent session for continuous calling ──
    if (callMode === 'agent_first' && call.sid) {
      agentSessionStore.createSession(req.workspaceId, {
        callSid: call.sid,
        agentTo: resolveAgentFirstNumber(ws),
        from: fromPick.from,
        queuedLeadKeys: [],
      });
    }

    const updatedLead = await logLeadOutboundCallInitiated(req, fullKey, lead, {
      callSid: call.sid || '',
      normalizedTo,
      logMessage: `SignalWire call initiated (${call.sid || 'no sid'})`,
    });
    res.json({
      success: true,
      callSid: call.sid || null,
      callerId: leadCallerId || fromPick.from,
      lead: updatedLead,
      sessionActive: callMode === 'agent_first',
    });
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
    const swNumbers = await signalwire.listIncomingPhoneNumbers();
    const signalwireNumbers = (swNumbers.numbers || []).map((n) => n.phoneNumber).filter(Boolean);
    return res.json({
      success: true,
      options: numbers,
      activeFromNumber: resolveWorkspaceCallerNumber(ws),
      leadCallerId: resolveLeadCallerId(ws),
      callMode,
      agentPhone: resolveAgentFirstNumber(ws) || null,
      relayWebrtcAvailable:
        callMode !== 'browser_device' && callMode !== 'agent_first' && signalwire.relayWebrtcCanMint(),
      defaultFromNumber: defaultFrom,
      signalwireNumbers,
      signalwireNumbersError: swNumbers.error || null,
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

// GET /leads/telephony/webrtc-diagnostics — checklist for in-tab WebRTC audio
router.get('/telephony/webrtc-diagnostics', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const callMode = resolveWorkspaceCallMode(ws);
    const base = signalwire.relayWebrtcDiagnostics ? signalwire.relayWebrtcDiagnostics() : {};
    const cfg = signalwire.envConfig();
    const fromQuery = String((req.query && req.query.fromNumber) || '').trim();
    const activeFrom =
      signalwire.normalizePhone(resolveRequestedCallerNumber(ws, fromQuery)) ||
      signalwire.normalizePhone(cfg.callerId || cfg.fromNumber) ||
      '';
    const swNumbers = await signalwire.listIncomingPhoneNumbers();
    const owned = new Set((swNumbers.numbers || []).map((n) => n.phoneNumber).filter(Boolean));
    const callerInBank = !owned.size || (activeFrom && owned.has(activeFrom));
    const jwtProbe =
      base.relayCanMint && signalwire.probeRelayJwtMint
        ? await signalwire.probeRelayJwtMint()
        : { ok: false, error: 'Server cannot mint Relay JWT yet.' };
    const modeOk = callMode === 'cloud_dial';
    const readyForInTabAudio = !!(modeOk && base.relayCanMint && jwtProbe.ok && activeFrom && callerInBank);
    const checks = [
      {
        key: 'space_url',
        label: 'SignalWire space URL',
        ok: !!base.spaceHost,
        detail: base.spaceHost ? `https://${base.spaceHost}` : 'Set SIGNALWIRE_SPACE_URL on Render',
      },
      {
        key: 'project_token',
        label: 'Project ID + API token',
        ok: !!(base.projectIdSet && base.tokenSet),
        detail:
          base.projectIdSet && base.tokenSet
            ? 'Configured — must be from the same adhello-ai space'
            : 'Set SIGNALWIRE_PROJECT_ID and SIGNALWIRE_TOKEN',
      },
      {
        key: 'from_number',
        label: 'Default outbound number',
        ok: !!activeFrom,
        detail: activeFrom || 'Set SIGNALWIRE_FROM_NUMBER or workspace phone bank default',
      },
      {
        key: 'caller_in_bank',
        label: 'Caller ID in phone bank',
        ok: callerInBank,
        detail: callerInBank
          ? activeFrom || 'OK'
          : `${activeFrom || 'Selected number'} is not in this SignalWire project`,
      },
      {
        key: 'call_mode',
        label: 'Call routing mode',
        ok: modeOk,
        detail: modeOk
          ? 'Cloud dial (browser mic)'
          : `Current mode: ${formatCallModeLabel(callMode)} — switch to Cloud dial in Workspace → Phone bank`,
      },
      {
        key: 'jwt_mint',
        label: 'Browser WebRTC token',
        ok: !!jwtProbe.ok,
        detail: jwtProbe.ok ? 'Server can mint Relay JWT' : jwtProbe.error || 'JWT mint failed',
      },
    ];
    return res.json({
      success: true,
      readyForInTabAudio,
      callMode,
      activeFromNumber: activeFrom,
      relayWebrtcAvailable:
        callMode !== 'browser_device' && callMode !== 'agent_first' && !!base.relayCanMint,
      checks,
      signalwireNumbers: [...owned].slice(0, 25),
      signalwireNumbersError: swNumbers.error || null,
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
    const swNumbers = await signalwire.listIncomingPhoneNumbers();
    const owned = new Set((swNumbers.numbers || []).map((n) => n.phoneNumber).filter(Boolean));
    if (owned.size && !owned.has(fromNumber)) {
      return res.status(400).json({
        success: false,
        error: `Caller ID ${fromNumber} is not a SignalWire number in your project. In Workspace → Phone bank, use a number from “Available numbers”, or fix SIGNALWIRE_FROM_NUMBER on the server.`,
        fromNumber,
        signalwireNumbers: [...owned].slice(0, 25),
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

// POST /leads/telephony/resolve-contacts — map dialed numbers to lead names for softphone Recents/Queue
router.post('/telephony/resolve-contacts', async (req, res, next) => {
  try {
    const phones = Array.isArray(req.body && req.body.phones) ? req.body.phones : [];
    if (!phones.length) {
      return res.json({ success: true, contacts: [] });
    }
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const contacts = [];
    const seen = new Set();

    phones.forEach((rawPhone) => {
      const target = signalwire.normalizePhone(rawPhone);
      if (!target) return;
      const target10 = target.replace(/\D/g, '').slice(-10);
      const dedupeKey = target10 || target;
      if (seen.has(dedupeKey)) return;

      const lead = visible.find((l) => {
        const lp = signalwire.normalizePhone(l.phone);
        if (!lp) return false;
        const lp10 = lp.replace(/\D/g, '').slice(-10);
        return lp === target || (target10 && lp10 === target10);
      });
      if (!lead) return;

      seen.add(dedupeKey);
      contacts.push({
        phone: target,
        title: String(lead.title || lead.contactName || 'Company').trim(),
        key: shortLeadKey(lead),
      });
    });

    res.json({ success: true, contacts });
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
    const leadCallerId = resolveRequestedLeadCallerId(
      ws,
      req.body && (req.body.leadCallerId || req.body.callerId),
    );
    const call = await signalwire.createLeadCall({
      to,
      leadKey: fullLeadKey,
      workspaceId: req.workspaceId,
      action,
      voicemailAudioUrl: action === 'voicemail_drop' ? voicemailAudioUrl : '',
      from: fromPick.from,
      leadCallerId,
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
      callerId: leadCallerId || fromPick.from,
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
        `Disposition: ${humanizeDisposition(disposition)}`,
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
      try {
        const result = await signalwire.completeCall(callSid);
        return res.json({
          success: true,
          action: 'hangup',
          callSid,
          alreadyCompleted: !!(result && result.alreadyCompleted),
        });
      } catch (err) {
        if (signalwire.isCallAlreadyFinishedError(err)) {
          return res.json({
            success: true,
            action: 'hangup',
            callSid,
            alreadyCompleted: true,
          });
        }
        throw err;
      }
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

// ── Continuous Agent-First Calling Session ──────────────────────────────────

// GET /leads/telephony/session/status — check if a continuous calling session is active
router.get('/telephony/session/status', async (req, res, next) => {
  try {
    const session = agentSessionStore.getSession(req.workspaceId);
    if (!session) {
      return res.json({ success: true, active: false });
    }
    return res.json({
      success: true,
      active: true,
      callSid: session.callSid,
      queuedCount: (session.queuedLeadKeys || []).length,
      currentLeadKey: session.currentLeadKey || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/session/next — queue a lead for the active session
router.post('/telephony/session/next', express.json(), async (req, res, next) => {
  try {
    const leadKey = String((req.body && req.body.leadKey) || '').trim();
    if (!leadKey) {
      return res.status(400).json({ success: false, error: 'leadKey is required.' });
    }
    const session = agentSessionStore.getSession(req.workspaceId);
    if (!session) {
      return res.status(400).json({ success: false, error: 'No active calling session.' });
    }
    const queued = agentSessionStore.queueNextLead(req.workspaceId, leadKey);
    return res.json({ success: true, queued, queuedCount: (session.queuedLeadKeys || []).length });
  } catch (err) {
    next(err);
  }
});

// POST /leads/telephony/session/end — end the continuous calling session
router.post('/telephony/session/end', express.json(), async (req, res, next) => {
  try {
    const session = agentSessionStore.getSession(req.workspaceId);
    if (!session) {
      return res.json({ success: true, message: 'No active session.' });
    }
    // Hang up the agent's call via REST API
    if (session.callSid) {
      try {
        await signalwire.completeCall(session.callSid);
      } catch (hangupErr) {
        console.error('[session:end] hangup failed:', hangupErr.message);
      }
    }
    agentSessionStore.removeSession(req.workspaceId);
    return res.json({ success: true, message: 'Session ended.' });
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
    if (!(await leadInRequestWorkspace(lead, req))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    let panelLead = normalizeLeadForPanel({ ...lead, key: lead.key || fullKey });

    const skipEnrich = String(req.query.enrich || '').trim() === '0';
    const needsPanelEnrich =
      !skipEnrich &&
      (leadMissingCoreContact(panelLead) ||
        outscraperLeadEnrich.leadNeedsOutscraperContacts(panelLead));
    if (needsPanelEnrich) {
      try {
        const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
        const enriched = await leadPanelEnrich.enrichLeadForPanelSidebar(panelLead, integrationEnv, {
          timeoutMs: 14000,
        });
        if (enriched && enriched.patch && Object.keys(enriched.patch).length) {
          panelLead = normalizeLeadForPanel({ ...panelLead, ...enriched.patch });
          dbService
            .updateLead(fullKey, enriched.patch, req.workspaceId)
            .catch((e) => console.warn('[panel-data] Outscraper enrich persist failed:', e.message));
        }
      } catch (enrichErr) {
        console.warn('[panel-data] sidebar enrich skipped:', enrichErr.message);
      }
    }

    const needsBackground =
      !skipEnrich && leadPanelEnrich.panelLeadNeedsBackgroundEnhance(panelLead);

    return res.json({
      success: true,
      lead: {
        ...panelLead,
        key: panelLead.key || fullKey,
        workspaceId: req.workspaceId || panelLead.workspaceId,
      },
      needsBackgroundEnhance: needsBackground,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/builtwith-enrich — optional tech stack fetch (user-initiated)
router.post('/:key/builtwith-enrich', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    if (!(await leadInRequestWorkspace(lead, req))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!outscraper.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Outscraper is not configured. Add Outscraper under Workspace → Integrations to load BuiltWith tech stack.',
      });
    }

    const bwPack = await builtWithEnrich.enrichLeadFromBuiltWith(lead, integrationEnv);
    if (!bwPack || !bwPack.used || !bwPack.patch || !Object.keys(bwPack.patch).length) {
      return res.json({
        success: true,
        lead: normalizeLeadForPanel({ ...lead, key: lead.key || fullKey }),
        message: 'No tech stack data found for this domain.',
      });
    }

    const updated = await dbService.updateLead(fullKey, bwPack.patch, req.workspaceId);
    return res.json({
      success: true,
      lead: normalizeLeadForPanel({ ...updated, key: updated.key || fullKey }),
    });
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

// GET /leads/:key/sms-thread — two-way SMS thread (local + optional GHL sync)
router.get('/:key/sms-thread', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const sync = ['1', 'true', 'yes'].includes(String(req.query.sync || '').toLowerCase());
    const smsStatus = smsOutbound.messagingStatus(integrationEnv);
    const ghlConfigured = smsStatus.ghlConfigured;

    let messages;
    let synced = 0;
    let updatedLead = lead;

    if (sync && ghlConfigured) {
      const syncResult = await ghlMessaging.syncGhlSmsToLead({ lead, integrationEnv });
      messages = syncResult.messages || [];
      synced = syncResult.added || 0;
      if (syncResult.patch && synced > 0) {
        updatedLead = await dbService.updateLead(fullKey, syncResult.patch);
      } else {
        updatedLead = syncResult.lead || lead;
      }
    } else {
      messages = await ghlMessaging.buildSmsThreadForLead({
        lead,
        integrationEnv,
        syncFromGhl: sync && ghlConfigured,
      });
    }

    return res.json({
      success: true,
      messages,
      synced,
      ghlConfigured,
      commsConfigured: smsStatus.commsConfigured,
      provider: smsStatus.provider,
      providerLabel: smsStatus.providerLabel,
      lead: updatedLead,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sms-thread/sync — pull GHL SMS history into lead updates
router.post('/:key/sms-thread/sync', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!ghlClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Go High Level is not configured for this workspace.',
      });
    }

    const syncResult = await ghlMessaging.syncGhlSmsToLead({ lead, integrationEnv });
    let updatedLead = lead;
    if (syncResult.patch && syncResult.added > 0) {
      updatedLead = await dbService.updateLead(fullKey, syncResult.patch);
    }

    return res.json({
      success: true,
      added: syncResult.added || 0,
      messages: syncResult.messages || [],
      lead: updatedLead,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sms — send outbound SMS/iMessage (Comms, GHL, or SignalWire)
router.post('/:key/sms', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Message body is required.' });

    const toOverride = String((req.body && req.body.to) || '').trim();
    const saveToLead = !!(req.body && req.body.saveToLead);

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const preferredProvider = String((req.body && req.body.provider) || '').trim().toLowerCase();

    const sent = await smsOutbound.sendSmsToLead({
      lead,
      message: body,
      integrationEnv,
      workspaceId: req.workspaceId,
      fromNumber: resolveWorkspaceCallerNumber(await dbService.getWorkspace(req.workspaceId)),
      provider: preferredProvider || undefined,
      to: toOverride || undefined,
    });

    const providerLabel = smsOutbound.providerDisplayName(sent.provider);
    const channelNote =
      sent.provider === 'comms' && sent.channel === 'imessage'
        ? 'iMessage'
        : sent.provider === 'comms' && sent.channel === 'sms'
          ? 'SMS'
          : 'SMS';

    const updateEntry = {
      type: 'sms_outbound',
      value: body,
      messageSid: sent.messageId || '',
      provider: sent.provider,
    };
    if (sent.provider === 'ghl') {
      updateEntry.ghlContactId = sent.contactId || lead.ghlContactId || '';
      updateEntry.ghlMessageId = sent.messageId || '';
    }
    if (sent.provider === 'comms') {
      updateEntry.commsMessageId = sent.messageId || '';
      updateEntry.channel = sent.channel || '';
    }

    const updates = appendLeadUpdate(lead, updateEntry);
    const patch = {
      ...contactedPatch,
      status: 'Follow-up',
      lastTouchChannel: 'sms',
      updates,
      logs: [
        {
          type: 'sms_outbound',
          message: `${providerLabel} ${channelNote} sent${sent.messageId ? ` (${sent.messageId})` : ''}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    if (sent.provider === 'ghl' && sent.contactId) {
      patch.ghlContactId = sent.contactId || lead.ghlContactId;
    }
    if (saveToLead && toOverride) {
      patch.phone = toOverride;
    }

    const updatedLead = await dbService.updateLead(fullKey, patch);
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'sms_sent' });

    return res.json({
      success: true,
      provider: sent.provider,
      providerLabel,
      channel: sent.channel || 'sms',
      messageId: sent.messageId || null,
      messageSid: sent.provider === 'signalwire' ? sent.messageId || null : undefined,
      ghlContactId: sent.contactId || null,
      lead: updatedLead,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/email — send outbound email via GHL
router.post('/:key/email', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const subject = String((req.body && req.body.subject) || '').trim();
    const body = String((req.body && req.body.body) || '').trim();
    const html = String((req.body && req.body.html) || '').trim();
    if (!body && !html) {
      return res.status(400).json({ success: false, error: 'Email body is required.' });
    }

    const toOverride = String((req.body && req.body.to) || '').trim();
    const saveToLead = !!(req.body && req.body.saveToLead);

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!ghlClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Connect Go High Level in Workspace → Integrations to send email from the app.',
      });
    }

    const sent = await ghlMessaging.sendEmailToLead({
      lead,
      subject,
      body,
      html,
      integrationEnv,
      toEmail: toOverride || undefined,
    });
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const updates = appendLeadUpdate(lead, {
      type: 'email_outbound',
      value: subject || body.slice(0, 120),
      messageSid: sent.messageId || '',
      provider: 'ghl',
      ghlContactId: sent.contactId || lead.ghlContactId || '',
    });
    const emailPatch = {
      ...contactedPatch,
      ghlContactId: sent.contactId || lead.ghlContactId,
      status: 'Email Sent',
      lastTouchChannel: 'email',
      updates,
      logs: [
        {
          type: 'email_outbound',
          message: `GHL email sent${sent.messageId ? ` (${sent.messageId})` : ''}${toOverride ? ` to ${toOverride}` : ''}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    if (saveToLead && toOverride) {
      emailPatch.email = toOverride;
    }
    const updatedLead = await dbService.updateLead(fullKey, emailPatch);
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'email_sent' });
    res.json({
      success: true,
      provider: 'ghl',
      messageId: sent.messageId || null,
      ghlContactId: sent.contactId || null,
      lead: updatedLead,
    });
  } catch (err) {
    next(err);
  }
});

// GET /leads/:key/info-pack-preview — resolved materialized pack for UI prefill
router.get('/:key/info-pack-preview', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (!(await leadInRequestWorkspace(lead, req))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const ws = await dbService.getWorkspace(req.workspaceId);
    let folder = null;
    if (lead.folderKey) {
      folder = await dbService.getFolder(req.workspaceId, lead.folderKey);
    }
    const pack = await resolveInfoPackForLead({ workspace: ws, folder, lead });
    const audit = await resolveAuditUrlForInfoPack({
      pack,
      lead,
      workspaceId: req.workspaceId,
      workspace: ws,
      req,
    });
    const auditUrl = audit.ok && audit.reportUrl ? audit.reportUrl : null;
    const materialized = materializeInfoPackForLead(pack, lead, { auditUrl: auditUrl || undefined });
    res.json({
      success: true,
      pack,
      materialized,
      auditUrl,
      folderKey: lead.folderKey || '',
      folderName: folder && folder.name ? folder.name : '',
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/send-info-pack — send all enabled channels
router.post('/:key/send-info-pack', express.json(), async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (!(await leadInRequestWorkspace(lead, req))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const ws = await dbService.getWorkspace(req.workspaceId);
    let folder = null;
    if (lead.folderKey) {
      folder = await dbService.getFolder(req.workspaceId, lead.folderKey);
    }
    const basePack = await resolveInfoPackForLead({ workspace: ws, folder, lead });
    const packOverrides = req.body && req.body.pack ? parseInfoPackFromBody({ infoPack: req.body.pack }) : null;
    const pack = packOverrides ? mergePackOverrides(basePack, packOverrides) : basePack;

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const overrides = {
      phone: String((req.body && req.body.phone) || '').trim(),
      email: String((req.body && req.body.email) || '').trim(),
      saveToLead: !!(req.body && req.body.saveToLead),
    };

    const result = await sendInfoPackToLead({
      lead,
      workspaceId: req.workspaceId,
      workspace: ws,
      integrationEnv,
      pack,
      overrides,
      req,
      resolveCallerNumber: () => resolveWorkspaceCallerNumber(ws),
      appendLeadUpdateFn: appendLeadUpdate,
      buildContactedStagePatchFn: buildContactedStagePatch,
    });

    if (result.lead) {
      triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'info_pack_sent' });
    }

    const anySent = [result.sms, result.email, result.directMail].some((r) => r && r.ok);
    const allSkipped = [result.sms, result.email, result.directMail].every(
      (r) => !r || r.skipped || !r.ok,
    );

    res.json({
      success: anySent || !allSkipped || !result.auditError,
      anySent,
      sms: result.sms,
      email: result.email,
      directMail: result.directMail,
      materialized: result.materialized,
      auditUrl: result.auditUrl,
      lead: result.lead || lead,
      error: result.auditError || null,
    });
  } catch (err) {
    next(err);
  }
});

function buildWorkspaceOutreachScriptsPayload(ws) {
  const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
  const offerKeys = salesScriptsStorage.getWorkspaceScriptKeys(ws, SCRIPT_LIBRARY);
  const services = offerKeys.map((k) => ({
    key: k,
    label: (mergedLibrary[k] && mergedLibrary[k].label) || k,
  }));
  const library = buildOutreachLibrary(mergedLibrary, offerKeys);
  return {
    success: true,
    channels: OUTREACH_CHANNELS,
    services,
    library,
    offerKeys,
    defaultServiceKey: offerKeys[0] || '',
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
    payload.defaultServiceKey = payload.offerKeys.includes(leadServiceKey)
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
    const offerKeys = salesScriptsStorage.getWorkspaceScriptKeys(ws, SCRIPT_LIBRARY);
    const savedItems = salesScriptsStorage.getInitialLibraryItemsFromWorkspace(ws);

    const leadServiceKey =
      (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) || lead.primaryServiceKey || '';
    const serviceKey = offerKeys.includes(leadServiceKey)
      ? leadServiceKey
      : offerKeys[0];
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

    const context = String((req.body && req.body.context) || '').trim().toLowerCase();
    const result = await smsPersonalize.personalizeSmsForLead(lead, scriptText, {
      context: context === 'cadence' ? 'cadence' : 'outreach',
    });
    return res.json({
      success: true,
      personalized: result.message,
      provider: result.provider,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/sms-ai-send — AI write personalized SMS and send in one step
router.post('/:key/sms-ai-send', async (req, res, next) => {
  try {
    const fullKey = leadKeyFromParam(req.params.key);
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const scriptText = String(
      (req.body && (req.body.scriptText || req.body.cadenceHint)) || '',
    ).trim();
    if (!scriptText) {
      return res.status(400).json({ success: false, error: 'scriptText is required.' });
    }

    const context = String((req.body && req.body.context) || '').trim().toLowerCase();
    const aiResult = await smsPersonalize.personalizeSmsForLead(lead, scriptText, {
      context: context === 'cadence' ? 'cadence' : 'outreach',
    });
    const message = String(aiResult.message || '').trim();
    if (!message) {
      return res.status(500).json({ success: false, error: 'AI did not return a message.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const preferredProvider = String((req.body && req.body.provider) || '').trim().toLowerCase();

    const sent = await smsOutbound.sendSmsToLead({
      lead,
      message,
      integrationEnv,
      workspaceId: req.workspaceId,
      fromNumber: resolveWorkspaceCallerNumber(await dbService.getWorkspace(req.workspaceId)),
      provider: preferredProvider || undefined,
    });

    const providerLabel = smsOutbound.providerDisplayName(sent.provider);
    const channelNote =
      sent.provider === 'comms' && sent.channel === 'imessage' ? 'iMessage' : 'SMS';

    const updateEntry = {
      type: 'sms_outbound',
      value: message,
      messageSid: sent.messageId || '',
      provider: sent.provider,
      aiProvider: aiResult.provider || '',
    };
    if (sent.provider === 'ghl') {
      updateEntry.ghlContactId = sent.contactId || lead.ghlContactId || '';
      updateEntry.ghlMessageId = sent.messageId || '';
    }
    if (sent.provider === 'comms') {
      updateEntry.commsMessageId = sent.messageId || '';
      updateEntry.channel = sent.channel || '';
    }

    const updates = appendLeadUpdate(lead, updateEntry);
    const patch = {
      ...contactedPatch,
      status: 'Follow-up',
      lastTouchChannel: 'sms',
      updates,
      logs: [
        {
          type: 'sms_outbound',
          message: `AI ${channelNote} → ${providerLabel}${sent.messageId ? ` (${sent.messageId})` : ''}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    if (sent.provider === 'ghl' && sent.contactId) {
      patch.ghlContactId = sent.contactId || lead.ghlContactId;
    }

    const updatedLead = await dbService.updateLead(fullKey, patch);
    triggerGhlProspectSync(fullKey, req.workspaceId, { trigger: 'sms_sent' });

    return res.json({
      success: true,
      personalized: message,
      aiProvider: aiResult.provider,
      provider: sent.provider,
      providerLabel,
      channel: sent.channel || 'sms',
      messageId: sent.messageId || null,
      lead: updatedLead,
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

/**
 * POST /leads/website-enrich-queue
 * Body: { leadKeys: string[] }
 * Queues selected pipeline leads (with websites) for the Chrome extension to scrape
 * contacts/socials in parallel (~5 tabs), then PATCH fill-missing via autonomous API.
 */
router.post('/website-enrich-queue', express.json(), async (req, res, next) => {
  try {
    const leadKeys = parseBulkSelectionKeys(
      Array.isArray(req.body?.leadKeys) ? req.body.leadKeys.join(',') : req.body?.leadKeys,
    );
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'Select at least one lead.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const resolved = await resolveLeadsBySelectedKeys({
      dbService,
      workspaceId: req.workspaceId,
      visibleLeads: visible,
      keyOrder: leadKeys,
    });

    if (!resolved.length) {
      return res.status(404).json({
        success: false,
        error: 'No matching saved leads found. Save them to your pipeline first.',
      });
    }

    const withWebsite = resolved.filter((l) => websiteEnrichQueue.pickLeadWebsite(l));
    const needing = websiteEnrichQueue.buildWebsiteEnrichQueueItems(withWebsite);
    const skippedNoWebsite = resolved.length - withWebsite.length;
    const skippedComplete = withWebsite.length - needing.length;

    if (!needing.length) {
      return res.json({
        success: true,
        queued: 0,
        totalSelected: resolved.length,
        skippedNoWebsite,
        skippedComplete,
        empty: true,
        message:
          skippedNoWebsite === resolved.length
            ? 'Selected leads have no website URL to scrape.'
            : 'Selected leads already have contact and social fields filled.',
      });
    }

    await websiteEnrichQueue.saveWebsiteEnrichQueue(
      dbService,
      req.workspaceId,
      needing.map((l) => l.key),
    );

    return res.json({
      success: true,
      queued: needing.length,
      totalSelected: resolved.length,
      skippedNoWebsite,
      skippedComplete,
      empty: false,
      message: `Queued ${needing.length} lead${needing.length === 1 ? '' : 's'} for website scrape.`,
      hint: 'Open the AdHello Chrome extension → Bulk scrape → Process website queue (5 tabs at a time).',
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/bulk-stage-assign — assign pipeline stage (and optional folder) to multiple leads
router.post('/bulk-stage-assign', express.json(), async (req, res, next) => {
  try {
    const stageId = String(req.body?.stageId || '').trim();
    const folderKey =
      req.body?.folderKey != null ? String(req.body.folderKey).trim() : undefined;
    const leadKeysRaw = Array.isArray(req.body?.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);

    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }

    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    if (!stageId || !stageRows.some((s) => s.id === stageId)) {
      return res.status(400).json({ success: false, error: 'Valid stageId is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const visibleKeys = new Set(visible.map((l) => l.key));

    const resolveVisibleLeadKey = (rawKey) => {
      const k = String(rawKey || '').trim();
      if (!k) return null;
      const candidates = [
        k,
        k.startsWith('lead:') ? k : `lead:${k}`,
        k.startsWith('lead:') ? k.slice(5) : null,
      ].filter(Boolean);
      for (const c of candidates) {
        if (visibleKeys.has(c)) return c;
      }
      return null;
    };

    const updatedKeys = [];
    const updatedLeads = [];
    for (const key of leadKeys) {
      const fullKey = resolveVisibleLeadKey(key);
      if (!fullKey) continue;
      const existing = await dbService.getLead(fullKey);
      if (!existing) continue;
      const patch = {
        ...pipelineStagesService.patchLeadStageFields(existing, stageRows, stageId),
        pipelineStageUpdatedAt: new Date().toISOString(),
        onPipelineBoard: true,
      };
      if (folderKey !== undefined) patch.folderKey = folderKey;
      const lead = await dbService.updateLead(fullKey, patch, req.workspaceId);
      if (lead) {
        updatedKeys.push(lead.key);
        updatedLeads.push({
          key: lead.key,
          stageId,
          pipelineStage: pipelineStagesService.stageIndex1Based(stageRows, stageId),
          folderKey: lead.folderKey || '',
          onPipelineBoard: true,
        });
      }
    }

    res.json({ success: updatedKeys.length > 0, updatedKeys, stageId, leads: updatedLeads });
  } catch (err) {
    next(err);
  }
});

// POST /leads/bulk-category — set categoryName on multiple leads
router.post('/bulk-category', express.json(), async (req, res, next) => {
  try {
    const categoryRaw = req.body?.categoryName != null ? req.body.categoryName : req.body?.category;
    const categoryName = normalizeLeadCategoryName(categoryRaw, 'N/A');
    const leadKeysRaw = Array.isArray(req.body?.leadKeys) ? req.body.leadKeys : [];
    const leadKeys = leadKeysRaw.map((k) => String(k || '').trim()).filter(Boolean);

    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'leadKeys is required.' });
    }

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const visibleKeys = new Set(visible.map((l) => l.key));

    const resolveVisibleLeadKey = (rawKey) => {
      const k = String(rawKey || '').trim();
      if (!k) return null;
      const candidates = [k, k.startsWith('lead:') ? k : `lead:${k}`, k.startsWith('lead:') ? k.slice(5) : null].filter(
        Boolean,
      );
      for (const c of candidates) {
        if (visibleKeys.has(c)) return c;
      }
      return null;
    };

    const updatedKeys = [];
    const updatedLeads = [];
    for (const key of leadKeys) {
      const fullKey = resolveVisibleLeadKey(key);
      if (!fullKey) continue;
      const existing = await dbService.getLead(fullKey);
      if (!existing) continue;
      const nextCategory = sanitizeLeadCategoryName(categoryName, existing.title, categoryName);
      const lead = await dbService.updateLead(fullKey, { categoryName: nextCategory }, req.workspaceId);
      if (lead) {
        updatedKeys.push(lead.key);
        updatedLeads.push({ key: lead.key, categoryName: lead.categoryName || nextCategory });
      }
    }

    res.json({ success: updatedKeys.length > 0, updatedKeys, categoryName, leads: updatedLeads });
  } catch (err) {
    next(err);
  }
});

// POST /leads/bulk-merge — combine multi-location / name-variant leads into one primary
router.post('/bulk-merge', express.json(), async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
    const primaryKey = String((req.body && req.body.primaryKey) || '').trim();
    const result = await mergeLeadsByKeys({
      dbService,
      workspaceId: req.workspaceId,
      keys,
      primaryKey: primaryKey || undefined,
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /leads/bulk-delete — delete multiple leads by key (JSON body)
router.post('/bulk-delete', express.json(), async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
    const normKeys = keys.map((k) => String(k || '').trim()).filter(Boolean);
    if (!normKeys.length) {
      return res.status(400).json({ success: false, error: 'No lead keys provided.' });
    }
    let deleted = 0;
    const errors = [];
    const deletedKeys = [];
    for (const raw of normKeys) {
      const storageKey = await dbService.resolveLeadStorageKey(raw, req.workspaceId);
      if (!storageKey) {
        errors.push({ key: raw, error: 'Lead not found.' });
        continue;
      }
      const existing = await dbService.getLead(storageKey);
      if (
        existing &&
        existing.workspaceId &&
        String(existing.workspaceId) !== String(req.workspaceId)
      ) {
        errors.push({ key: raw, error: 'Lead is in another workspace.' });
        continue;
      }
      await dbService.deleteLead(storageKey);
      deleted += 1;
      deletedKeys.push(raw);
    }
    return res.json({
      success: deleted > 0,
      deleted,
      deletedKeys,
      failed: normKeys.length - deleted,
      errors,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/delete — remove a saved lead
router.post('/:key/delete', async (req, res, next) => {
  try {
    const rawKey = decodeURIComponent(String(req.params.key || '').trim());
    const storageKey = await dbService.resolveLeadStorageKey(rawKey, req.workspaceId);
    if (!storageKey) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ success: false, error: 'Lead not found.' });
      }
      return res.redirect('/prospecting?tab=pipeline');
    }
    const existing = await dbService.getLead(storageKey);
    if (
      existing &&
      existing.workspaceId &&
      String(existing.workspaceId) !== String(req.workspaceId)
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(403).json({ success: false, error: 'Lead is in another workspace.' });
      }
      return res.redirect('/prospecting?tab=pipeline');
    }
    await dbService.deleteLead(storageKey);

    // If request is from fetch (JSON), return JSON; otherwise redirect
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, key: storageKey });
    }
    res.redirect('/prospecting?tab=pipeline');
  } catch (err) {
    next(err);
  }
});

function pickHeuristicServiceKey(lead, allowedKeys) {
  const keys = Array.isArray(allowedKeys) && allowedKeys.length ? allowedKeys : SCRIPT_LIBRARY_KEYS;
  const existing =
    (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) ||
    lead.primaryServiceKey ||
    '';
  if (keys.includes(existing)) return existing;

  const website = !!(lead.website && lead.website !== 'N/A');
  const reviews = parseInt(lead.reviewsCount, 10) || 0;
  const rating = parseFloat(lead.totalScore) || 0;

  const candidates = [];
  if (!website || lead.isOutdated === true || lead.isMobileFriendly === false) candidates.push('aiWebsites');
  if (reviews < 25 || (rating > 0 && rating < 4.3)) candidates.push('reputation');
  if (lead.hasChatbot === false || lead.hasClickToCall === false) candidates.push('speedToLeadAgent');
  if (lead.aeoScore != null && parseInt(lead.aeoScore, 10) < 55) candidates.push('reputation');
  candidates.push('aiWebsites');
  for (const candidate of candidates) {
    if (keys.includes(candidate)) return candidate;
  }
  return keys[0] || 'aiWebsites';
}

function buildHeuristicLeadInsight(lead, scriptLibrary, allowedKeys) {
  const keys = Array.isArray(allowedKeys) && allowedKeys.length ? allowedKeys : SCRIPT_LIBRARY_KEYS;
  const library = scriptLibrary && typeof scriptLibrary === 'object' ? scriptLibrary : SCRIPT_LIBRARY;
  const serviceKey = pickHeuristicServiceKey(lead, keys);
  const def = library[serviceKey] || SCRIPT_LIBRARY[serviceKey] || library[keys[0]] || {};
  const company = String(lead.title || 'this business').trim() || 'this business';
  const city = [lead.city, lead.state].filter(Boolean).join(', ') || 'your area';
  const category = String(lead.categoryName || 'local business').trim();
  const reviews = parseInt(lead.reviewsCount, 10) || 0;
  const rating = parseFloat(lead.totalScore) || 0;
  const gaps = [];
  if (!lead.website || lead.website === 'N/A') gaps.push('no website on file');
  if (lead.isMobileFriendly === false) gaps.push('mobile experience gaps');
  if (lead.hasChatbot === false) gaps.push('no lead-capture chat');
  if (lead.hasSchemaMarkup === false) gaps.push('local SEO / schema gaps');
  if (reviews > 0 && rating > 0 && rating < 4.4) gaps.push('review sentiment risk');

  const gapPhrase = gaps.length ? gaps.slice(0, 2).join(' and ') : 'visibility and conversion basics';
  const rationale = `${company} is a ${category} in ${city}. Based on their profile signals, ${def.label || 'this offer'} is the most logical first project — especially around ${gapPhrase}.`;
  const talkTrack =
    String(def.opening || '')
      .replace(/\{\{company\}\}/g, company)
      .replace(/\{\{name\}\}/g, 'there')
      .replace(/\{\{city\}\}/g, city)
      .split('\n')[0]
      .trim() ||
    `Hi — I was looking at ${company} in ${city} and had a quick idea about ${(def.label || 'growth').toLowerCase()}.`;

  return {
    primaryServiceKey: serviceKey,
    primaryServiceLabel: def.label || serviceKey,
    rationale,
    talkTrack,
    warRoomOpener: talkTrack,
    provider: 'heuristic',
  };
}

// POST /leads/:key/generate-prompt — personalized outreach (OpenRouter, else template)
router.post('/:key/generate-prompt', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!(await leadInRequestWorkspace(lead, req))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

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
      const cityLine = [lead.city, lead.state].filter(Boolean).join(', ') || 'your area';
      const rating = lead.totalScore != null ? lead.totalScore : '—';
      const reviews = lead.reviewsCount != null ? lead.reviewsCount : 0;
      const category = lead.categoryName && lead.categoryName !== 'N/A' ? lead.categoryName : 'local';
      prompt = `Hi ${lead.title || 'there'},\n\nI noticed your business in ${cityLine} has a ${rating} rating with ${reviews} reviews. We help ${category} operators like you turn visibility into booked calls.\n\nOpen to a 15-minute fit call next week?\n\nBest,\n[Your Name]`;
    }

    const contactedPatch = await buildContactedStagePatch(lead, req.workspaceId);
    const preview = !!(req.body && req.body.preview);
    if (!preview) {
      await dbService.updateLead(fullKey, {
        ...contactedPatch,
        outreachPrompt: prompt,
      });
    }
    res.json({ success: true, prompt, llm });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/insights — OpenRouter: best service to sell + rationale (cached 7d)
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

    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const offerKeys = salesScriptsStorage.getWorkspaceScriptKeys(ws, SCRIPT_LIBRARY);

    const offeringCatalog = offerKeys
      .map((id) => {
        const s = mergedLibrary[id] || SCRIPT_LIBRARY[id] || {};
        return `- ${id}: ${s.label || id} — ${s.valueProp || ''}`;
      })
      .join('\n');
    const serviceKeyList = offerKeys.join(', ');

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
      const heuristic = buildHeuristicLeadInsight(lead, mergedLibrary, offerKeys);
      return res.json({ success: true, cached: false, ...heuristic });
    }

    const parsed = parseLlmJson(ai.content);
    if (!parsed) {
      const heuristic = buildHeuristicLeadInsight(lead, mergedLibrary, offerKeys);
      return res.json({ success: true, cached: false, ...heuristic });
    }

    const fallbackKey = offerKeys[0] || 'aiWebsites';
    const keyOk = offerKeys.includes(parsed.primaryServiceKey);
    const insight = {
      primaryServiceKey: keyOk ? parsed.primaryServiceKey : fallbackKey,
      primaryServiceLabel:
        parsed.primaryServiceLabel ||
        (mergedLibrary[fallbackKey] && mergedLibrary[fallbackKey].label) ||
        fallbackKey,
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

// POST /leads/:key/review-intelligence — AI review summary from snippets + rating (cached 7d)
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
        const summary =
          typeof ri.summary === 'string'
            ? ri.summary
            : Array.isArray(ri.strengths)
              ? [...(ri.strengths || []), ...(ri.weaknesses || [])].filter(Boolean).join(' ')
              : '';
        return res.json({
          success: true,
          cached: true,
          summary,
          sourceNote: typeof ri.sourceNote === 'string' ? ri.sourceNote : '',
        });
      }
    }

    const snippets = coalesceReviewSnippets(lead);
    const aiPack = await generateReviewIntelForLead({ ...lead, reviewSnippets: snippets });
    if (aiPack && aiPack.error) {
      return res.json({ success: false, error: aiPack.error });
    }
    if (!aiPack || !aiPack.intel) {
      return res.json({ success: false, error: 'Invalid AI response' });
    }

    const intel = aiPack.intel;

    await dbService.updateLead(fullKey, {
      reviewIntel: intel,
      reviewIntelAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      cached: false,
      summary: intel.summary || '',
      sourceNote: intel.sourceNote || '',
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
  let monidUsed = false;
  let outscraperUsed = false;
  let outscraperContactsUsed = false;
  let urlToSave = null;
  let mapsPlace = null;
  let gmbPack = null;

  const leadWorkspaceId = (lead && lead.workspaceId) || workspaceId;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);
  let workingLead = lead;
  const persistedKeys = new Set();
  const patch = {};
  const baseUpdates = [...(lead.updates || [])];
  const priorUpdateLen = baseUpdates.length;

  async function autosaveEnhancement(partial, label) {
    const toSave = {};
    for (const [k, v] of Object.entries(partial || {})) {
      if (k === 'updates' || persistedKeys.has(k)) continue;
      if (v === undefined || v === null) continue;
      toSave[k] = v;
    }
    if (!Object.keys(toSave).length) return workingLead;
    const updated = await dbService.updateLead(fullKey, toSave, leadWorkspaceId);
    if (updated) {
      workingLead = updated;
      Object.assign(patch, toSave);
      Object.keys(toSave).forEach((k) => persistedKeys.add(k));
      console.log(`[ENHANCE] Autosaved (${label}): ${Object.keys(toSave).join(', ')}`);
    }
    return workingLead;
  }

  const leadProfile = { title: workingLead.title, city: workingLead.city, state: workingLead.state };

  // Step 1: Outscraper Google Business Profile — listing, domain, reviews
  if (outscraper.isConfigured(integrationEnv)) {
    try {
      gmbPack = await outscraperGmbEnrich.enrichLeadFromOutscraperGmb(workingLead, integrationEnv);
      if (gmbPack && gmbPack.used) {
        outscraperUsed = true;
        mapsPlace = gmbPack.place || mapsPlace;
        deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(gmbPack.extract || {}, deepData || {});
        if (gmbPack.patch && gmbPack.patch.website && gmbPack.patch.website !== 'N/A') {
          urlToSave = gmbPack.patch.website;
        }
        if (gmbPack.patch) await autosaveEnhancement(gmbPack.patch, 'Outscraper GMB');
        console.log(
          `[ENHANCE] Outscraper GMB for ${workingLead.title}: ${gmbPack.place ? 'place found' : 'no place'}, ${gmbPack.snippets?.length || 0} quote(s)`,
        );
      }
    } catch (e) {
      console.warn('[ENHANCE] Outscraper GMB failed:', e.message);
    }
  }

  // Step 1.25: Outscraper Contacts & Leads — emails, phones, socials from domain
  if (outscraper.isConfigured(integrationEnv) && outscraperLeadEnrich.leadNeedsOutscraperContacts(workingLead)) {
    try {
      const contactsPack = await outscraperLeadEnrich.enrichLeadFromOutscraperContacts(
        workingLead,
        integrationEnv,
      );
      if (contactsPack && contactsPack.used) {
        outscraperContactsUsed = true;
        deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(
          contactsPack.extract || {},
          deepData || {},
        );
        if (contactsPack.patch && Object.keys(contactsPack.patch).length) {
          await autosaveEnhancement(contactsPack.patch, 'Outscraper contacts');
          Object.assign(workingLead, contactsPack.patch);
        }
        console.log(
          `[ENHANCE] Outscraper contacts for ${workingLead.title}: ${Object.keys(contactsPack.patch || {}).join(', ') || 'extract only'}`,
        );
      }
    } catch (e) {
      console.warn('[ENHANCE] Outscraper contacts failed:', e.message);
    }
  }

  const websiteForEnrich =
    (workingLead.website && workingLead.website !== 'N/A' ? workingLead.website : null) ||
    urlToSave ||
    null;
  const enrichLead = websiteForEnrich ? { ...workingLead, website: websiteForEnrich } : workingLead;

  // Step 1.5: Monid — Apollo / PDL company enrich (phone, website, socials)
  if (monidLeadEnrich.isConfigured(integrationEnv)) {
    try {
      const monidPack = await monidLeadEnrich.enrichLeadFromMonid(workingLead, integrationEnv);
      if (monidPack && monidPack.enriched && monidPack.extract) {
        monidUsed = true;
        deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(monidPack.extract, deepData || {});
        if (
          monidPack.extract.website &&
          (!workingLead.website || workingLead.website === 'N/A')
        ) {
          urlToSave = urlToSave || monidPack.extract.website;
        }
        console.log(
          `[ENHANCE] Monid (${monidPack.provider || 'gateway'}) for ${workingLead.title}: ${Object.keys(monidPack.extract).join(', ')}`,
        );
      }
    } catch (e) {
      console.warn('[ENHANCE] Monid failed:', e.message);
    }
  }

  // Step 2: BetterContact — contacts / socials (uses domain from GMB when available)
  let bcExtract = null;
  if (betterContact.isConfigured(integrationEnv)) {
    try {
      const bcPack = await betterContact.enrichLeadForBusiness(enrichLead, integrationEnv);
      if (bcPack && bcPack.extract && betterContact.extractHasSignal(bcPack.extract)) {
        bcExtract = bcPack.extract;
        betterContactUsed = true;
        deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(deepData || {}, bcExtract);
      }
    } catch (e) {
      console.warn('[ENHANCE] BetterContact failed:', e.message);
    }
  }

  // Step 3: Firecrawl — website scrape or search for extra socials / audit signals
  if (websiteForEnrich) {
    console.log(`[ENHANCE] Website scrape for ${workingLead.title} (${websiteForEnrich})...`);
    const pack = await webEnrichment.enrichLeadSmartWithMapsFallback(websiteForEnrich, leadProfile, {
      integrationEnv,
      skipMapsFallback: outscraperUsed,
    });
    deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(pack.merged, deepData || {});
    if (!outscraperUsed) {
      mapsFallbackUsed = pack.mapsUsed;
      if (pack.mapsPlace) mapsPlace = pack.mapsPlace;
    }
  } else {
    console.log(`[ENHANCE] Website missing. Firecrawl search for ${workingLead.title}...`);
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
      !outscraperUsed &&
      (!mapsEnrichFallback.extractHasContactSignal(searchExtract) ||
        missingCoreContact ||
        !firecrawlFoundUrl)
    ) {
      const pack = await mapsEnrichFallback.enrichFromMapsForLead(workingLead, integrationEnv);
      if (pack) {
        searchExtract = mapsEnrichFallback.mergeExtractPreferFirecrawl(searchExtract, pack.extract);
        websiteHint = pack.websiteHint;
        mapsFallbackUsed = true;
        if (pack.place) mapsPlace = pack.place;
      }
    }
    deepData = mapsEnrichFallback.mergeExtractPreferFirecrawl(searchExtract, deepData || {});
    if (!workingLead.website || workingLead.website === 'N/A') {
      urlToSave = urlToSave || websiteHint || firecrawlFoundUrl || null;
    }
  }

  const hadExtract = deepData && Object.keys(deepData).length > 0;
  if (hadExtract) {
    deepData = sanitizeExtractSocials(deepData);
    const enrichUpdates = firecrawlExtractToLeadUpdates(deepData);
    Object.assign(patch, enrichUpdates);

    if ((!workingLead.email || workingLead.email === 'N/A') && deepData.email) patch.email = deepData.email;
    if ((!workingLead.facebook || workingLead.facebook === 'N/A') && deepData.facebook) patch.facebook = deepData.facebook;
    if ((!workingLead.instagram || workingLead.instagram === 'N/A') && deepData.instagram) patch.instagram = deepData.instagram;
    if ((!workingLead.twitter || workingLead.twitter === 'N/A') && deepData.twitter) patch.twitter = deepData.twitter;
    if (!workingLead.linkedin && deepData.linkedin) patch.linkedin = deepData.linkedin;
    if (!workingLead.decisionMakerName && deepData.decision_maker_name) {
      patch.decisionMakerName = deepData.decision_maker_name;
    }
    if (!workingLead.decisionMakerTitle && deepData.decision_maker_title) {
      patch.decisionMakerTitle = deepData.decision_maker_title;
    }

    if (workingLead.phone && workingLead.phone !== 'N/A') delete patch.phone;
    if (workingLead.address && workingLead.address !== 'N/A') delete patch.address;
    if (workingLead.email && workingLead.email !== 'N/A') delete patch.email;

    await autosaveEnhancement(patch, 'contacts & socials');
  }

  if ((!workingLead.website || workingLead.website === 'N/A') && urlToSave) {
    patch.website = urlToSave;
    await autosaveEnhancement({ website: urlToSave }, 'website');
  }

  // Step 4: OpenRouter review summary (Outscraper data already fetched in step 1)
  let reviewHuntUsed = false;
  let reviewHuntMeta = null;
  try {
    const reviewPack = await reviewHunt.runReviewHuntForLead(
      { ...workingLead, ...patch },
      integrationEnv,
      { mapsPlace, gmbPack, skipGmbFetch: true }
    );
    if (reviewPack) {
      reviewHuntMeta = {
        outscraperConfigured: !!reviewPack.outscraperConfigured,
        reviewsFetched: !!reviewPack.reviewsFetched,
        reviewError: reviewPack.reviewError || null,
        reviewQuery: reviewPack.reviewQuery || null,
        reviewsCount: reviewPack.patch?.reviewsCount ?? null,
        snippetCount: Array.isArray(reviewPack.patch?.reviewSnippets)
          ? reviewPack.patch.reviewSnippets.length
          : 0,
      };
    }
    if (reviewPack && reviewPack.used && reviewPack.patch) {
      reviewHuntUsed = true;
      Object.assign(patch, reviewPack.patch);
      await autosaveEnhancement(reviewPack.patch, 'reviews & AI summary');
      if (reviewPack.mapsPlace) mapsPlace = reviewPack.mapsPlace;
    }
  } catch (e) {
    reviewHuntMeta = { reviewError: e.message || 'Review hunt failed' };
    console.warn('[ENHANCE] Review hunt failed:', e.message);
  }

  patch.lastContactHuntAt = new Date().toISOString();

  const enrichmentHappened =
    hadExtract ||
    urlToSave ||
    mapsFallbackUsed ||
    betterContactUsed ||
    monidUsed ||
    outscraperUsed ||
    outscraperContactsUsed ||
    reviewHuntUsed;

  if (enrichmentHappened) {
    const via = [
      outscraperUsed ? 'Outscraper GMB' : null,
      outscraperContactsUsed ? 'Outscraper contacts' : null,
      monidUsed ? 'Monid' : null,
      betterContactUsed ? 'BetterContact' : null,
      firecrawlViaSearch ? 'web search' : null,
      !firecrawlViaSearch && websiteForEnrich && hadExtract ? 'website' : null,
      mapsFallbackUsed ? 'Maps backup' : null,
      reviewHuntUsed ? 'review summary' : null,
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

  if (enrichmentHappened) {
    if (hasNewUpdates) patch.updates = baseUpdates;
    const finalPatch = {};
    for (const [k, v] of Object.entries(patch)) {
      if (persistedKeys.has(k) && k !== 'updates' && k !== 'lastContactHuntAt') continue;
      finalPatch[k] = v;
    }
    if (!finalPatch.lastContactHuntAt) finalPatch.lastContactHuntAt = patch.lastContactHuntAt;
    if (hasNewUpdates && !finalPatch.updates) finalPatch.updates = baseUpdates;
    let updatedLead = workingLead;
    if (Object.keys(finalPatch).length) {
      updatedLead = (await dbService.updateLead(fullKey, finalPatch, leadWorkspaceId)) || workingLead;
    }
    const result = { success: true, lead: updatedLead };
    if (reviewHuntMeta) result.reviewHunt = reviewHuntMeta;
    return result;
  }

  patch.lastContactHuntAt = new Date().toISOString();
  await autosaveEnhancement({ lastContactHuntAt: patch.lastContactHuntAt }, 'hunt timestamp');

  const fail = {
    success: false,
    error: betterContact.isConfigured(integrationEnv) ||
      monidLeadEnrich.isConfigured(integrationEnv) ||
      outscraper.isConfigured(integrationEnv)
      ? 'No new contact or review data discovered yet. Monid, Outscraper GMB, BetterContact, and website search did not find new signals.'
      : 'No new contact or review data discovered yet. Add Outscraper (GMB + reviews) and/or BetterContact under Workspace → API integrations.',
    lead: { ...workingLead, lastContactHuntAt: patch.lastContactHuntAt },
  };
  if (reviewHuntMeta) fail.reviewHunt = reviewHuntMeta;
  return fail;
}

/**
 * TikHub-only social profile discovery (Instagram, TikTok, X).
 */
async function runSocialEnrichment(lead, workspaceId) {
  if (!lead || !lead.key) return { success: false, error: 'Lead not found.' };
  const fullKey = lead.key.startsWith('lead:') ? lead.key : `lead:${lead.key}`;
  const leadWorkspaceId = (lead && lead.workspaceId) || workspaceId;
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(leadWorkspaceId);

  if (!tikHub.isConfigured(integrationEnv)) {
    return {
      success: false,
      error: 'TikHub is not configured. Add your API key under Workspace → Integrations → TikHub.',
    };
  }

  let pack;
  try {
    pack = await tikHub.enrichLeadSocialProfiles(lead, integrationEnv);
  } catch (e) {
    return { success: false, error: e.message || 'Social search failed.' };
  }

  if (pack.skipped) {
    return {
      success: true,
      skipped: true,
      message: pack.message,
      lead,
      socialsFound: [],
    };
  }

  const extract = sanitizeExtractSocials(pack.extract || {});
  if (!tikHub.extractHasSignal(extract)) {
    return {
      success: false,
      error: pack.message || 'No matching social profiles found for this business.',
      lead,
      socialsFound: [],
      errors: pack.errors || [],
    };
  }

  const patch = firecrawlExtractToLeadUpdates(extract);
  if ((!lead.instagram || lead.instagram === 'N/A') && extract.instagram) patch.instagram = extract.instagram;
  if ((!lead.tiktok || lead.tiktok === 'N/A') && extract.tiktok) patch.tiktok = extract.tiktok;
  if ((!lead.twitter || lead.twitter === 'N/A') && extract.twitter) patch.twitter = extract.twitter;
  if ((!lead.facebook || lead.facebook === 'N/A') && extract.facebook) patch.facebook = extract.facebook;
  if (!lead.linkedin && extract.linkedin) patch.linkedin = extract.linkedin;

  const updates = [...(lead.updates || [])];
  updates.push({
    type: 'social_enrichment',
    value: `Social profiles found via TikHub (${(pack.platforms || []).join(', ') || 'updated'}).`,
    timestamp: new Date().toISOString(),
  });
  patch.updates = updates;
  patch.lastSocialEnrichAt = new Date().toISOString();

  const updatedLead = (await dbService.updateLead(fullKey, patch, leadWorkspaceId)) || { ...lead, ...patch };
  return {
    success: true,
    lead: updatedLead,
    socialsFound: pack.platforms || [],
    message: pack.message,
  };
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

// GET /leads/:key/enhance-status — poll background contact hunt
router.get('/:key/enhance-status', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ status: 'idle', success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ status: 'idle', success: false, error: 'Forbidden' });
    }

    const job = contactHuntJobs.get(fullKey);
    if (!job) {
      return res.json({ status: 'idle' });
    }
    if (job.status === 'processing') {
      return res.json({ status: 'processing', startedAt: job.startedAt });
    }
    if (job.status === 'error') {
      const errMsg = job.error || 'Contact hunt failed.';
      contactHuntJobs.clear(fullKey);
      return res.json({ status: 'error', success: false, error: errMsg });
    }

    const result = job.result || { success: false, error: 'Contact hunt finished with no result.' };
    contactHuntJobs.clear(fullKey);
    return res.json({ status: 'done', ...result });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:key/enrich-rapidapi-website — RapidAPI website scrape for contacts & socials (sync)
router.post('/:key/enrich-rapidapi-website', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!rapidapiWebsiteEnrich.isConfigured(integrationEnv)) {
      return res.status(422).json({
        success: false,
        error:
          'RapidAPI website enrich is not configured. Add endpoint + host under Workspace → Integrations → RapidAPI Website.',
      });
    }
    if (!rapidapiWebsiteEnrich.leadCanEnrichFromWebsite(lead)) {
      return res.status(422).json({
        success: false,
        error: 'Lead needs a website URL before RapidAPI can scrape contacts and socials.',
      });
    }

    const pack = await rapidapiWebsiteEnrich.enrichLeadFromWebsite(lead, integrationEnv, {
      mode: 'refresh',
    });
    if (pack.error && pack.error !== 'no_new_fields' && pack.error !== 'no_contacts') {
      const status = pack.error === 'not_configured' ? 422 : 502;
      return res.status(status).json({
        success: false,
        error:
          pack.error === 'no_website'
            ? 'Lead needs a website URL.'
            : pack.error || 'RapidAPI website enrich failed.',
      });
    }

    const stamp = new Date().toISOString();
    const patch = {
      ...(pack.patch || {}),
      lastRapidapiWebsiteEnrichAt: stamp,
    };
    let updated = lead;
    if (Object.keys(pack.patch || {}).length) {
      updated = await dbService.updateLead(fullKey, patch, req.workspaceId);
    } else {
      await dbService.updateLead(fullKey, { lastRapidapiWebsiteEnrichAt: stamp }, req.workspaceId);
      updated = { ...lead, lastRapidapiWebsiteEnrichAt: stamp };
    }

    return res.json({
      success: true,
      lead: updated,
      filled: pack.filled || [],
      sources: ['RapidAPI Website'],
      message:
        pack.filled && pack.filled.length
          ? `Updated ${pack.filled.join(', ')} from website.`
          : pack.extract && Object.keys(pack.extract).length
            ? 'Scrape found contacts — already up to date.'
            : 'Scrape returned no contacts on this website.',
    });
  } catch (err) {
    console.error('RapidAPI website enrich error:', err.message);
    return res.status(502).json({
      success: false,
      error: err.message || 'RapidAPI website enrich failed.',
    });
  }
});

// POST /leads/:key/enrich-socials — TikHub Instagram / TikTok / X profile search (sync)
router.post('/:key/enrich-socials', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const result = await runSocialEnrichment(lead, req.workspaceId);
    if (result.success) {
      return res.json(result);
    }
    return res.status(result.skipped ? 200 : 422).json(result);
  } catch (err) {
    console.error('Social enrichment error:', err.message);
    next(err);
  }
});

// POST /leads/:key/enhance — Firecrawl scrape/search + Maps (Outscraper/Apify) fallback (async)
router.post('/:key/enhance', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const existing = contactHuntJobs.get(fullKey);
    if (existing && existing.status === 'processing') {
      return res.json({
        success: true,
        processing: true,
        message: 'Contact hunt already in progress.',
      });
    }

    contactHuntJobs.start(fullKey);
    res.json({
      success: true,
      processing: true,
      message: 'Deep hunt started. Contacts, Google reviews, and AI summary may take up to 90 seconds.',
    });

    setImmediate(async () => {
      try {
        const freshLead = await dbService.getLead(fullKey);
        if (!freshLead) {
          contactHuntJobs.finish(fullKey, { success: false, error: 'Lead not found.' });
          return;
        }
        const result = await runLeadEnhancement(freshLead, req.workspaceId);
        if (result && result.success) {
          const refreshed = await dbService.getLead(fullKey);
          const contactedPatch = await buildContactedStagePatch(refreshed || freshLead, req.workspaceId);
          if (Object.keys(contactedPatch).length) {
            await dbService.updateLead(fullKey, contactedPatch);
            if (result.lead) {
              result.lead = { ...result.lead, ...contactedPatch };
            }
          }
        }
        contactHuntJobs.finish(fullKey, result);
      } catch (err) {
        console.error('Manual enhancement error:', err.message);
        contactHuntJobs.fail(fullKey, err.message || 'Contact hunt failed.');
      }
    });
  } catch (err) {
    console.error('Manual enhancement start error:', err.message);
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

/** POST /leads/:key/geo-seo-ghl-audit — GEO/SEO report + GHL tool sell recommendations (OpenRouter) */
router.post('/:key/geo-seo-ghl-audit', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const refresh = !!(req.body && req.body.refresh);
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (
      !refresh &&
      lead.geoSeoGhlAudit &&
      typeof lead.geoSeoGhlAudit === 'object' &&
      lead.geoSeoGhlAuditAt
    ) {
      const age = Date.now() - new Date(lead.geoSeoGhlAuditAt).getTime();
      if (age >= 0 && age < maxAgeMs) {
        return res.json({
          success: true,
          cached: true,
          report: lead.geoSeoGhlAudit,
          lead,
        });
      }
    }

    const website = String(
      (req.body && req.body.website) || lead.website || lead.url || '',
    ).trim();
    if (!website || website === 'N/A') {
      return res.status(400).json({ success: false, error: 'Add a website URL to this lead first.' });
    }

    const geoSeoGhlAudit = require('../services/geoSeoGhlAudit');
    let analysis = lead.aiWebsiteAnalysis;
    let ownerSignal = lead.ownerSignal || '';

    try {
      const fresh = await websiteAiAnalysis.analyzeWebsite(website);
      if (fresh) {
        analysis = websiteAiAnalysis.mergePriorAuditSnapshot(fresh, analysis || null);
        ownerSignal = websiteAiAnalysis.buildOwnerSignal(lead, analysis) || ownerSignal;
      }
    } catch (crawlErr) {
      console.warn('[geo-seo-ghl-audit] website crawl failed:', crawlErr.message);
    }

    const intelLead = {
      ...lead,
      website: website !== 'N/A' ? website : lead.website,
      aiWebsiteAnalysis: analysis || lead.aiWebsiteAnalysis,
      ownerSignal,
    };

    const report = await geoSeoGhlAudit.generateGeoSeoGhlReport(intelLead);
    const patch = {
      geoSeoGhlAudit: report,
      geoSeoGhlAuditAt: new Date().toISOString(),
      ownerSignal,
    };
    if (analysis) {
      patch.aiWebsiteAnalysis = analysis;
      patch.aiWebsiteAnalysisScore = Number(analysis.analysisScore || 0);
      patch.aiWebsiteAnalysisUpdatedAt = new Date().toISOString();
    }
    if (report.agencyOffer && report.agencyOffer.primaryServiceKey) {
      patch.primaryServiceKey = report.agencyOffer.primaryServiceKey;
    }

    const updatedLead = await dbService.updateLead(fullKey, patch, req.workspaceId);
    return res.json({
      success: true,
      cached: false,
      report,
      model: report.model || null,
      provider: report.provider || null,
      lead: updatedLead,
    });
  } catch (err) {
    console.error('[geo-seo-ghl-audit] error:', err);
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : 'GEO/SEO audit failed',
    });
  }
});

/** POST /leads/:key/ai-readiness — AI Readiness Assessment (inline score + CTA for full $1k report) */
router.post('/:key/ai-readiness', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const aiReadiness = require('../services/aiReadinessAssessment');
    const enrichmentData = {
      hasSchemaMarkup: req.body && req.body.hasSchemaMarkup !== undefined ? req.body.hasSchemaMarkup : undefined,
      hasChatbot: req.body && req.body.hasChatbot !== undefined ? req.body.hasChatbot : undefined,
      hasClickToCall: req.body && req.body.hasClickToCall !== undefined ? req.body.hasClickToCall : undefined,
      isOutdated: req.body && req.body.isOutdated !== undefined ? req.body.isOutdated : undefined,
    };

    const assessment = await aiReadiness.assessLead(lead, enrichmentData);
    if (!assessment) {
      return res.status(502).json({ success: false, error: 'AI assessment unavailable. Try again in a moment.' });
    }

    // Persist the score on the lead record
    const patch = {
      aiReadinessScore: assessment.overallScore,
      aiReadinessGrade: assessment.grade,
      aiReadinessAssessedAt: new Date().toISOString(),
    };
    await dbService.updateLead(fullKey, patch, req.workspaceId);

    return res.json({ success: true, assessment });
  } catch (err) {
    console.error('[ai-readiness] error:', err);
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Assessment failed' });
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
    const apiKey = pageSpeedInsights.resolvePageSpeedApiKey(integrationEnv);

    const strategy =
      req.body && String(req.body.strategy || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile';

    const websiteFromBody =
      req.body && req.body.website != null ? String(req.body.website).trim() : '';
    const websiteRaw = websiteFromBody || lead.website || lead.url || '';
    const websiteNorm = pageSpeedInsights.normalizeWebsiteUrl(websiteRaw);

    const { audit } = await pageSpeedInsights.runPageSpeedAudit(websiteNorm || websiteRaw, {
      apiKey,
      strategy,
    });

    const ownerSignal = pageSpeedInsights.buildOwnerSignalFromAudit(lead.title, audit);
    const leadPatch = {
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
    };
    if (websiteNorm && websiteNorm !== String(lead.website || '').trim()) {
      leadPatch.website = websiteNorm;
    }
    const updated = await dbService.updateLead(fullKey, leadPatch, req.workspaceId);

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
    const ws = await dbService.getWorkspace(req.workspaceId);
    const links = buildAuditReportUrl({ lead, workspaceId: req.workspaceId, req, workspace: ws });
    if (!links.ok) {
      return res.status(400).json({ success: false, error: links.error });
    }
    const company = String(lead.title || 'your team').trim() || 'your team';
    const followUpSubject = 'Your audit, attached — plus the 3 fixes we discussed.';
    const followUpBody =
      links.followUpEmail?.body ||
      `Hi ${company},\n\nGreat speaking with you. Here is your audit link:\n${links.reportUrl}\n\nBest,\n`;
    return res.json({
      success: true,
      reportUrl: links.reportUrl,
      auditPageUrl: links.auditPageUrl || links.reportUrl,
      hostedReportUrl: links.hostedReportUrl || null,
      pdfUrl: links.pdfUrl || null,
      landingEnabled: !!links.landingEnabled,
      followUpEmail: { subject: followUpSubject, body: followUpBody },
      smsSnippet: links.smsSnippet || `Open your audit: ${links.reportUrl}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Link failed' });
  }
});

/** Session-auth GBP audit for the lead panel "Run Website Audit" button */
router.post('/:key/gbp-audit', async (req, res, next) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const { scoreGBP } = require('../routes/audit');
    const mapsSearch = require('../services/mapsSearch');
    const workspaceIntegrations = require('../services/workspaceIntegrations');
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);

    if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).json({ success: false, error: 'Maps search not configured.' });
    }

    const businessName = String(req.body.businessName || lead.title || '').trim();
    const city = String(req.body.city || lead.city || '').trim();
    const state = String(req.body.state || lead.state || '').trim();
    if (!businessName || !city || !state) {
      return res.status(400).json({ success: false, error: 'businessName, city, state are required.' });
    }

    // Search for the target business
    const targetResults = await mapsSearch.searchGoogleMaps({
      keyword: businessName, city, state, maxResults: 5, integrationEnv,
    });
    const target = targetResults.find(r =>
      r.title.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(r.title.toLowerCase())
    ) || targetResults[0];

    if (!target) {
      return res.status(404).json({ success: false, error: `Could not find "${businessName}" in ${city}, ${state}.` });
    }

    // Search for competitors
    const competitorQuery = target.categoryName && target.categoryName !== 'N/A' ? target.categoryName : businessName.split(' ')[0];
    const competitorResults = await mapsSearch.searchGoogleMaps({
      keyword: `${competitorQuery} ${city}`, city, state, maxResults: 10, integrationEnv,
    });
    const competitors = competitorResults
      .filter(c => c.placeId !== target.placeId && c.title.toLowerCase() !== target.title.toLowerCase())
      .slice(0, 5);

    const gbpAudit = scoreGBP(target, competitors);

    // Save audit data to lead
    await dbService.updateLead(fullKey, {
      gbpAudit,
      gbpAuditAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      audit: {
        business: {
          title: target.title, phone: target.phone, website: target.website,
          address: target.address, city: target.city, state: target.state,
          categoryName: target.categoryName, rating: target.totalScore,
          reviewsCount: target.reviewsCount, mapsUrl: target.url,
        },
        ...gbpAudit,
        competitors: competitors.map(c => ({
          title: c.title, rating: c.totalScore, reviewsCount: c.reviewsCount,
          website: c.website, categoryName: c.categoryName,
        })),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Generate AI Tools Assessment deck content from lead + audit data. */
router.post('/:key/ai-tools-assessment/generate', express.json(), async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const assessment = await generateAssessment(lead);
    const wsAccent = req.workspace && req.workspace.accentColor ? req.workspace.accentColor : null;
    if (wsAccent) assessment.accent = wsAccent;
    const updated = await dbService.updateLead(
      fullKey,
      {
        aiToolsAssessment: assessment,
        aiToolsAssessmentUpdatedAt: new Date().toISOString(),
      },
      req.workspaceId,
    );
    return res.json({ success: true, assessment, lead: updated || { key: fullKey, aiToolsAssessment: assessment } });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : 'Assessment generation failed',
    });
  }
});

/** Save edited assessment fields from preview mode. */
router.post('/:key/ai-tools-assessment', express.json(), async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const patch = req.body && req.body.assessment;
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ success: false, error: 'Assessment payload required.' });
    }
    const merged = mergeAssessment(lead.aiToolsAssessment, patch);
    merged.clientName = merged.clientName || String(lead.title || '').trim();
    const updated = await dbService.updateLead(
      fullKey,
      {
        aiToolsAssessment: merged,
        aiToolsAssessmentUpdatedAt: new Date().toISOString(),
      },
      req.workspaceId,
    );
    return res.json({ success: true, assessment: merged, lead: updated || { key: fullKey, aiToolsAssessment: merged } });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : 'Save failed',
    });
  }
});

/** Signed public URL for hosted AI Tools Assessment deck. */
router.post('/:key/ai-tools-report-link', express.json(), async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!lead.aiToolsAssessment || typeof lead.aiToolsAssessment !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Generate the AI Tools Assessment first.',
      });
    }
    const token = createAuditReportToken({
      leadKey: fullKey,
      workspaceId: req.workspaceId,
      type: 'ai_tools',
    });
    const base = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
    const reportUrl = `${base}/ai-tools/report/${token}`;
    const pdfUrl = `${base}/ai-tools/report/${encodeURIComponent(token)}/download.pdf`;
    const vm = buildAiToolsReportViewModel(lead, lead.aiToolsAssessment, { baseUrl: base, reportUrl });
    return res.json({
      success: true,
      reportUrl,
      pdfUrl,
      followUpEmail: vm.followUpEmail,
      smsSnippet: vm.smsSnippet,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Link failed' });
  }
});

/** Authenticated editable preview (save back via POST /ai-tools-assessment). */
router.get('/:key/ai-tools-assessment/preview', async (req, res) => {
  try {
    const key = req.params.key;
    const fullKey = key.startsWith('lead:') ? key : `lead:${key}`;
    const lead = await dbService.getLead(fullKey);
    if (!lead) return res.status(404).send('Lead not found.');
    if (String(lead.workspaceId || '') !== String(req.workspaceId || '')) {
      return res.status(403).send('Forbidden');
    }
    let assessment = lead.aiToolsAssessment;
    if (!assessment || typeof assessment !== 'object') {
      assessment = normalizeAssessment(null, lead);
    }
    const base = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
    const workspaceAccent = (req.workspace && req.workspace.accentColor) || null;
    const vm = buildAiToolsReportViewModel(lead, assessment, { baseUrl: base, workspaceAccent });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('ai_tools_report', {
      vm,
      printMode: false,
      editMode: true,
      token: null,
      leadKey: fullKey,
      pdfHref: '',
      reportUrl: '',
      followUpEmail: vm.followUpEmail,
    });
  } catch (err) {
    console.error('[ai-tools-preview]', err);
    return res.status(500).send('Could not load preview.');
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

// ── Real Estate Leads Import ──────────────────────────────────────────────────

const fsSync = require('fs');

// GET /leads/import-real-estate — import mobile home listings from JSON to pipeline
router.get('/import-real-estate', async (req, res, next) => {
  try {
    const jsonPath = path.resolve(__dirname, '..', 'leads-real-estate', 'all-listings-master.json');
    if (!fsSync.existsSync(jsonPath)) {
      return res.json({ success: false, error: 'No listings file found. Run the scraper first.' });
    }

    const listings = JSON.parse(fsSync.readFileSync(jsonPath, 'utf8'));
    if (!Array.isArray(listings) || listings.length === 0) {
      return res.json({ success: false, error: 'Listings file is empty.' });
    }

    const imported = [];
    const skipped = [];
    let created = 0, updated = 0;

    for (const item of listings) {
      // Skip listings already marked as imported
      if (item._imported) {
        skipped.push(item.url);
        continue;
      }

      const title = `${item.source === 'craigslist' ? 'CL' : 'FB'}: ${item.title || 'Mobile Home Listing'}`;
      const location = (item.location || '').trim();
      const cityState = location.split(',').map(s => s.trim());
      const city = cityState[0] || '';
      const state = cityState[1] || '';
      const address = location || 'N/A';

      const leadData = {
        title,
        phone: 'N/A',
        website: item.url || 'N/A',
        email: 'N/A',
        categoryName: 'Real Estate - Mobile Home',
        address,
        city,
        state,
        totalScore: 0,
        reviewsCount: 0,
        url: item.url || '',
        status: 'Lead Captured',
        source: item.source === 'facebook' ? 'facebook marketplace' : 'craigslist',
        jobType: 'real_estate',
        sourceType: 'real_estate',
        folderKey: 'real-estate',
        workspaceId: req.workspaceId,
        pipelineStage: 1,
        updates: [{
          type: 'note',
          value: [
            `Price: ${item.price_str || '$?'}`,
            `Beds: ${item.beds || '?'} | Baths: ${item.baths || '?'}`,
            item.cross_listed ? `Cross-listed on both platforms (CL: ${item.url}, FB: ${item.fb_url})` : '',
            `Scraped: ${item.date || 'unknown'}`,
            item.title ? `Original title: ${item.title}` : '',
          ].filter(Boolean).join('\n'),
          timestamp: new Date().toISOString(),
        }],
      };

      try {
        const key = await dbService.saveLead(leadData);
        if (key) {
          item._imported = true;
          item._leadKey = key;
          created += 1;
          imported.push({ url: item.url, key });
        }
      } catch (e) {
        console.error('[import-real-estate] save error:', e.message);
        skipped.push(item.url);
      }
    }

    // Update the JSON with _imported flags
    fsSync.writeFileSync(jsonPath, JSON.stringify(listings, null, 2));

    res.json({
      success: true,
      created,
      updated,
      skipped: skipped.length,
      total: listings.length,
      imported: imported.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /leads/import-real-estate — reimport all (clear _imported flags first)
router.post('/import-real-estate', async (req, res, next) => {
  try {
    const jsonPath = path.resolve(__dirname, '..', 'leads-real-estate', 'all-listings-master.json');
    if (!fs.existsSync(jsonPath)) {
      return res.json({ success: false, error: 'No listings file found.' });
    }

    const listings = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const force = req.body && (req.body.force === 'true' || req.body.force === true);
    
    if (force) {
      // Clear _imported flags to reimport everything
      for (const item of listings) {
        delete item._imported;
        delete item._leadKey;
      }
      fsSync.writeFileSync(jsonPath, JSON.stringify(listings, null, 2));
    }

    // Redirect to GET handler
    res.redirect(307, '/leads/import-real-estate');
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ── Omnichannel dashboard ────────────────────────────────────────────────────

router.get('/omnichannel', async (req, res) => {
  res.render('omnichannel');
});
