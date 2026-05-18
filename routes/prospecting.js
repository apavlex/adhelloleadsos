const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { getPublicBaseUrl, googleOAuthRedirectUris } = require('../lib/publicBaseUrl');
const {
  displayStatus,
  applyLeadListFilters,
  mapLeadListJson,
  normalizeLeadListFilters,
  leadListFilterQuerySuffix,
  excludeOutreachFolderLeads,
} = require('../services/leadListFilters');
const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
const salesScriptsStorage = require('../services/salesScriptsStorage');
const { buildOutreachLibrary } = require('../services/outreachChannelScripts');

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

    const queueListLeads = pipelineVisible.map(mapLeadListJson);
    const folderListLeads = visible.map(mapLeadListJson);

    const ws = await dbService.getWorkspace(req.workspaceId);
    const mergedScriptLibrary = salesScriptsStorage.buildMergedScriptLibrary(ws, SCRIPT_LIBRARY);
    const scriptLibraryOfferPicklist = SCRIPT_LIBRARY_KEYS.map((k) => ({
      key: k,
      label: (mergedScriptLibrary[k] && mergedScriptLibrary[k].label) || k,
    }));
    const outreachChannelLibrary = buildOutreachLibrary(mergedScriptLibrary, SCRIPT_LIBRARY_KEYS);

    const email = userEmail(req);
    const driveTokens = email ? await dbService.getGoogleDriveTokens(email) : null;
    const oauthBase = getPublicBaseUrl(req);
    const driveImport = {
      pickerReady: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_PICKER_API_KEY
      ),
      connected: !!(driveTokens && driveTokens.refreshToken),
      driveConnectedBanner: req.query.driveConnected === '1',
      driveOAuthError: req.query.driveError === 'oauth',
      oauthRedirects: googleOAuthRedirectUris(oauthBase),
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      pickerApiKey: process.env.GOOGLE_PICKER_API_KEY || '',
      setupHint:
        Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) &&
        !process.env.GOOGLE_PICKER_API_KEY,
    };

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
      scriptLibraryOfferPicklist,
      outreachChannelLibrary,
      sequenceTemplates: req.app.locals.sequenceTemplates || [],
      canManageWorkspace: req.canManageWorkspace,
      driveImport,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
