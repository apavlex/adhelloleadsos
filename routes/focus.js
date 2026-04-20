/**
 * Focus Mode — lead-by-lead outreach (/focus).
 */
const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const {
  countUniqueLeadsTouchedOnUtcDate,
  dailyPersonalizedTouchGoal,
} = require('../services/trackerStats');
const { buildFocusQueue, shortLeadKey, lastActivityMs } = require('../services/focusQueue');

const pipelineStagesService = require('../services/pipelineStagesService');

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
    defaultChannel,
  };
}

router.get('/metrics.json', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const all = await dbService.getAllLeads(req.workspaceId);
    const workspaceLeads = filterLeadsForRequest(req, all);
    const touchesToday = countUniqueLeadsTouchedOnUtcDate(workspaceLeads, today);
    const touchGoal = dailyPersonalizedTouchGoal();
    res.json({ success: true, touchesToday, touchGoal });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineLeads = excludeOutreachFolderLeads(visible);
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const sortedStages = [...stageRows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const ordered = buildFocusQueue(pipelineLeads);
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
    const touchGoal = dailyPersonalizedTouchGoal();

    res.render('focus', {
      title: 'Focus Mode | Agency OS',
      activePage: 'today',
      touchesToday,
      touchGoal,
      focusQueueJson: JSON.stringify(queue),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
