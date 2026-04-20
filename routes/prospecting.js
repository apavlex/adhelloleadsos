const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
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
    const tab = String(req.query.tab || 'pipeline').toLowerCase();
    if (tab === 'touches') {
      return res.redirect(302, '/analytics?tab=tracker');
    }
    const safeTab = ['queue', 'pipeline', 'folders'].includes(tab) ? tab : 'pipeline';

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const wid = req.workspaceId;
    const folders = await dbService.listFolders(wid);

    const allSchedules = await dbService.listSchedules();
    const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);
    const scheduleSuccess = req.query.scheduleSuccess === 'true';
    const schedulesSorted = [...schedules].sort((a, b) => {
      const t = (s) => {
        const x = Date.parse(String(s.scheduledRunAt || ''));
        return Number.isFinite(x) ? x : Infinity;
      };
      const cmp = t(a) - t(b);
      if (cmp !== 0) return cmp;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    const leadListFilters = normalizeLeadListFilters(req.query);
    const activeFolderKey = String(leadListFilters.folderKey || '').trim();
    const folderMembers = activeFolderKey
      ? visible.filter((l) => String(l.folderKey || '').trim() === activeFolderKey)
      : null;
    const pipelineBase = folderMembers != null ? folderMembers : pipelineVisible;

    const sourceFilter = String(req.query.source || 'all').toLowerCase();
    let leads = pipelineBase;
    if (sourceFilter === 'inbound') {
      leads = pipelineBase.filter((l) => l.source && l.source.startsWith('adhello_'));
    } else if (sourceFilter === 'cold') {
      leads = pipelineBase.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    }

    leads = applyLeadListFilters(leads, leadListFilters);
    const leadsFilterSuffix = leadListFilterQuerySuffix(leadListFilters);

    const statusUniq = new Map();
    pipelineBase.forEach((l) => {
      const d = displayStatus(l.status);
      statusUniq.set(d.toLowerCase(), d);
    });
    const pipelineStatusOptions = Array.from(statusUniq.values()).sort((a, b) => a.localeCompare(b));

    const leadSourceCounts = {
      all: pipelineBase.length,
      cold: pipelineBase.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: pipelineBase.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(wid);
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);

    let importNotice = null;
    if (
      ['imported', 'skipped', 'failed', 'rows', 'created', 'updated'].some(
        (k) => req.query[k] != null && req.query[k] !== ''
      )
    ) {
      const rowsQ = parseInt(req.query.rows, 10);
      const createdQ = parseInt(req.query.created, 10);
      const updatedQ = parseInt(req.query.updated, 10);
      importNotice = {
        imported: Math.max(0, parseInt(req.query.imported, 10) || 0),
        skipped: Math.max(0, parseInt(req.query.skipped, 10) || 0),
        failed: Math.max(0, parseInt(req.query.failed, 10) || 0),
        rows: Number.isNaN(rowsQ) ? null : rowsQ,
        created: Number.isNaN(createdQ) ? null : createdQ,
        updated: Number.isNaN(updatedQ) ? null : updatedQ,
      };
    }

    const importError =
      typeof req.query.importError === 'string' && req.query.importError.trim()
        ? req.query.importError.trim()
        : null;

    const queueListLeads = pipelineVisible.map(mapLeadListJson);
    const folderListLeads = visible.map(mapLeadListJson);

    res.render('prospecting', {
      title: 'Prospecting | Agency OS',
      activePage: 'prospecting',
      tab: safeTab,
      leadCount: pipelineVisible.length,
      activeFolderKey,
      folders,
      schedules: schedulesSorted,
      scheduleSuccess,
      queueListLeads,
      folderListLeads,
      leads,
      sourceFilter,
      leadSourceCounts,
      leadListFilters,
      leadsFilterSuffix,
      pipelineStatusOptions,
      importNotice,
      importError,
      pipelineStages,
      canManageWorkspace: req.canManageWorkspace,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
