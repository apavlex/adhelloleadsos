/**
 * Focus Mode — lead-by-lead outreach (/focus).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const {
  countUniqueLeadsTouchedOnUtcDate,
} = require('../services/trackerStats');
const { loadDailyTouchGoal, saveDailyTouchGoal } = require('../services/touchGoalPrefs');
const { buildFocusQueue, shortLeadKey, lastActivityMs } = require('../services/focusQueue');
const { buildLeadTouchPoints } = require('../services/leadTouchPoints');
const { resolveDialRetryPrefs } = require('../services/dialRetryPrefs');
const { scoreLeadRecord } = require('../services/opportunityScore');
const { pickQuoteForDate } = require('../services/outreachCoachSnapshot');

const pipelineStagesService = require('../services/pipelineStagesService');
const websiteAiAnalysis = require('../services/websiteAiAnalysis');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const { isAgencySalesWorkspace } = require('../services/leadPanelWorkspace');

function stageLabelFromLead(l, sortedStages) {
  const row =
    sortedStages.find((s) => s.id === l.stageId) ||
    sortedStages.find((s) => s.key === l.pipelineStageKey);
  if (row) return row.name;
  const n = parseInt(l.pipelineStage, 10);
  const idx = !Number.isNaN(n) && n >= 1 && n <= sortedStages.length ? n - 1 : 0;
  return sortedStages[idx] ? sortedStages[idx].name : `Stage ${n || 1}`;
}

function formatLastTouchDisplay(l) {
  const t = lastActivityMs(l);
  if (!t) return '—';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pickHeuristicServiceKey(lead, allowedKeys, opts) {
  const keys = Array.isArray(allowedKeys) ? allowedKeys.filter(Boolean) : [];
  const existing =
    (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) ||
    lead.primaryServiceKey ||
    '';
  if (keys.includes(existing)) return existing;
  if (!(opts && opts.isAgency)) return keys[0] || '';

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
  return keys[0] || '';
}

function buildBusinessNeedsPayload(l, scriptLibrary, allowedKeys, opts) {
  const library = scriptLibrary && typeof scriptLibrary === 'object' ? scriptLibrary : {};
  const keys = Array.isArray(allowedKeys) ? allowedKeys.filter(Boolean) : [];
  const isAgency = !!(opts && opts.isAgency);
  const insight = l.kieServiceInsight && typeof l.kieServiceInsight === 'object' ? l.kieServiceInsight : null;
  const analysis =
    isAgency && l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object' ? l.aiWebsiteAnalysis : null;

  let topGapLabels = [];
  if (analysis) {
    topGapLabels =
      Array.isArray(analysis.topGapLabels) && analysis.topGapLabels.length
        ? analysis.topGapLabels.slice(0, 4)
        : websiteAiAnalysis.computeTopGapLabels(analysis, 3);
  }

  const ownerSignal = isAgency ? String(l.ownerSignal || '').trim() : '';
  const signal = ownerSignal || (analysis ? websiteAiAnalysis.buildOwnerSignal(l, analysis) : '');

  const serviceKey =
    String(l.primaryServiceKey || '').trim() ||
    (insight && insight.primaryServiceKey) ||
    pickHeuristicServiceKey(l, keys, { isAgency });
  const serviceDef = library[serviceKey] || null;

  const primaryServiceLabel =
    (insight && insight.primaryServiceLabel) || (serviceDef && serviceDef.label) || '';
  const rationale = isAgency
    ? (insight && insight.rationale) || String(l.auditSummary || '').trim()
    : '';
  const talkTrack = isAgency ? (insight && insight.talkTrack) || '' : '';
  const headline = signal || rationale || '';

  return {
    headline,
    topGapLabels,
    primaryServiceKey: serviceKey,
    primaryServiceLabel,
    rationale,
    talkTrack,
    hasCachedInsight: isAgency && !!(insight && insight.rationale),
  };
}

function leadToFocusPayload(l, sortedStages, scriptLibrary, allowedKeys, opts) {
  const ps = parseInt(l.pipelineStage, 10);
  const stage = !Number.isNaN(ps) && ps >= 1 && ps <= 24 ? ps : 1;
  const email = String(l.email || '').trim();
  const hasEmail = email && email !== 'N/A';
  const hasIg = String(l.instagram || '').trim() && l.instagram !== 'N/A';
  const hasFb = String(l.facebook || '').trim() && l.facebook !== 'N/A';
  let defaultChannel = 'call-script';
  if (hasEmail) defaultChannel = 'email';
  else if (hasIg || hasFb) defaultChannel = 'dm';

  const contact =
    String(l.contactName || '').trim() ||
    (hasEmail ? email.split('@')[0].replace(/[._]+/g, ' ') : '');

  const isAgency = !!(opts && opts.isAgency);
  const opp = isAgency ? scoreLeadRecord(l) : { reasons: [], tier: 'low' };
  const whyReasons = isAgency ? (opp.reasons || []).slice(0, 5) : [];
  const whyTier = opp.tier || 'low';
  const touchPoints = buildLeadTouchPoints(l, { limit: 8 });

  return {
    key: shortLeadKey(l),
    title: l.title || 'Company',
    contactName: contact || '—',
    pipelineStage: stage,
    pipelineLabel: stageLabelFromLead(l, sortedStages),
    stageId: l.stageId || '',
    pipelineStageKey: l.pipelineStageKey || '',
    lastTouchLabel: touchPoints.lastTouch.summary || formatLastTouchDisplay(l),
    touchPoints,
    lastDisposition: String(l.lastDisposition || '').trim().toLowerCase(),
    lastDispositionNotes: String(l.lastDispositionNotes || '').trim(),
    website: l.website && l.website !== 'N/A' ? l.website : '',
    phone: l.phone && l.phone !== 'N/A' ? l.phone : '',
    email: hasEmail ? email : '',
    facebook: l.facebook && l.facebook !== 'N/A' ? l.facebook : '',
    instagram: l.instagram && l.instagram !== 'N/A' ? l.instagram : '',
    twitter: l.twitter && l.twitter !== 'N/A' ? l.twitter : '',
    linkedin: l.linkedin && l.linkedin !== 'N/A' ? l.linkedin : '',
    tiktok: l.tiktok && l.tiktok !== 'N/A' ? l.tiktok : '',
    tags: dbService.normalizeTagKeys(l.tags),
    city: l.city || '',
    state: l.state || '',
    address: l.address && l.address !== 'N/A' ? l.address : '',
    latitude: l.latitude != null && l.latitude !== '' ? Number(l.latitude) : null,
    longitude: l.longitude != null && l.longitude !== '' ? Number(l.longitude) : null,
    categoryName: l.categoryName && l.categoryName !== 'N/A' ? l.categoryName : '',
    url: l.url && l.url !== 'N/A' ? l.url : '',
    reviewsCount: Number.isFinite(parseInt(l.reviewsCount, 10)) ? parseInt(l.reviewsCount, 10) : 0,
    totalScore: Number.isFinite(parseFloat(l.totalScore)) ? parseFloat(l.totalScore) : 0,
    ownerSignal: isAgency ? String(l.ownerSignal || '').trim() : '',
    businessNeeds: buildBusinessNeedsPayload(l, scriptLibrary, allowedKeys, { isAgency }),
    hasAiWebsiteAnalysis: isAgency && !!(l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object'),
    hasAiToolsAssessment: isAgency && !!(l.aiToolsAssessment && typeof l.aiToolsAssessment === 'object'),
    defaultChannel,
    whyReasons,
    whyTier,
  };
}

router.get('/metrics.json', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const all = await dbService.getAllLeads(req.workspaceId);
    const workspaceLeads = filterLeadsForRequest(req, all);
    const touchesToday = countUniqueLeadsTouchedOnUtcDate(workspaceLeads, today);
    const touchGoal = await loadDailyTouchGoal(req);
    res.json({ success: true, touchesToday, touchGoal });
  } catch (e) {
    next(e);
  }
});

/** Callable focus queue for softphone Contacts tab and dialer integrations. */
router.get('/queue.json', async (req, res, next) => {
  try {
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const offerBundle = require('../services/workspaceSalesScripts').buildWorkspaceOfferLibrary(
      ws,
      SCRIPT_LIBRARY,
    );
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineLeads = filterBusinessPipelineLeads(visible);
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const sortedStages = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const dialRetry = resolveDialRetryPrefs(ws.telephony);
    const isAgency = isAgencySalesWorkspace(ws);
    const ordered = buildFocusQueue(pipelineLeads, 200, { queueMode: dialRetry.queueMode });
    const queue = ordered
      .map((l) =>
        leadToFocusPayload(l, sortedStages, offerBundle.library, offerBundle.keys, { isAgency }),
      )
      .filter((item) => {
        const phone = String(item.phone || '').trim();
        return phone && phone !== 'N/A' && phone !== '—';
      });
    res.json({ success: true, queue });
  } catch (e) {
    next(e);
  }
});

router.post('/touch-goal', async (req, res, next) => {
  try {
    const email = userEmail(req);
    if (!email) {
      return res.status(401).json({ success: false, error: 'Sign in to save your daily goal.' });
    }
    const touchGoal = await saveDailyTouchGoal(email, req.body && req.body.touchGoal);
    res.json({ success: true, touchGoal });
  } catch (e) {
    next(e);
  }
});

const { parseBulkSelectionKeys, orderLeadsByKeys, resolveLeadsBySelectedKeys } = require('../services/bulkSelectionKeys');

function promoteFocusLead(queue, payload) {
  if (!payload || !payload.key) return;
  const idx = queue.findIndex((q) => q && q.key === payload.key);
  if (idx === 0) return;
  if (idx > 0) {
    const [item] = queue.splice(idx, 1);
    queue.unshift(item);
    return;
  }
  queue.unshift(payload);
}

async function ensureExplicitFocusLead({
  queue,
  explicitOpenKey,
  visible,
  sortedStages,
  scriptLibrary,
  allowedKeys,
  dbService,
  workspaceId,
  isAgency,
}) {
  const key = String(explicitOpenKey || '').trim().replace(/^lead:/i, '');
  if (!key) return;

  const inQueue = queue.find((q) => q && q.key === key);
  if (inQueue) {
    promoteFocusLead(queue, inQueue);
    return;
  }

  const rows = await resolveLeadsBySelectedKeys({
    dbService,
    workspaceId,
    visibleLeads: visible,
    keyOrder: [key],
  });
  const leadRow = rows[0];
  if (!leadRow) return;

  promoteFocusLead(
    queue,
    leadToFocusPayload(leadRow, sortedStages, scriptLibrary, allowedKeys, { isAgency }),
  );
}

router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const ws = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const offerBundle = require('../services/workspaceSalesScripts').buildWorkspaceOfferLibrary(
      ws,
      SCRIPT_LIBRARY,
    );
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    // Include pipeline-folder businesses (maps saves file into Businesses folder).
    // Listing/product folders are excluded via filterBusinessPipelineLeads.
    const pipelineLeads = filterBusinessPipelineLeads(visible);
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const sortedStages = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const dialRetry = resolveDialRetryPrefs(ws.telephony);
    const selectedKeyOrder = parseBulkSelectionKeys(req.query.keys);
    const preferShortKey = String(req.query.lead || req.query.leadId || '')
      .trim()
      .replace(/^lead:/i, '');
    const explicitOpenKey =
      preferShortKey || (selectedKeyOrder.length === 1 ? selectedKeyOrder[0] : '');
    const bulkSelection = selectedKeyOrder.length > 1;
    let ordered;
    if (selectedKeyOrder.length > 0) {
      const resolved = await resolveLeadsBySelectedKeys({
        dbService,
        workspaceId: req.workspaceId,
        visibleLeads: visible,
        keyOrder: selectedKeyOrder,
      });
      // Single-lead opens (navbar search) skip business-only filter so foldered picks still load.
      ordered = bulkSelection ? filterBusinessPipelineLeads(resolved) : resolved;
    } else {
      ordered = buildFocusQueue(pipelineLeads, 200, { queueMode: dialRetry.queueMode });
    }
    const isAgency = isAgencySalesWorkspace(ws);
    const queue = ordered.map((l) =>
      leadToFocusPayload(l, sortedStages, offerBundle.library, offerBundle.keys, { isAgency }),
    );

    await ensureExplicitFocusLead({
      queue,
      explicitOpenKey,
      visible,
      sortedStages,
      scriptLibrary: offerBundle.library,
      allowedKeys: offerBundle.keys,
      dbService,
      workspaceId: req.workspaceId,
      isAgency,
    });

    const touchesToday = countUniqueLeadsTouchedOnUtcDate(visible, today);
    const touchGoal = await loadDailyTouchGoal(req);

    const focusScriptLibrary = offerBundle.library;
    const focusProductOptions = offerBundle.keys.map((k) => ({
      key: k,
      label: (offerBundle.library[k] && offerBundle.library[k].label) || k,
    }));
    const workspaceTags = await dbService.listTags(req.workspaceId);

    res.render('focus', {
      title: 'Focus Mode | Agency OS',
      activePage: 'today',
      touchesToday,
      touchGoal,
      entrepreneurQuote: pickQuoteForDate(today),
      focusQueueJson: JSON.stringify(queue),
      focusProductOptions,
      focusScriptLibraryJson: JSON.stringify(focusScriptLibrary),
      focusSelectionCount: bulkSelection ? queue.length : null,
      focusIsSelectionSession: bulkSelection,
      workspaceTags,
      isAgencySalesWorkspace: isAgency,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports._test = {
  pickHeuristicServiceKey,
  leadToFocusPayload,
};
