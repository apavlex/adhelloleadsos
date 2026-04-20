const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const { PIPELINE_STAGES } = require('../services/salesConstants');
const { filterLeadsForRequest } = require('../services/workspaceService');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
} = require('../services/leadListFilters');

router.get('/', async (req, res, next) => {
  try {
    const tab = String(req.query.tab || 'queue').toLowerCase();
    if (tab === 'touches') {
      return res.redirect(302, '/analytics?tab=tracker');
    }
    const safeTab = ['queue', 'pipeline', 'folders'].includes(tab) ? tab : 'queue';

    const all = await dbService.getAllLeads();
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);

    const folders = await dbService.listFolders(req.workspaceId || 'default');

    const sourceFilter = String(req.query.source || 'all').toLowerCase();
    let pipelineBoardLeads = pipelineVisible;
    if (sourceFilter === 'inbound') {
      pipelineBoardLeads = pipelineVisible.filter((l) => l.source && l.source.startsWith('adhello_'));
    } else if (sourceFilter === 'cold') {
      pipelineBoardLeads = pipelineVisible.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    }

    const pipelineFilters = normalizeLeadListFilters(req.query);
    pipelineBoardLeads = applyLeadListFilters(pipelineBoardLeads, pipelineFilters);

    const statusUniq = new Map();
    pipelineVisible.forEach((l) => {
      const d = displayStatus(l.status);
      statusUniq.set(d.toLowerCase(), d);
    });
    const pipelineStatusOptions = Array.from(statusUniq.values()).sort((a, b) => a.localeCompare(b));

    const pipelineFilterSuffix = leadListFilterQuerySuffix(pipelineFilters);

    const leadSourceCounts = {
      all: pipelineVisible.length,
      cold: pipelineVisible.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: pipelineVisible.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

    const queueListLeads = safeTab === 'queue' ? pipelineVisible.map(mapLeadListJson) : null;
    const folderListLeads = safeTab === 'folders' ? visible.map(mapLeadListJson) : null;

    res.render('outreach', {
      title: 'Outreach | Agency OS',
      activePage: 'outreach',
      tab: safeTab,
      leadCount: pipelineVisible.length,
      folders,
      queueListLeads,
      folderListLeads,
      pipelineBoardLeads,
      pipelineStages: PIPELINE_STAGES,
      sourceFilter,
      leadSourceCounts,
      pipelineFilters,
      pipelineStatusOptions,
      pipelineFilterSuffix,
      canManageWorkspace: req.canManageWorkspace,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
