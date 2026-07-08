const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { buildDriveImportBundle } = require('../services/googleDriveAccess');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  mapLeadPipelineBootstrap,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
  isCsvImported,
  hasUsableWebsite,
  buildLeadSearchContext,
} = require('../services/leadListFilters');
const { ensurePipelineFolders, migrateLegacyFolders } = require('../services/pipelineFolders');
const { TRADE_FOLDERS } = require('../services/tradeFoldersCatalog');
const { buildFolderTree, buildFolderPickerTree, folderKeysIncludingDescendants, buildFolderAggregateCounts } = require('../services/folderTree');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const { buildOutreachLibrary } = require('../services/outreachChannelScripts');
const { normalizeLeadForPanel } = require('../services/leadPanelNormalize');
const { LMV_PROSPECTING_METHODS } = require('../config/lmvProspectingMethods');

router.get('/', async (req, res, next) => {
  try {
    const tab = String(req.query.tab || 'pipeline').toLowerCase();
    if (tab === 'touches') {
      return res.redirect(302, '/reports?tab=tracker');
    }
    const safeTab = ['queue', 'pipeline', 'folders'].includes(tab) ? tab : 'pipeline';

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const wid = req.workspaceId;
    let folders = await ensurePipelineFolders(wid);
    const migrated = await migrateLegacyFolders(wid, folders);
    folders = migrated.folders;
    const folderTree = buildFolderTree(folders);
    const folderPickerTree = buildFolderPickerTree(folderTree, String(req.query.folderKey || '').trim());
    const tags = await dbService.listTags(wid);

    const scheduleSuccess = req.query.scheduleSuccess === 'true';
    let schedulesSorted = [];
    if (safeTab === 'queue') {
      const allSchedules = await dbService.listSchedules();
      const schedules = allSchedules.filter((s) => (s.workspaceId || 'default') === wid);
      schedulesSorted = [...schedules].sort((a, b) => {
        const t = (s) => {
          const x = Date.parse(String(s.scheduledRunAt || ''));
          return Number.isFinite(x) ? x : Infinity;
        };
        const cmp = t(a) - t(b);
        if (cmp !== 0) return cmp;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
    }

    const leadListFilters = normalizeLeadListFilters(req.query);
    const hasGlobalSearch = !!String(leadListFilters.q || '').trim();
    if (
      safeTab === 'pipeline' &&
      !String(leadListFilters.folderKey || '').trim() &&
      !String(leadListFilters.origin || '').trim() &&
      !hasGlobalSearch &&
      req.query.includeFoldered !== '1' &&
      req.query.includeFoldered !== 'true'
    ) {
      const bizFolder = folders.find(
        (f) => f && f.jobType === 'maps_business' && f.isPipelineDefault,
      );
      if (bizFolder && bizFolder.key) {
        const qs = new URLSearchParams(req.query);
        qs.set('tab', 'pipeline');
        qs.set('folderKey', String(bizFolder.key));
        return res.redirect(302, `/prospecting?${qs.toString()}`);
      }
    }
    const includeFoldered =
      req.query.includeFoldered === '1' ||
      req.query.includeFoldered === 'true' ||
      hasGlobalSearch ||
      String(leadListFilters.origin || '').trim().toLowerCase() === 'csv';
    const activeFolderKey = String(leadListFilters.folderKey || '').trim();
    const folderKeys = activeFolderKey
      ? folderKeysIncludingDescendants(folderTree, activeFolderKey)
      : null;
    if (folderKeys) leadListFilters.folderKeys = folderKeys;
    if (hasGlobalSearch) {
      leadListFilters.searchContext = buildLeadSearchContext(tags, folders);
    }
    const folderMembers = folderKeys
      ? visible.filter((l) => folderKeys.has(String(l.folderKey || '').trim()))
      : null;
    const pipelineBase =
      folderMembers != null
        ? folderMembers
        : includeFoldered
          ? visible
          : pipelineVisible;

    const sourceFilter = String(req.query.source || 'all').toLowerCase();
    let leads = pipelineBase;
    if (sourceFilter === 'inbound') {
      leads = pipelineBase.filter((l) => l.source && l.source.startsWith('adhello_'));
    } else if (sourceFilter === 'cold') {
      leads = pipelineBase.filter((l) => !l.source || !l.source.startsWith('adhello_'));
    }

    leads = applyLeadListFilters(leads, leadListFilters);
    leads = leads.map((l) => normalizeLeadForPanel(l));

    const activeFolder = folders.find((f) => f && String(f.key) === activeFolderKey);
    const originFilter = String(leadListFilters.origin || '').trim().toLowerCase();
    const isBusinessesView =
      (activeFolder && activeFolder.jobType === 'maps_business') ||
      originFilter === 'maps_business' ||
      originFilter === 'maps' ||
      originFilter === 'business';
    if (isBusinessesView) {
      leads.sort((a, b) => {
        const ha = hasUsableWebsite(a) ? 1 : 0;
        const hb = hasUsableWebsite(b) ? 1 : 0;
        if (ha !== hb) return ha - hb;
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, {
          sensitivity: 'base',
        });
      });
    }

    const leadsFilterSuffix = leadListFilterQuerySuffix(leadListFilters);

    const statusUniq = new Map();
    pipelineBase.forEach((l) => {
      const d = displayStatus(l.status);
      statusUniq.set(String(d).toLowerCase(), d);
    });
    const pipelineStatusOptions = Array.from(statusUniq.values()).sort((a, b) => a.localeCompare(b));

    const leadSourceCounts = {
      all: pipelineBase.length,
      cold: pipelineBase.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: pipelineBase.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(wid);
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);
    leads = leads.map((l) => {
      const sid = pipelineStagesService.resolveStageIdForLead(l, stageRows);
      return {
        ...l,
        stageId: sid,
        pipelineStage: pipelineStagesService.stageIndex1Based(stageRows, sid),
      };
    });

    let importNotice = null;
    if (
      ['imported', 'skipped', 'failed', 'rows', 'created', 'updated', 'rawRows', 'rejected'].some(
        (k) => req.query[k] != null && req.query[k] !== ''
      )
    ) {
      const rowsQ = parseInt(req.query.rows, 10);
      const createdQ = parseInt(req.query.created, 10);
      const updatedQ = parseInt(req.query.updated, 10);
      const rawRowsQ = parseInt(req.query.rawRows, 10);
      const rejectedQ = parseInt(req.query.rejected, 10);
      importNotice = {
        imported: Math.max(0, parseInt(req.query.imported, 10) || 0),
        skipped: Math.max(0, parseInt(req.query.skipped, 10) || 0),
        failed: Math.max(0, parseInt(req.query.failed, 10) || 0),
        rows: Number.isNaN(rowsQ) ? null : rowsQ,
        created: Number.isNaN(createdQ) ? null : createdQ,
        updated: Number.isNaN(updatedQ) ? null : updatedQ,
        rawRows: Number.isNaN(rawRowsQ) ? null : rawRowsQ,
        rejected: Number.isNaN(rejectedQ) ? null : rejectedQ,
      };
    }

    const importError =
      typeof req.query.importError === 'string' && req.query.importError.trim()
        ? req.query.importError.trim()
        : null;

    let pipelineMigrateNotice = null;
    if (req.query.pipelineMigrate === '1') {
      pipelineMigrateNotice = {
        total: Math.max(0, parseInt(req.query.migrated, 10) || 0),
        maps: Math.max(0, parseInt(req.query.maps, 10) || 0),
        mobileHomes: Math.max(0, parseInt(req.query.mh, 10) || 0),
        realEstate: Math.max(0, parseInt(req.query.re, 10) || 0),
        skipped: Math.max(0, parseInt(req.query.skipped, 10) || 0),
      };
    }

    const queueListLeads = safeTab === 'queue' ? pipelineVisible.map(mapLeadListJson) : [];
    const folderListLeads = safeTab === 'folders' ? visible.map(mapLeadListJson) : [];
    const leadBootstrapLeads = safeTab === 'pipeline' ? leads.map(mapLeadPipelineBootstrap) : [];

    const directFolderCounts = {};
    if (safeTab === 'folders') {
      for (const lead of visible) {
        const fk = String(lead.folderKey || '').trim();
        if (!fk) continue;
        directFolderCounts[fk] = (directFolderCounts[fk] || 0) + 1;
      }
    }
    const folderAggregateCounts =
      safeTab === 'folders' ? buildFolderAggregateCounts(folderTree, directFolderCounts) : {};

    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedScriptLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const scriptLibraryOfferPicklist = SCRIPT_LIBRARY_KEYS.map((k) => ({
      key: k,
      label: (mergedScriptLibrary[k] && mergedScriptLibrary[k].label) || k,
    }));
    const outreachChannelLibrary = buildOutreachLibrary(mergedScriptLibrary, SCRIPT_LIBRARY_KEYS);

    const email = userEmail(req);
    const driveImport = await buildDriveImportBundle(req, email);

    const folderedLeadCount = visible.filter((l) => String(l.folderKey || '').trim()).length;
    const totalVisibleLeadCount = visible.length;
    const csvImportLeadCount = visible.filter(isCsvImported).length;
    const unfiledLeadCount = pipelineVisible.length;

    res.render('prospecting', {
      title: 'Prospecting | Agency OS',
      activePage: 'prospecting',
      tab: safeTab,
      leadCount: unfiledLeadCount,
      unfiledLeadCount,
      totalVisibleLeadCount,
      folderedLeadCount,
      csvImportLeadCount,
      includeFoldered,
      activeFolderKey,
      isBusinessesView,
      folders,
      folderTree,
      folderAggregateCounts,
      folderPickerTree,
      tradeFolderCount: TRADE_FOLDERS.length,
      tags,
      schedules: schedulesSorted,
      scheduleSuccess,
      queueListLeads,
      folderListLeads,
      leads,
      leadBootstrapLeads,
      sourceFilter,
      leadSourceCounts,
      leadListFilters,
      leadsFilterSuffix,
      pipelineStatusOptions,
      importNotice,
      importError,
      pipelineMigrateNotice,
      pipelineStages,
      scriptLibraryOfferPicklist,
      outreachChannelLibrary,
      lmvProspectingMethods: LMV_PROSPECTING_METHODS,
      sequenceTemplates: req.app.locals.sequenceTemplates || [],
      canManageWorkspace: req.canManageWorkspace,
      driveImport,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
