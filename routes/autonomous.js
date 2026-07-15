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

function normalizeLeadCategoryName(raw, fallback = 'N/A') {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw)) {
    const joined = raw.filter(Boolean).map(String).join(', ').trim();
    return joined || fallback;
  }
  const s = String(raw).trim();
  return s || fallback;
}

const dbService = require('../services/database');
const { folderKeyForJobType, leadMetadataForJobType } = require('../services/pipelineFolders');
const { normalizeJobType } = require('../services/scrapeJobTypes');
const mapsSearch = require('../services/mapsSearch');
const enricher = require('../services/enricher');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { uploadCsvToDrive, safeDriveFileName } = require('../services/googleDriveUpload');
const { getValidAccessToken } = require('../services/googleDriveAccess');
const { autoAttachCadenceIfNeeded } = require('../services/leadCadence');
const { clampPipelineStage } = require('../services/pipelineConstants');
const { parseImportFile } = require('../services/csvLeadImport');
const { findExistingLead, upsertLeadInMemoryList } = require('../services/leadDedupe');
const { recommendCadenceTemplate } = require('../services/leadCadence');
const sequenceEngine = require('../services/sequenceEngine');
const pipelineStagesService = require('../services/pipelineStagesService');
const { createAuditReportToken } = require('../services/auditReportSign');
const pageSpeedInsights = require('../services/pageSpeedInsights');
const websiteAiAnalysis = require('../services/websiteAiAnalysis');
const ghlSync = require('../services/ghlSync');
const ghlClient = require('../services/ghlClient');
const { ensureChromeExtensionFolder, ensureFolderByName, chromeExtensionFolderUrl } = require('../services/chromeExtensionInbox');
const { normalizeWorkspaceAccentHex } = require('../lib/workspaceAccent');
const { scoreLocalProspect } = require('../services/localProspectScore');
const { normalizeDomain } = require('../services/leadDedupe');
const workspaceBootstrap = require('../services/workspaceBootstrap');

function isMissingWebsiteValue(website) {
  const w = String(website || '').trim();
  return !w || w === 'N/A';
}

function isMissingPhoneValue(phone) {
  const p = String(phone || '').trim();
  return !p || p === 'N/A';
}

function isGoogleMapsLeadUrl(url) {
  const s = String(url || '').trim().toLowerCase();
  return (
    s.includes('google.com/maps') ||
    s.includes('maps.app.goo.gl') ||
    s.includes('goo.gl/maps') ||
    s.includes('maps.google.com')
  );
}

function pickLeadMapsUrl(lead) {
  if (!lead) return '';
  const direct = String(lead.url || '').trim();
  if (isGoogleMapsLeadUrl(direct)) return direct;
  const imp = lead.importFields && typeof lead.importFields === 'object' ? lead.importFields : {};
  for (const key of ['google_maps_url', 'maps_url', 'gbp_url', 'place_url']) {
    const v = String(imp[key] || '').trim();
    if (isGoogleMapsLeadUrl(v)) return v;
  }
  return '';
}

function hostnameFromWebsite(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function leadNeedsReEnrichment(lead) {
  if (!pickLeadMapsUrl(lead)) return false;
  const missingWebsite = isMissingWebsiteValue(lead.website);
  const missingGeo = !String(lead.city || '').trim() || !String(lead.state || '').trim();
  return missingWebsite || missingGeo;
}

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

function parseExtensionReviewSnippets(body) {
  if (Array.isArray(body?.reviewSnippets)) {
    const list = body.reviewSnippets.map((s) => String(s || '').trim()).filter(Boolean);
    return list.length ? list.slice(0, 20) : undefined;
  }
  const one = body?.reviewSnippet ?? body?.review_snippet;
  if (one) {
    const text = String(one).trim().slice(0, 2000);
    return text ? [text] : undefined;
  }
  return undefined;
}

function parseExtensionSponsored(body) {
  if (body?.sponsored === true || body?.sponsored === false) return body.sponsored;
  const raw = String(body?.sponsored ?? '').trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(raw)) return true;
  if (['no', 'false', '0', 'n'].includes(raw)) return false;
  return undefined;
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
      categoryName: normalizeLeadCategoryName(req.body.categoryName || req.body.category),
      address: req.body.address || 'N/A',
      city: req.body.city || '',
      state: req.body.state || '',
      zip: String(req.body.zip || req.body.postalCode || '').trim(),
      postalCode: String(req.body.postalCode || req.body.zip || '').trim(),
      totalScore: parseFloat(req.body.totalScore) || 0,
      reviewsCount: parseInt(req.body.reviewsCount, 10) || 0,
      url: req.body.url || '',
      facebook: req.body.facebook || 'N/A',
      instagram: req.body.instagram || 'N/A',
      twitter: req.body.twitter || 'N/A',
      linkedin: req.body.linkedin || 'N/A',
      sourceChannel: req.body.sourceChannel || req.body.channel || '',
      status: req.body.status || 'Not Contacted',
      source: req.body.source || 'autonomous',
      savedAt: new Date().toISOString(),
      workspaceId: wid,
    };

    const reviewSnippets = parseExtensionReviewSnippets(req.body);
    if (reviewSnippets) leadData.reviewSnippets = reviewSnippets;
    const sponsored = parseExtensionSponsored(req.body);
    if (sponsored !== undefined) leadData.sponsored = sponsored;

    if (req.body.note) {
      leadData.updates = [{ type: 'note', value: String(req.body.note), timestamp: new Date().toISOString() }];
    }

    if (req.body.jobType) {
      const jt = normalizeJobType(req.body.jobType);
      Object.assign(
        leadData,
        leadMetadataForJobType(jt, {
          listing: req.body.listing,
          realEstate: req.body.realEstate,
        }),
      );
      const folderKey = await folderKeyForJobType(wid, jt);
      if (folderKey) leadData.folderKey = folderKey;
    } else if (req.body.listing && typeof req.body.listing === 'object') {
      leadData.listing = req.body.listing;
      if (req.body.sourceType) leadData.sourceType = String(req.body.sourceType).trim();
    }

    const isChromeExtension =
      String(req.body.source || leadData.source || '').trim() === 'chrome_extension';
    const requestedFolderName = String(req.body.folderName || req.body.newFolderName || '').trim();
    let resolvedFolderName = '';
    if (isChromeExtension) {
      const folder = requestedFolderName
        ? await ensureFolderByName(wid, requestedFolderName)
        : await ensureChromeExtensionFolder(wid);
      if (folder && folder.key) {
        leadData.folderKey = folder.key;
        leadData.sourceType = leadData.sourceType || 'chrome_extension';
        resolvedFolderName = String(folder.name || requestedFolderName || 'Chrome Extension').trim();
        if (requestedFolderName) {
          leadData.forceFolderKey = true;
        }
      }
    }

    const result = await dbService.saveLeadWithMeta(leadData);
    try { await autoAttachCadenceIfNeeded({ leadKey: result.key, workspaceId: wid }); } catch (_) { /* non-fatal */ }

    const savedLead = result.lead || {};
    const folderKey = String(savedLead.folderKey || '').trim();
    let actualFolderName = resolvedFolderName;
    if (folderKey) {
      const folder = await dbService.getFolder(wid, folderKey);
      if (folder?.name) actualFolderName = String(folder.name).trim();
    }
    const folderApplied = folderKey === String(leadData.folderKey || '').trim();
    res.json({
      success: true,
      key: result.key,
      merged: !!result.merged,
      folderApplied,
      title,
      folderKey,
      folderName: actualFolderName || (isChromeExtension ? 'Chrome Extension' : ''),
      folderUrl: folderKey ? chromeExtensionFolderUrl(folderKey) : '',
    });
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

/**
 * GET /autonomous/re-enrich-queue
 * Query: folderName (required), limit?
 * Leads in folder with a Google Maps URL but missing website and/or city/state.
 */
router.get('/re-enrich-queue', apiKeyAuth, async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const folderName = String(req.query.folderName || '').trim();
    if (!folderName) {
      return res.status(400).json({ success: false, error: 'folderName is required.' });
    }

    const folder = await ensureFolderByName(wid, folderName);
    if (!folder?.key) {
      return res.status(404).json({ success: false, error: `Folder “${folderName}” not found.` });
    }

    const all = await dbService.getAllLeads(wid);
    const inFolder = all.filter((l) => String(l.folderKey || '') === String(folder.key));
    const needing = inFolder.filter(leadNeedsReEnrichment);
    const limit = Math.min(parseInt(req.query.limit, 10) || 150, 200);
    const leads = needing.slice(0, limit).map((lead) => ({
      key: lead.key,
      title: lead.title,
      mapsUrl: pickLeadMapsUrl(lead),
      missing: [
        isMissingWebsiteValue(lead.website) ? 'website' : null,
        !String(lead.city || '').trim() ? 'city' : null,
        !String(lead.state || '').trim() ? 'state' : null,
      ].filter(Boolean),
    }));

    res.json({
      success: true,
      folderName: folder.name || folderName,
      folderKey: folder.key,
      folderUrl: chromeExtensionFolderUrl(folder.key),
      totalInFolder: inFolder.length,
      totalNeeding: needing.length,
      count: leads.length,
      leads,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /autonomous/leads/:leadKey
 * Body: { website?, city?, state?, address?, phone?, companyDomain? }
 * Fills missing contact/location fields only (does not overwrite existing values).
 */
router.patch('/leads/:leadKey', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const raw = req.params.leadKey;
    const key = raw.startsWith('lead:') ? raw : `lead:${raw}`;
    const lead = await dbService.getLead(key);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    if (String(lead.workspaceId || 'default') !== wid) {
      return res.status(403).json({ success: false, error: 'Lead is not in this workspace.' });
    }

    const body = req.body || {};
    const patch = {};

    if (isMissingWebsiteValue(lead.website) && body.website && !isMissingWebsiteValue(body.website)) {
      patch.website = String(body.website).trim();
    }
    if (!String(lead.city || '').trim() && body.city) {
      patch.city = String(body.city).trim();
    }
    if (!String(lead.state || '').trim() && body.state) {
      patch.state = String(body.state).trim();
    }
    if ((!lead.address || lead.address === 'N/A') && body.address && body.address !== 'N/A') {
      patch.address = String(body.address).trim();
    }
    if (isMissingPhoneValue(lead.phone) && body.phone && !isMissingPhoneValue(body.phone)) {
      patch.phone = String(body.phone).trim();
    }

    const domain =
      String(body.companyDomain || '').trim() ||
      hostnameFromWebsite(patch.website || lead.website);
    if (domain && isMissingWebsiteValue(lead.website)) {
      patch.importFields = {
        ...(lead.importFields || {}),
        company_domain: domain,
        domain,
      };
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ success: true, key, updated: false, message: 'Nothing to update.' });
    }

    if (patch.website) {
      patch.domainNorm = normalizeDomain(patch.website);
    }

    const merged = { ...lead, ...patch };
    const scored = scoreLocalProspect(merged);
    patch.websiteStatus = scored.websiteStatus;
    patch.websiteStatusLabel = scored.websiteStatusLabel;
    if (!lead.prospectTier) patch.prospectTier = scored.prospectTier;

    patch.logs = [
      {
        type: 're_enrich',
        message: `Chrome extension backfill: ${Object.keys(patch).filter((k) => k !== 'logs').join(', ')}`,
        timestamp: new Date().toISOString(),
      },
    ];

    await dbService.updateLead(key, patch, wid);
    res.json({
      success: true,
      key,
      updated: true,
      fields: Object.keys(patch).filter((k) => k !== 'logs'),
      websiteStatusLabel: patch.websiteStatusLabel,
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
    const headers = [
      'title',
      'phone',
      'website',
      'email',
      'categoryName',
      'address',
      'city',
      'state',
      'zip',
      'listingPrice',
      'listingBeds',
      'listingBaths',
      'listingSqft',
      'sourceChannel',
      'url',
      'totalScore',
      'reviewsCount',
      'facebook',
      'instagram',
      'twitter',
      'status',
      'pipelineStage',
      'source',
      'savedAt',
    ];
    const escape = (v) => {
      const s = String(v == null ? '' : v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csvRows = [headers.join(',')];
    for (const l of leads) {
      const listing = l.listing && typeof l.listing === 'object' ? l.listing : {};
      const row = {
        title: l.title,
        phone: l.phone,
        website: l.website,
        email: l.email,
        categoryName: l.categoryName,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip || l.postalCode,
        listingPrice: listing.price != null ? listing.price : '',
        listingBeds: listing.beds != null ? listing.beds : '',
        listingBaths: listing.baths != null ? listing.baths : '',
        listingSqft: listing.sqft != null ? listing.sqft : '',
        sourceChannel: l.sourceChannel,
        url: l.url,
        totalScore: l.totalScore,
        reviewsCount: l.reviewsCount,
        facebook: l.facebook,
        instagram: l.instagram,
        twitter: l.twitter,
        status: l.status,
        pipelineStage: l.pipelineStage,
        source: l.source,
        savedAt: l.savedAt,
      };
      csvRows.push(headers.map((h) => escape(row[h])).join(','));
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

    const folderName = String(req.body.folderName || req.body.newFolderName || '').trim();
    let folderKey = String(req.body.folderKey || '').trim();
    let resolvedFolderName = '';
    if (folderName) {
      const folder = await ensureFolderByName(wid, folderName);
      if (folder && folder.key) {
        folderKey = String(folder.key);
        resolvedFolderName = String(folder.name || folderName).trim();
      }
    }

    let created = 0;
    let updated = 0;
    let failed = 0;
    const savedKeys = [];
    const workspaceLeads = await dbService.getAllLeads(wid);

    for (const rec of records) {
      if (!rec.title) { continue; }
      try {
        const payload = { ...rec, workspaceId: wid };
        if (folderKey) payload.folderKey = folderKey;
        if (String(req.body.source || '').trim() === 'chrome_extension') {
          payload.source = 'chrome_extension';
          payload.sourceType = payload.sourceType || 'chrome_extension';
        }
        const existing = findExistingLead(workspaceLeads, payload, wid);
        const result = await dbService.saveLeadWithMeta(payload);
        savedKeys.push(result.key);
        if (result.lead) upsertLeadInMemoryList(workspaceLeads, result.lead);
        if (existing || result.merged) updated++;
        else created++;
        try { await autoAttachCadenceIfNeeded({ leadKey: result.key, workspaceId: wid }); } catch (_) { /* non-fatal */ }
      } catch (e) {
        failed++;
      }
    }

    res.json({
      success: true,
      created,
      updated,
      failed,
      keys: savedKeys,
      folderKey,
      folderName: resolvedFolderName,
      folderUrl: folderKey ? chromeExtensionFolderUrl(folderKey) : '',
    });
  } catch (err) {
    next(err);
  }
});

// ── 8. STATUS / HEALTH ────────────────────────────────────────────────────────

/**
 * GET /autonomous/workspaces
 * List workspaces the extension user can save into (requires x-user-email when multi-workspace).
 */
router.get('/workspaces', apiKeyAuth, async (req, res, next) => {
  try {
    const email = String(req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
    const fallbackWid = workspaceId(req);

    async function workspaceSummary(id) {
      const ws = await dbService.getWorkspace(id).catch(() => null);
      return {
        id,
        name: (ws && ws.name) || id,
        slug: (ws && ws.slug) || '',
        accentColor: normalizeWorkspaceAccentHex(ws && ws.accentColor) || '#CA8A04',
      };
    }

    if (!email) {
      return res.json({
        success: true,
        workspaces: [await workspaceSummary(fallbackWid)],
        activeWorkspaceId: fallbackWid,
        requiresEmail: true,
      });
    }

    await workspaceBootstrap.ensureUserHasWorkspaces(email);
    const ids = await dbService.getUserWorkspaceIds(email);
    const workspaces = [];
    for (const id of ids) {
      const ws = await dbService.getWorkspace(id);
      if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) continue;
      workspaces.push({
        id: ws.id,
        name: ws.name || ws.id,
        slug: ws.slug || '',
        accentColor: normalizeWorkspaceAccentHex(ws.accentColor) || '#CA8A04',
      });
    }

    if (!workspaces.length) {
      workspaces.push(await workspaceSummary(fallbackWid));
    }

    const active =
      workspaces.some((w) => w.id === fallbackWid) ? fallbackWid : workspaces[0].id;

    res.json({
      success: true,
      workspaces,
      activeWorkspaceId: active,
      requiresEmail: false,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /autonomous/status
 * Quick health check + config status.
 */
router.get('/status', apiKeyAuth, async (req, res) => {
  const wid = workspaceId(req);
  const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid).catch(() => ({}));
  const ws = await dbService.getWorkspace(wid).catch(() => null);
  const accentColor = normalizeWorkspaceAccentHex(ws && ws.accentColor) || '#CA8A04';
  res.json({
    success: true,
    workspaceId: wid,
    workspace: {
      id: wid,
      name: (ws && ws.name) || wid,
      accentColor,
    },
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

// ── 15. SET WORKSPACE INTEGRATIONS ──────────────────────────────────────────

/**
 * POST /autonomous/integrations
 * Body: { rapidapiKey?, rapidapiHost?, firecrawlApiKey?, ... }
 * Updates workspace integration keys. Only non-empty fields are set.
 */
router.post('/integrations', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const ws = (await dbService.getWorkspace(wid)) || { id: wid };
    const existingPlain = workspaceIntegrations.decryptedFromWorkspace(ws);
    const nextPlain = workspaceIntegrations.mergeIntegrationUpdates(existingPlain, req.body);
    await workspaceIntegrations.saveWorkspaceIntegrations(wid, nextPlain);
    
    // Verify: re-read resolved env
    const resolved = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    res.json({
      success: true,
      workspaceId: wid,
      mapsConfigured: mapsSearch.isMapsSearchConfigured(resolved),
      rapidapiKeySet: !!resolved.RAPIDAPI_KEY,
      apifyTokenSet: !!resolved.APIFY_API_TOKEN,
    });
  } catch (err) {
    next(err);
  }
});

// ── 16. RUN FULL AUDIT (GBP + Website) ───────────────────────────────────────

/**
 * POST /autonomous/audit/run
 * Body: { businessName, city, state, category?, leadKey? }
 * Runs GBP audit + website analysis, saves to lead, returns report URL.
 * If leadKey is not provided, creates a new lead.
 */
router.post('/audit/run', apiKeyAuth, express.json({ limit: '10mb' }), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const businessName = String(req.body.businessName || '').trim();
    const city = String(req.body.city || '').trim();
    const state = String(req.body.state || '').trim();
    const category = String(req.body.category || '').trim() || null;
    const existingLeadKey = String(req.body.leadKey || '').trim() || null;

    if (!businessName || !city || !state) {
      return res.status(400).json({ success: false, error: 'businessName, city, state are required.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) {
      return res.status(503).json({ success: false, error: 'Maps search not configured.' });
    }

    // 1. Search for the target business on Google Maps
    const searchQuery = category ? `${businessName} ${category}` : businessName;
    const targetResults = await mapsSearch.searchGoogleMaps({
      keyword: searchQuery, city, state, maxResults: 5, integrationEnv,
    });

    const target = targetResults.find(r => {
      const nameMatch = r.title.toLowerCase().includes(businessName.toLowerCase()) ||
        businessName.toLowerCase().includes(r.title.toLowerCase());
      return nameMatch;
    }) || targetResults[0];

    if (!target) {
      return res.status(404).json({
        success: false,
        error: `Could not find "${businessName}" in ${city}, ${state}.`,
      });
    }

    // 2. Search for competitors
    const competitorQuery = category || target.categoryName || businessName.split(' ')[0];
    const competitorResults = await mapsSearch.searchGoogleMaps({
      keyword: `${competitorQuery} ${city}`, city, state, maxResults: 10, integrationEnv,
    });
    const competitors = competitorResults
      .filter(c => c.placeId !== target.placeId && c.title.toLowerCase() !== target.title.toLowerCase())
      .slice(0, 5);

    // 3. Score GBP (reuse the same scoring logic from /api/audit/gbp)
    const { scoreGBP } = require('../routes/audit');
    const gbpAudit = scoreGBP(target, competitors);

    // 4. Run website analysis if website exists
    let websiteAnalysis = null;
    let pageSpeedAudit = null;
    const websiteUrl = target.website && target.website !== 'N/A' ? target.website : null;

    if (websiteUrl) {
      try {
        pageSpeedAudit = await pageSpeedInsights.runPageSpeedAudit(websiteUrl, { strategy: 'mobile' });
      } catch (e) { /* non-fatal */ }

      try {
        websiteAnalysis = await websiteAiAnalysis.analyzeWebsite(websiteUrl);
      } catch (e) { /* non-fatal */ }
    }

    // 5. Save/update lead
    let leadKey = existingLeadKey;
    if (!leadKey) {
      const leadData = {
        title: target.title,
        phone: target.phone || 'N/A',
        website: target.website || 'N/A',
        email: target.email || 'N/A',
        city: target.city || city,
        state: target.state || state,
        address: target.address || 'N/A',
        categoryName: target.categoryName || category || 'N/A',
        totalScore: target.totalScore || 0,
        reviewsCount: target.reviewsCount || 0,
        facebook: target.facebook || 'N/A',
        instagram: target.instagram || 'N/A',
        twitter: target.twitter || 'N/A',
        source: 'telegram_audit',
        pipelineStage: 0,
        workspaceId: wid,
      };
      leadKey = await dbService.saveLead(leadData);
    }

    // 6. Save audit data to lead
    const auditData = {
      gbpAudit,
      gbpAuditAt: new Date().toISOString(),
      pageSpeedAudit: pageSpeedAudit ? {
        averageScore: pageSpeedAudit.averageScore,
        scores: pageSpeedAudit.scores,
        fetchedAt: pageSpeedAudit.fetchedAt,
      } : null,
      aiWebsiteAnalysis: websiteAnalysis,
      aiWebsiteAnalysisUpdatedAt: new Date().toISOString(),
    };

    if (pageSpeedAudit) {
      auditData.pageSpeedAuditAvg = pageSpeedAudit.averageScore;
      auditData.ownerSignal = pageSpeedInsights.buildOwnerSignalFromAudit(target.title, pageSpeedAudit);
    }

    await dbService.updateLead(leadKey, auditData);

    // 7. Generate signed report URL
    const token = createAuditReportToken({ leadKey, workspaceId: wid });
    const base = process.env.BASE_URL || 'https://adhelloleadsos.onrender.com';
    const reportUrl = `${base}/audit/report/${token}`;

    // Auto-attach cadence
    try {
      const all = await dbService.getAllLeads(wid);
      const { templateId } = recommendCadenceTemplate({ ...target, workspaceId: wid }, all);
      if (templateId) {
        await sequenceEngine.startSequence(leadKey, templateId);
      }
    } catch (e) { /* non-fatal */ }

    res.json({
      success: true,
      leadKey,
      reportUrl,
      business: {
        title: target.title,
        phone: target.phone,
        website: target.website,
        address: target.address,
      },
      gbpScore: gbpAudit.totalScore,
      gbpGrade: gbpAudit.grade,
      recommendations: gbpAudit.recommendations.slice(0, 3),
      websiteScore: pageSpeedAudit?.averageScore || null,
    });
  } catch (err) {
    next(err);
  }
});

// ── GHL — push/pull contacts for sub-agents (Pavlex, Hermes, etc.) ───────────

/**
 * GET /autonomous/ghl/status
 * Returns whether GHL is configured for the workspace.
 */
router.get('/ghl/status', apiKeyAuth, async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    return res.json({
      success: true,
      workspaceId: wid,
      ...ghlSync.statusFromEnv(integrationEnv),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /autonomous/ghl/push
 * Body: { leadKeys?: string[], limit?: number }
 * Push workspace leads to GHL contacts.
 */
router.post('/ghl/push', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!ghlClient.isConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'GHL not configured. Set ghlApiKey and ghlLocationId in Workspace → Integrations.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await ghlSync.pushLeads({
      workspaceId: wid,
      integrationEnv,
      leadKeys: body.leadKeys,
      limit: body.limit,
    });
    return res.json({ success: true, workspaceId: wid, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /autonomous/ghl/pull
 * Body: { limit?: number, maxPages?: number, startAfterId?: string }
 * Pull GHL contacts into workspace leads.
 */
router.post('/ghl/pull', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!ghlClient.isConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'GHL not configured. Set ghlApiKey and ghlLocationId in Workspace → Integrations.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await ghlSync.pullContacts({
      workspaceId: wid,
      integrationEnv,
      limit: body.limit,
      maxPages: body.maxPages,
      startAfterId: body.startAfterId,
    });
    return res.json({ success: true, workspaceId: wid, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /autonomous/ghl/sync
 * Body: { direction?: 'both'|'push'|'pull', leadKeys?, limit?, maxPages? }
 * Bidirectional sync (default: pull then push).
 */
router.post('/ghl/sync', apiKeyAuth, express.json(), async (req, res, next) => {
  try {
    const wid = workspaceId(req);
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    if (!ghlClient.isConfigured(integrationEnv)) {
      return res.status(503).json({
        success: false,
        error: 'GHL not configured. Set ghlApiKey and ghlLocationId in Workspace → Integrations.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const direction = String(body.direction || 'both').toLowerCase();
    const opts = {
      workspaceId: wid,
      integrationEnv,
      leadKeys: body.leadKeys,
      limit: body.limit,
      maxPages: body.maxPages,
      pushLimit: body.pushLimit,
      pullMaxPages: body.pullMaxPages,
    };
    if (direction === 'push') {
      const push = await ghlSync.pushLeads(opts);
      return res.json({ success: true, workspaceId: wid, push });
    }
    if (direction === 'pull') {
      const pull = await ghlSync.pullContacts(opts);
      return res.json({ success: true, workspaceId: wid, pull });
    }
    const result = await ghlSync.syncBoth(opts);
    return res.json({ success: true, workspaceId: wid, ...result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
