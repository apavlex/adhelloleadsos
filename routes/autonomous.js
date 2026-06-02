/**
 * Autonomous Prospecting API
 * 
 * API-key-authenticated endpoints for Pavlex/Hermes to run prospecting
 * without browser login. Trigger searches, save leads, export to Drive.
 *
 * Auth: x-api-key header or ?api_key= query param
 *       (uses API_INGEST_KEY env var, same as /api routes)
 */

const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const mapsSearch = require('../services/mapsSearch');
const enricher = require('../services/enricher');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { uploadCsvToDrive, safeDriveFileName } = require('../services/googleDriveUpload');
const { getValidAccessToken } = require('../services/googleDriveAccess');
const { autoAttachCadenceIfNeeded } = require('../services/leadCadence');
const { clampPipelineStage } = require('../services/pipelineConstants');
const { parseImportFile } = require('../services/csvLeadImport');
const { recommendCadenceTemplate } = require('../services/leadCadence');
const sequenceEngine = require('../services/sequenceEngine');
const pipelineStagesService = require('../services/pipelineStagesService');

// ── Auth ──────────────────────────────────────────────────────────────────────

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  const expected = process.env.API_INGEST_KEY || 'adhello_secret_123';
  if (!key || key !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

function workspaceId(req) {
  return String(req.headers['x-workspace-id'] || req.query.workspaceId || 'default').trim() || 'default';
}

// ── 1. SEARCH — trigger a Google Maps lead search ────────────────────────────

/**
 * POST /autonomous/search
 * Body: { keyword, city, state, maxResults, workspaceId }
 * Returns immediately with a searchId; search runs in background.
 */
router.post('/search', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const keyword = String(req.body.keyword || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const maxResults = Math.min(parseInt(req.body.maxResults, 10) || 20, 100);

    if (!keyword || !city || !state) {
      return res.status(400).json({ success: false, error: 'keyword, city, state are required.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    console.log(`[AUTONOMOUS-SEARCH] wid=${wid}, RAPIDAPI_KEY=${integrationEnv.RAPIDAPI_KEY ? 'SET' : 'EMPTY'}, APIFY_API_TOKEN=${integrationEnv.APIFY_API_TOKEN ? 'SET' : 'EMPTY'}, mapsConfigured=${mapsSearch.isMapsSearchConfigured(integrationEnv)}`);
    if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'Maps search not configured. Set RAPIDAPI_KEY / SEARCHAPI_API_KEY / SERPAPI_API_KEY / OUTSCRAPER_API_KEY / APIFY_API_TOKEN.',
      });
    }

    const searchId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Run in background — don't block the HTTP response
    setImmediate(async () => {
      try {
        console.log(`[AUTONOMOUS] Search ${searchId}: "${keyword}" in ${city}, ${state}`);
        let results = await mapsSearch.searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv });
        if (!results || results.length === 0) {
          console.log(`[AUTONOMOUS] Search ${searchId}: no results`);
          // Save empty result so poll endpoint can report "complete with 0 results"
          await dbService.saveSearch({
            keyword, city, state, maxResults,
            resultCount: 0, results: [],
            timestamp: new Date().toISOString(),
            workspaceId: wid, source: 'autonomous', searchId,
            status: 'complete_empty',
          });
          return;
        }
        results = await enricher.enrichLeads(results, { workspaceId: wid });
        const searchRecord = {
          keyword, city, state, maxResults,
          resultCount: results.length,
          results,
          timestamp: new Date().toISOString(),
          workspaceId: wid,
          source: 'autonomous',
          searchId,
        };
        const searchKey = await dbService.saveSearch(searchRecord);
        console.log(`[AUTONOMOUS] Search ${searchId}: saved ${results.length} leads as ${searchKey}`);
      } catch (err) {
        console.error(`[AUTONOMOUS] Search ${searchId} failed:`, err.message);
        // Save error status so poll endpoint can report the failure
        try {
          await dbService.saveSearch({
            keyword, city, state, maxResults,
            resultCount: 0, results: [],
            timestamp: new Date().toISOString(),
            workspaceId: wid, source: 'autonomous', searchId,
            status: 'failed', error: err.message,
          });
        } catch (saveErr) {
          console.error(`[AUTONOMOUS] Could not save error status:`, saveErr.message);
        }
      }
    });

    res.json({ success: true, searchId, message: 'Search started. Poll /autonomous/search/:searchId for results.' });
  } catch (err) {
    next(err);
  }
});

// ── 2. SEARCH STATUS — poll for results ───────────────────────────────────────

/**
 * GET /autonomous/search/:searchId
 * Returns the search record if found.
 */
router.get('/search/:searchId', apiKeyAuth, async (req, res, next) => {
  try {
    const raw = req.params.searchId;
    const fullKey = raw.startsWith('search:') ? raw : `search:${raw}`;
    const data = await dbService.getSearch(fullKey);
    if (!data) {
      return res.json({ success: true, status: 'pending', message: 'Search still running or not found.' });
    }
    const response = {
      success: true,
      status: data.status === 'failed' ? 'failed' : data.status === 'complete_empty' ? 'complete' : 'complete',
      searchId: data.searchId || raw,
      keyword: data.keyword,
      city: data.city,
      state: data.state,
      resultCount: data.resultCount,
      results: data.results || [],
      timestamp: data.timestamp,
    };
    if (data.status === 'failed') {
      response.error = data.error || 'Unknown error';
      response.message = `Search failed: ${response.error}`;
    }
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ── 3. SAVE LEADS — bulk save leads from search results ──────────────────────

/**
 * POST /autonomous/save-leads
 * Body: { searchId, workspaceId? }
 * Saves all leads from a completed search into the workspace.
 */
router.post('/save-leads', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const searchId = String(req.body.searchId || '').trim();
    if (!searchId) {
      return res.status(400).json({ success: false, error: 'searchId is required.' });
    }

    const fullKey = searchId.startsWith('search:') ? searchId : `search:${searchId}`;
    const data = await dbService.getSearch(fullKey);
    if (!data || !data.results || data.results.length === 0) {
      return res.status(404).json({ success: false, error: 'Search not found or has no results.' });
    }

    const results = data.results;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const savedKeys = [];

    for (const leadData of results) {
      try {
        const toSave = {
          ...leadData,
          workspaceId: wid,
          source: leadData.source || 'autonomous',
          savedAt: new Date().toISOString(),
        };
        const key = await dbService.saveLead(toSave);
        savedKeys.push(key);
        // Check if it was an update or create
        if (leadData._existing) updated++;
        else created++;
        try { await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: wid }); } catch (_) { /* non-fatal */ }
      } catch (e) {
        console.error('[AUTONOMOUS] save-leads error:', e.message);
        failed++;
      }
    }

    res.json({
      success: true,
      saved: created + updated,
      created,
      updated,
      failed,
      keys: savedKeys,
    });
  } catch (err) {
    next(err);
  }
});

// ── 4. SAVE SINGLE LEAD ──────────────────────────────────────────────────────

/**
 * POST /autonomous/leads
 * Body: { title, phone?, website?, email?, city?, state?, address?, ... }
 */
router.post('/leads', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const title = String(req.body.title || '').trim();
    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required.' });
    }

    const leadData = {
      title,
      phone: req.body.phone || 'N/A',
      website: req.body.website || 'N/A',
      email: req.body.email || 'N/A',
      categoryName: req.body.categoryName || req.body.category || 'N/A',
      address: req.body.address || 'N/A',
      city: req.body.city || '',
      state: req.body.state || '',
      totalScore: parseFloat(req.body.totalScore) || 0,
      reviewsCount: parseInt(req.body.reviewsCount, 10) || 0,
      url: req.body.url || '',
      facebook: req.body.facebook || 'N/A',
      instagram: req.body.instagram || 'N/A',
      twitter: req.body.twitter || 'N/A',
      status: req.body.status || 'Not Contacted',
      source: req.body.source || 'autonomous',
      savedAt: new Date().toISOString(),
      workspaceId: wid,
    };

    if (req.body.note) {
      leadData.updates = [{ type: 'note', value: String(req.body.note), timestamp: new Date().toISOString() }];
    }

    const key = await dbService.saveLead(leadData);
    try { await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: wid }); } catch (_) { /* non-fatal */ }

    res.json({ success: true, key, title });
  } catch (err) {
    next(err);
  }
});

// ── 5. LIST LEADS ─────────────────────────────────────────────────────────────

/**
 * GET /autonomous/leads
 * Query: workspaceId?, pipelineStage?, status?, limit?, offset?
 */
router.get('/leads', apiKeyAuth, async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const all = await dbService.getAllLeads(wid);
    let leads = all;

    if (req.query.pipelineStage) {
      leads = leads.filter(l => (l.pipelineStage || 'new') === req.query.pipelineStage);
    }
    if (req.query.status) {
      leads = leads.filter(l => (l.status || '').toLowerCase() === req.query.status.toLowerCase());
    }
    if (req.query.source) {
      leads = leads.filter(l => (l.source || '') === req.query.source);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const paged = leads.slice(offset, offset + limit);

    res.json({
      success: true,
      total: leads.length,
      count: paged.length,
      leads: paged.map(l => ({
        key: l.key,
        title: l.title,
        phone: l.phone,
        website: l.website,
        email: l.email,
        city: l.city,
        state: l.state,
        status: l.status,
        pipelineStage: l.pipelineStage,
        source: l.source,
        savedAt: l.savedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── 6. EXPORT TO GOOGLE DRIVE ─────────────────────────────────────────────────

/**
 * POST /autonomous/export-drive
 * Body: { workspaceId?, searchId?, leadKeys?, fileName?, userEmail? }
 * Exports leads to Google Drive as CSV.
 * Requires Google Drive OAuth to have been connected by the user.
 */
router.post('/export-drive', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const userEmail = String(req.body.userEmail || req.headers['x-user-email'] || '').trim().toLowerCase();
    const fileName = safeDriveFileName(req.body.fileName || `Leads_${wid}_${new Date().toISOString().slice(0, 10)}`);

    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'userEmail is required for Drive export.' });
    }

    const accessToken = await getValidAccessToken(userEmail);
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Google Drive not connected. User must link Drive via the web app first.',
      });
    }

    // Gather leads to export
    let leads = [];
    if (req.body.leadKeys && Array.isArray(req.body.leadKeys) && req.body.leadKeys.length > 0) {
      // Export specific leads
      for (const k of req.body.leadKeys) {
        const lead = await dbService.getLead(String(k));
        if (lead) leads.push(lead);
      }
    } else if (req.body.searchId) {
      // Export from a saved search
      const fullKey = String(req.body.searchId).startsWith('search:') ? req.body.searchId : `search:${req.body.searchId}`;
      const data = await dbService.getSearch(fullKey);
      leads = (data && data.results) || [];
    } else {
      // Export all workspace leads
      leads = await dbService.getAllLeads(wid);
    }

    if (leads.length === 0) {
      return res.status(404).json({ success: false, error: 'No leads to export.' });
    }

    // Build CSV
    const headers = ['title', 'phone', 'website', 'email', 'categoryName', 'address', 'city', 'state', 'totalScore', 'reviewsCount', 'url', 'facebook', 'instagram', 'twitter', 'status', 'pipelineStage', 'source', 'savedAt'];
    const escape = (v) => {
      const s = String(v == null ? '' : v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csvRows = [headers.join(',')];
    for (const l of leads) {
      csvRows.push(headers.map(h => escape(l[h])).join(','));
    }
    const csv = csvRows.join('\n');

    const uploaded = await uploadCsvToDrive(accessToken, { name: fileName, content: csv });

    res.json({
      success: true,
      fileId: uploaded.id,
      fileName: uploaded.name,
      webViewLink: uploaded.webViewLink,
      exported: leads.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── 7. IMPORT CSV ─────────────────────────────────────────────────────────────

/**
 * POST /autonomous/import-csv
 * Body: { csvContent, fileName?, workspaceId?, leadSource? }
 * Parses CSV and saves leads.
 */
router.post('/import-csv', apiKeyAuth, express.json({ limit: '15mb' }), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const csvContent = String(req.body.csvContent || '');
    const fileName = String(req.body.fileName || 'import.csv');
    if (!csvContent) {
      return res.status(400).json({ success: false, error: 'csvContent is required.' });
    }

    const buffer = Buffer.from(csvContent, 'utf8');
    const parsed = parseImportFile(buffer, fileName, { leadSource: req.body.leadSource || 'autonomous' });
    const records = parsed.leads;

    let created = 0;
    let updated = 0;
    let failed = 0;
    const savedKeys = [];

    for (const rec of records) {
      if (!rec.title) { continue; }
      try {
        const key = await dbService.saveLead({ ...rec, workspaceId: wid });
        savedKeys.push(key);
        created++;
        try { await autoAttachCadenceIfNeeded({ leadKey: key, workspaceId: wid }); } catch (_) { /* non-fatal */ }
      } catch (e) {
        failed++;
      }
    }

    res.json({ success: true, created, updated, failed, keys: savedKeys });
  } catch (err) {
    next(err);
  }
});

// ── 8. STATUS / HEALTH ────────────────────────────────────────────────────────

/**
 * GET /autonomous/status
 * Quick health check + config status.
 */
router.get('/status', apiKeyAuth, async (req, res) => {
  const wid = workspaceId(req);
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid).catch(() => ({}));
  res.json({
    success: true,
    workspaceId: wid,
    mapsConfigured: mapsSearch.isMapsSearchConfigured(integrationEnv),
    timestamp: new Date().toISOString(),
  });
});

// ── 9. UPDATE LEAD PIPELINE STAGE ────────────────────────────────────────────

/**
 * PATCH /autonomous/leads/:leadKey/stage
 * Body: { pipelineStage (int), status? (string) }
 * Move a lead to a new pipeline stage.
 */
router.patch('/leads/:leadKey/stage', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const raw = req.params.leadKey;
    const key = raw.startsWith('lead:') ? raw : `lead:${raw}`;
    const lead = await dbService.getLead(key);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const stage = parseInt(req.body.pipelineStage, 10);
    if (!Number.isFinite(stage)) {
      return res.status(400).json({ success: false, error: 'pipelineStage (integer) is required.' });
    }

    const clamped = clampPipelineStage(stage);
    const updates = {
      pipelineStage: clamped,
      lastActivity: new Date().toISOString(),
      logs: [
        {
          type: 'stage_change',
          message: `Stage → ${clamped}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    if (req.body.status) {
      updates.status = req.body.status;
    }

    await dbService.updateLead(key, updates);
    res.json({ success: true, key, pipelineStage: clamped, status: updates.status || lead.status });
  } catch (err) {
    next(err);
  }
});

// ── 10. LIST PIPELINE STAGES ──────────────────────────────────────────────────

/**
 * GET /autonomous/pipeline-stages
 * Returns all pipeline stages for the workspace.
 */
router.get('/pipeline-stages', apiKeyAuth, async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const rows = await pipelineStagesService.ensureWorkspaceStagesSeeded(wid);
    const stages = pipelineStagesService.stagesForKanban(rows);
    res.json({ success: true, stages });
  } catch (err) {
    next(err);
  }
});

// ── 11. START SEQUENCE / CADENCE ─────────────────────────────────────────────

/**
 * POST /autonomous/leads/:leadKey/sequence
 * Body: { templateId (string) }
 * Starts a cadence/sequence on a lead.
 */
router.post('/leads/:leadKey/sequence', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const raw = req.params.leadKey;
    const key = raw.startsWith('lead:') ? raw : `lead:${raw}`;
    const templateId = String(req.body.templateId || '').trim();
    if (!templateId) {
      return res.status(400).json({ success: false, error: 'templateId is required.' });
    }
    const result = await sequenceEngine.startSequence(key, templateId);
    res.json({ success: true, key, sequenceState: result.sequenceState, template: result.template.name });
  } catch (err) {
    if (err.message === 'Lead not found') {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (err.message.startsWith('Unknown sequence template')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ── 12. PAUSE SEQUENCE ──────────────────────────────────────────────────────

/**
 * DELETE /autonomous/leads/:leadKey/sequence
 * Pauses the active sequence on a lead.
 */
router.delete('/leads/:leadKey/sequence', apiKeyAuth, async (req, res, next) => {
  try {
    const raw = req.params.leadKey;
    const key = raw.startsWith('lead:') ? raw : `lead:${raw}`;
    const result = await sequenceEngine.pauseSequence(key);
    if (!result) {
      return res.status(404).json({ success: false, error: 'No active sequence on this lead.' });
    }
    res.json({ success: true, key, message: 'Sequence paused.' });
  } catch (err) {
    next(err);
  }
});

// ── 13. LIST SEQUENCE TEMPLATES ──────────────────────────────────────────────

/**
 * GET /autonomous/sequences/templates
 * Returns all available cadence templates with step summaries.
 */
router.get('/sequences/templates', apiKeyAuth, async (req, res, next) => {
  try {
    const allTemplates = require('../services/sequenceTemplates').listTemplates();
    const templates = allTemplates.map((t) => ({
      id: t.id,
      persona: t.persona,
      name: t.name,
      description: t.description,
      stepCount: t.steps.length,
      steps: (t.steps || []).map((s) => ({
        dayOffset: s.dayOffset,
        channel: s.channel,
        title: s.title,
        hint: s.hint || '',
      })),
    }));
    res.json({ success: true, templates });
  } catch (err) {
    next(err);
  }
});

// ── 14. BATCH SEQUENCE: AUTO-ATTACH CADENCE ─────────────────────────────────

/**
 * POST /autonomous/auto-sequence
 * Auto-attach recommended cadence to all leads in workspace that don't have one yet.
 * Body: { workspaceId?, dryRun? }
 */
router.post('/auto-sequence', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const all = await dbService.getAllLeads(wid);
    const needsSequence = all.filter((l) => !l.sequenceState || l.sequenceState.status !== 'active');
    const results = [];
    for (const lead of needsSequence) {
      try {
        const { templateId } = recommendCadenceTemplate(lead, all);
        if (!templateId) {
          results.push({ key: lead.key, title: lead.title, skipped: true, reason: 'No template matched' });
          continue;
        }
        if (req.body.dryRun) {
          results.push({ key: lead.key, title: lead.title, templateId, dryRun: true });
          continue;
        }
        const r = await sequenceEngine.startSequence(lead.key, templateId);
        results.push({ key: lead.key, title: lead.title, templateId, template: r.template.name, started: true });
      } catch (e) {
        results.push({ key: lead.key, title: lead.title, error: e.message });
      }
    }
    res.json({ success: true, total: needsSequence.length, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
