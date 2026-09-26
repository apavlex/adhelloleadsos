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
  buildPipelineCategoryOptions,
} = require('../services/leadListFilters');
const { normalizeProspectingSettings } = require('../services/prospectGapLabels');
const { listAutomationsForWorkspace } = require('../services/automationsRegistry');
const { ensurePipelineFolders, migrateLegacyFolders } = require('../services/pipelineFolders');
const { TRADE_FOLDERS } = require('../services/tradeFoldersCatalog');
const {
  buildFolderTree,
  buildFolderPickerTree,
  folderKeysIncludingDescendants,
  buildFolderAggregateCounts,
  buildFolderAggregateTags,
} = require('../services/folderTree');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const { buildOutreachLibrary } = require('../services/outreachChannelScripts');
const { resolveScriptSignOffProfile, applySenderPlaceholdersDeep } = require('../services/scriptPlaceholders');
const { normalizeLeadForPanel } = require('../services/leadPanelNormalize');
const { LMV_PROSPECTING_METHODS } = require('../config/lmvProspectingMethods');
const { normalizeBoards } = require('../services/opportunityBoards');

/** First-paint HTML rows — remaining rows load via /prospecting/table-rows. */
const PIPELINE_SSR_ROW_CAP = Math.min(
  200,
  Math.max(25, parseInt(process.env.PIPELINE_SSR_ROW_CAP || '50', 10) || 50),
);

router.get('/', async (req, res, next) => {
  try {
    const tab = String(req.query.tab || 'pipeline').toLowerCase();
    if (tab === 'touches') {
      return res.redirect(302, '/reports?tab=tracker');
    }
    const safeTab = ['queue', 'pipeline', 'folders'].includes(tab) ? tab : 'pipeline';
    const wid = req.workspaceId;

    const [all, foldersInitial, tags, wsRaw] = await Promise.all([
      dbService.getAllLeads(wid),
      ensurePipelineFolders(wid),
      dbService.listTags(wid),
      dbService.getWorkspace(wid),
    ]);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    let folders = foldersInitial;
    const migrated = await migrateLegacyFolders(wid, folders);
    folders = migrated.folders;
    let folderTree = buildFolderTree(folders);
    const folderPickerTree = buildFolderPickerTree(folderTree, String(req.query.folderKey || '').trim());
    const ws = wsRaw;
    const workspaceProspecting = normalizeProspectingSettings(ws && ws.prospecting);
    const opportunityNormalized = normalizeBoards(ws && ws.opportunityBoards);
    if (ws && opportunityNormalized.created) {
      ws.opportunityBoards = opportunityNormalized.boards;
      await dbService.saveWorkspace(wid, ws);
    }
    const opportunityBoards = opportunityNormalized.boards;

    const scheduleSuccess = req.query.scheduleSuccess === 'true';
    let schedulesSorted = [];
    let queueOutreachAutomations = [];
    let queueOutreachSummary = { running: 0, paused: 0, enrolled: 0 };
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

      const { automations, summary } = await listAutomationsForWorkspace(wid);
      queueOutreachAutomations = automations.filter((a) => a.type === 'outreach');
      queueOutreachSummary = {
        running: queueOutreachAutomations.filter((a) => a.status === 'running').length,
        paused: queueOutreachAutomations.filter((a) => a.status === 'paused').length,
        enrolled: queueOutreachAutomations.reduce(
          (sum, a) => sum + (Number(a.leadsEnrolled) || 0),
          0,
        ),
      };
    }

    const leadListFilters = normalizeLeadListFilters(req.query);
    const hasGlobalSearch = !!String(leadListFilters.q || '').trim();
    // Apply default Businesses folder in-process — avoid a second full page load via redirect.
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
        leadListFilters.folderKey = String(bizFolder.key);
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
      leadListFilters.searchContext = buildLeadSearchContext(tags, folders, { workspace: ws });
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

    const activeFolder = folders.find((f) => f && String(f.key) === activeFolderKey);
    const originFilter = String(leadListFilters.origin || '').trim().toLowerCase();
    const isBusinessesView =
      (activeFolder && activeFolder.jobType === 'maps_business') ||
      originFilter === 'maps_business' ||
      originFilter === 'maps' ||
      originFilter === 'business';
    const isPermitsView =
      (activeFolder && activeFolder.jobType === 'permits') ||
      originFilter === 'permits' ||
      originFilter === 'permit_stack' ||
      String(req.query.preset || '').trim().toLowerCase() === 'permits';
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
    const pipelineCategoryOptions = buildPipelineCategoryOptions(pipelineBase);

    const leadSourceCounts = {
      all: pipelineBase.length,
      cold: pipelineBase.filter((l) => !l.source || !l.source.startsWith('adhello_')).length,
      inbound: pipelineBase.filter((l) => l.source && l.source.startsWith('adhello_')).length,
    };

    const email = userEmail(req);
    const [stageRows, driveImport] = await Promise.all([
      pipelineStagesService.ensureWorkspaceStagesSeeded(wid),
      buildDriveImportBundle(req, email),
    ]);
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);

    const pipelineLeadsTotal = leads.length;
    const ssrCap =
      safeTab === 'pipeline' ? Math.min(PIPELINE_SSR_ROW_CAP, pipelineLeadsTotal) : pipelineLeadsTotal;
    // Normalize + stage-resolve only what we ship in HTML / bootstrap paths that need it.
    const decorateLead = (l) => {
      const normalized = normalizeLeadForPanel(l);
      const sid = pipelineStagesService.resolveStageIdForLead(normalized, stageRows);
      return {
        ...normalized,
        stageId: sid,
        pipelineStage: pipelineStagesService.stageIndex1Based(stageRows, sid),
      };
    };
    const ssrLeads = leads.slice(0, ssrCap).map(decorateLead);
    // Full filtered list for client bootstrap / kanban (slim map — no full panel normalize).
    const bootstrapSource =
      safeTab === 'pipeline'
        ? leads.map((l) => {
            const sid = pipelineStagesService.resolveStageIdForLead(l, stageRows);
            return {
              ...l,
              stageId: sid,
              pipelineStage: pipelineStagesService.stageIndex1Based(stageRows, sid),
            };
          })
        : [];
    leads = ssrLeads;

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
    const leadBootstrapLeads =
      safeTab === 'pipeline' ? bootstrapSource.map(mapLeadPipelineBootstrap) : [];
    const opportunityBoardLeads =
      safeTab === 'pipeline'
        ? visible
            .filter((lead) => lead && String(lead.opportunityPipelineId || '').trim())
            .map(mapLeadPipelineBootstrap)
        : [];

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
    // Keep name order from buildFolderTree — client "Organize by leads" toggles lead-count sort.

    const activeTagCatalog = tags.filter((t) => t && t.isActive !== false);
    const tagCatalogByKey = Object.fromEntries(
      activeTagCatalog.map((t) => [
        t.key,
        { key: t.key, name: t.name, color: t.color || '#94a3b8' },
      ])
    );
    const tagLookup = { ...tagCatalogByKey };
    for (const t of activeTagCatalog) {
      const suffix = String(t.key || '').replace(/^tag:[^:]+:/, '');
      if (suffix && !tagLookup[suffix]) {
        tagLookup[suffix] = tagCatalogByKey[t.key];
      }
    }
    const directFolderTagKeys = {};
    if (safeTab === 'folders') {
      for (const lead of visible) {
        const fk = String(lead.folderKey || '').trim();
        if (!fk) continue;
        for (const tk of dbService.normalizeTagKeys(lead.tags)) {
          const hit = tagLookup[tk] || tagLookup[String(tk).replace(/^tag:[^:]+:/, '')];
          if (!hit) continue;
          if (!directFolderTagKeys[fk]) directFolderTagKeys[fk] = new Set();
          directFolderTagKeys[fk].add(hit.key);
        }
      }
    }
    const folderAggregateTags =
      safeTab === 'folders'
        ? buildFolderAggregateTags(folderTree, directFolderTagKeys, tagCatalogByKey)
        : {};

    const mergedScriptLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const offerKeys = salesScriptsStorage.getWorkspaceScriptKeys(ws, SCRIPT_LIBRARY);
    const scriptLibraryOfferPicklist = offerKeys.map((k) => ({
      key: k,
      label: (mergedScriptLibrary[k] && mergedScriptLibrary[k].label) || k,
    }));
    const outreachChannelLibrary = applySenderPlaceholdersDeep(
      buildOutreachLibrary(mergedScriptLibrary, offerKeys),
      resolveScriptSignOffProfile({ user: req.user, workspace: ws }),
    );

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
      isPermitsView,
      folders,
      folderTree,
      folderAggregateCounts,
      folderAggregateTags,
      folderPickerTree,
      tradeFolderCount: TRADE_FOLDERS.length,
      tags,
      schedules: schedulesSorted,
      scheduleSuccess,
      queueOutreachAutomations,
      queueOutreachSummary,
      queueListLeads,
      folderListLeads,
      leads,
      leadBootstrapLeads,
      sourceFilter,
      leadSourceCounts,
      leadListFilters,
      leadsFilterSuffix,
      pipelineStatusOptions,
      pipelineCategoryOptions,
      importNotice,
      importError,
      pipelineMigrateNotice,
      pipelineStages,
      opportunityBoards,
      opportunityBoardLeads,
      scriptLibraryOfferPicklist,
      outreachChannelLibrary,
      lmvProspectingMethods: LMV_PROSPECTING_METHODS,
      sequenceTemplates: req.app.locals.sequenceTemplates || [],
      canManageWorkspace: req.canManageWorkspace,
      driveImport,
      workspaceProspecting,
      pipelineLeadsTotal: safeTab === 'pipeline' ? pipelineLeadsTotal : leads.length,
      pipelineSsrOffset: 0,
      pipelineSsrHasMore: safeTab === 'pipeline' && pipelineLeadsTotal > ssrCap,
      pipelineRowsQuery:
        safeTab === 'pipeline'
          ? [
              'tab=pipeline',
              sourceFilter && sourceFilter !== 'all' ? `source=${encodeURIComponent(sourceFilter)}` : '',
              includeFoldered ? 'includeFoldered=1' : '',
              leadsFilterSuffix ? leadsFilterSuffix.replace(/^&/, '') : '',
            ]
              .filter(Boolean)
              .join('&')
          : '',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * HTML fragment of additional pipeline table rows (Load more).
 * Query: offset, limit, same filters as /prospecting?tab=pipeline.
 */
router.get('/table-rows', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || PIPELINE_SSR_ROW_CAP),
    );

    const [all, foldersInitial, tags, stageRows, ws] = await Promise.all([
      dbService.getAllLeads(wid),
      ensurePipelineFolders(wid),
      dbService.listTags(wid),
      pipelineStagesService.ensureWorkspaceStagesSeeded(wid),
      dbService.getWorkspace(wid),
    ]);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const migrated = await migrateLegacyFolders(wid, foldersInitial);
    const folders = migrated.folders;
    const folderTree = buildFolderTree(folders);

    const leadListFilters = normalizeLeadListFilters(req.query);
    const hasGlobalSearch = !!String(leadListFilters.q || '').trim();
    if (
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
        leadListFilters.folderKey = String(bizFolder.key);
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
      leadListFilters.searchContext = buildLeadSearchContext(tags, folders, { workspace: ws });
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

    const total = leads.length;
    const slice = leads.slice(offset, offset + limit).map((l) => {
      const normalized = normalizeLeadForPanel(l);
      const sid = pipelineStagesService.resolveStageIdForLead(normalized, stageRows);
      return {
        ...normalized,
        stageId: sid,
        pipelineStage: pipelineStagesService.stageIndex1Based(stageRows, sid),
      };
    });
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < total;

    res.set({
      'Cache-Control': 'private, no-store',
      'X-Pipeline-Total': String(total),
      'X-Pipeline-Offset': String(offset),
      'X-Pipeline-Next-Offset': String(nextOffset),
      'X-Pipeline-Has-More': hasMore ? '1' : '0',
      'X-Pipeline-Count': String(slice.length),
    });
    res.render('partials/pipeline_lead_rows', {
      leads: slice,
      pipelineStages,
      tags,
      rowIndexOffset: offset,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
