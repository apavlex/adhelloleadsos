/**
 * Focus Mode — lead-by-lead outreach (/focus).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const {
  countUniqueLeadsTouchedOnUtcDate,
} = require('../services/trackerStats');
const { loadDailyTouchGoal, saveDailyTouchGoal } = require('../services/touchGoalPrefs');
const { buildFocusQueue, shortLeadKey, lastActivityMs } = require('../services/focusQueue');

const pipelineStagesService = require('../services/pipelineStagesService');
const websiteAiAnalysis = require('../services/websiteAiAnalysis');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');

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

function pickHeuristicServiceKey(lead) {
  const existing =
    (lead.kieServiceInsight && lead.kieServiceInsight.primaryServiceKey) ||
    lead.primaryServiceKey ||
    '';
  if (SCRIPT_LIBRARY_KEYS.includes(existing)) return existing;

  const website = !!(lead.website && lead.website !== 'N/A');
  const reviews = parseInt(lead.reviewsCount, 10) || 0;
  const rating = parseFloat(lead.totalScore) || 0;

  if (!website || lead.isOutdated === true || lead.isMobileFriendly === false) return 'aiWebsites';
  if (reviews < 25 || (rating > 0 && rating < 4.3)) return 'reputation';
  if (lead.hasChatbot === false || lead.hasClickToCall === false) return 'speedToLeadAgent';
  if (lead.aeoScore != null && parseInt(lead.aeoScore, 10) < 55) return 'reputation';
  return 'aiWebsites';
}

function buildBusinessNeedsPayload(l) {
  const insight = l.kieServiceInsight && typeof l.kieServiceInsight === 'object' ? l.kieServiceInsight : null;
  const analysis = l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object' ? l.aiWebsiteAnalysis : null;

  let topGapLabels = [];
  if (analysis) {
    topGapLabels =
      Array.isArray(analysis.topGapLabels) && analysis.topGapLabels.length
        ? analysis.topGapLabels.slice(0, 4)
        : websiteAiAnalysis.computeTopGapLabels(analysis, 3);
  }

  const ownerSignal = String(l.ownerSignal || '').trim();
  const signal = ownerSignal || (analysis ? websiteAiAnalysis.buildOwnerSignal(l, analysis) : '');

  const serviceKey =
    String(l.primaryServiceKey || '').trim() ||
    (insight && insight.primaryServiceKey) ||
    pickHeuristicServiceKey(l);
  const serviceDef = SCRIPT_LIBRARY[serviceKey] || null;

  const primaryServiceLabel =
    (insight && insight.primaryServiceLabel) || (serviceDef && serviceDef.label) || '';
  const rationale = (insight && insight.rationale) || String(l.auditSummary || '').trim();
  const talkTrack = (insight && insight.talkTrack) || '';
  const headline = signal || rationale || '';

  return {
    headline,
    topGapLabels,
    primaryServiceKey: serviceKey,
    primaryServiceLabel,
    rationale,
    talkTrack,
    hasCachedInsight: !!(insight && insight.rationale),
  };
}

function leadToFocusPayload(l, sortedStages) {
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

  return {
    key: shortLeadKey(l),
    title: l.title || 'Company',
    contactName: contact || '—',
    pipelineStage: stage,
    pipelineLabel: stageLabelFromLead(l, sortedStages),
    lastTouchLabel: formatLastTouchDisplay(l),
    website: l.website && l.website !== 'N/A' ? l.website : '',
    phone: l.phone && l.phone !== 'N/A' ? l.phone : '',
    email: hasEmail ? email : '',
    facebook: l.facebook && l.facebook !== 'N/A' ? l.facebook : '',
    instagram: l.instagram && l.instagram !== 'N/A' ? l.instagram : '',
    twitter: l.twitter && l.twitter !== 'N/A' ? l.twitter : '',
    linkedin: l.linkedin && l.linkedin !== 'N/A' ? l.linkedin : '',
    city: l.city || '',
    state: l.state || '',
    address: l.address && l.address !== 'N/A' ? l.address : '',
    latitude: l.latitude != null && l.latitude !== '' ? Number(l.latitude) : null,
    longitude: l.longitude != null && l.longitude !== '' ? Number(l.longitude) : null,
    categoryName: l.categoryName && l.categoryName !== 'N/A' ? l.categoryName : '',
    url: l.url && l.url !== 'N/A' ? l.url : '',
    reviewsCount: Number.isFinite(parseInt(l.reviewsCount, 10)) ? parseInt(l.reviewsCount, 10) : 0,
    totalScore: Number.isFinite(parseFloat(l.totalScore)) ? parseFloat(l.totalScore) : 0,
    ownerSignal: String(l.ownerSignal || '').trim(),
    businessNeeds: buildBusinessNeedsPayload(l),
    hasAiWebsiteAnalysis: !!(l.aiWebsiteAnalysis && typeof l.aiWebsiteAnalysis === 'object'),
    hasAiToolsAssessment: !!(l.aiToolsAssessment && typeof l.aiToolsAssessment === 'object'),
    defaultChannel,
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

router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineLeads = excludeOutreachFolderLeads(visible);
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const sortedStages = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const selectedKeyOrder = parseBulkSelectionKeys(req.query.keys);
    const selectedOnly = selectedKeyOrder.length > 0;
    let ordered;
    if (selectedOnly) {
      // Use full visible set so foldered pipeline picks are not dropped (excludeOutreachFolderLeads
      // only applies to the default auto queue, not explicit bulk selection).
      ordered = await resolveLeadsBySelectedKeys({
        dbService,
        workspaceId: req.workspaceId,
        visibleLeads: visible,
        keyOrder: selectedKeyOrder,
      });
    } else {
      ordered = buildFocusQueue(pipelineLeads);
    }
    const queue = ordered.map((l) => leadToFocusPayload(l, sortedStages));
    const prefer = String(req.query.lead || req.query.leadId || '')
      .trim()
      .replace(/^lead:/i, '');
    if (prefer) {
      const idx = queue.findIndex((q) => q.key === prefer);
      if (idx > 0) {
        const [item] = queue.splice(idx, 1);
        queue.unshift(item);
      }
    }

    const touchesToday = countUniqueLeadsTouchedOnUtcDate(visible, today);
    const touchGoal = await loadDailyTouchGoal(req);

    const focusProductOptions = SCRIPT_LIBRARY_KEYS.map((k) => ({
      key: k,
      label: (SCRIPT_LIBRARY[k] && SCRIPT_LIBRARY[k].label) || k,
    }));

    res.render('focus', {
      title: 'Focus Mode | Agency OS',
      activePage: 'today',
      touchesToday,
      touchGoal,
      focusQueueJson: JSON.stringify(queue),
      focusProductOptions,
      focusSelectionCount: selectedOnly ? queue.length : null,
      focusIsSelectionSession: selectedOnly,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
