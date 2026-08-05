const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const businessFormationSearch = require('../services/businessFormationSearch');
const { persistFormationSearchResults } = require('../services/businessFormationPersist');
const { resolveTargetFolder } = require('../services/pipelineFolders');
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const { parseSchedulePayload } = require('../services/scheduleHelpers');

router.post('/search', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const mode = String(req.body.mode || 'run').trim().toLowerCase();
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const params = businessFormationSearch.parseSearchParamsFromBody(req.body);

    if (!params.stateCodes.length) {
      return res.status(400).render('error', {
        message: 'Select at least one supported state (NY, CO, PA, CT, OR).',
        activePage: 'find',
      });
    }

    const folderResolved = await resolveTargetFolder(wid, {
      folderKey: req.body.folderKey,
      newFolderName: req.body.newFolderName,
      jobType: JOB_TYPES.BUSINESS_FORMATIONS,
      state: params.stateCodes.join(','),
    });
    if (folderResolved.error) {
      return res.status(400).render('error', {
        message: folderResolved.error,
        activePage: 'find',
      });
    }

    const scheduleMonitor =
      mode === 'schedule' ? true : params.monitorMode;
    const searchParams = {
      ...params,
      monitorMode: scheduleMonitor,
      registeredAfterDays: scheduleMonitor ? 30 : 30,
    };

    const jobParams = {
      jobType: JOB_TYPES.BUSINESS_FORMATIONS,
      stateCodes: params.stateCodes,
      entityTypes: params.entityTypes,
      formationKeyword: params.keyword,
      keyword: businessFormationSearch.scheduleKeywordLabel(searchParams),
      registeredAfter: params.registeredAfter,
      monitorMode: scheduleMonitor,
      maxResults: params.maxResults,
      targetFolderKey: folderResolved.targetFolderKey,
      targetFolderName: folderResolved.targetFolderName,
      workspaceId: wid,
      city: '',
      state: params.stateCodes.join(', '),
    };

    async function startBackgroundFormationRun() {
      if (!businessFormationSearch.isConfigured(integrationEnv)) {
        await dbService.clearActiveJob({
          failed: true,
          error:
            'Business formation search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
        });
        return;
      }

      await dbService.setActiveJob({
        type: 'business_formations_search',
        jobType: JOB_TYPES.BUSINESS_FORMATIONS,
        state: jobParams.state,
        keyword: businessFormationSearch.scheduleKeywordLabel(searchParams),
        maxResults: params.maxResults,
        targetFolderKey: folderResolved.targetFolderKey,
        targetFolderName: folderResolved.targetFolderName,
        formationStates: params.stateCodes,
        monitorMode: scheduleMonitor,
      });

      setImmediate(async () => {
        try {
          const { results, input } = await businessFormationSearch.searchBusinessFormations(
            searchParams,
            integrationEnv
          );
          const { savedCount, leadRows } = await persistFormationSearchResults(
            wid,
            {
              targetFolderKey: folderResolved.targetFolderKey,
              stateCodes: params.stateCodes,
            },
            results
          );

          const searchRecord = {
            jobType: JOB_TYPES.BUSINESS_FORMATIONS,
            keyword: businessFormationSearch.scheduleKeywordLabel(searchParams),
            stateCodes: params.stateCodes,
            entityTypes: params.entityTypes,
            formationKeyword: params.keyword,
            registeredAfter: input.registeredAfter,
            monitorMode: !!input.monitorMode,
            maxResults: params.maxResults,
            targetFolderKey: folderResolved.targetFolderKey,
            targetFolderName: folderResolved.targetFolderName,
            resultCount: leadRows.length,
            savedCount,
            results: leadRows,
            timestamp: new Date().toISOString(),
            workspaceId: wid,
          };
          const searchKey = await dbService.saveSearch(searchRecord);
          if (userEmail(req)) await activationService.recordEvent(userEmail(req), 'search_saved');
          await dbService.clearActiveJob({
            resultCount: leadRows.length,
            savedCount,
            searchKey,
            note: leadRows.length === 0 ? 'No new formations in this run (monitor mode may return zero).' : undefined,
          });
        } catch (err) {
          console.error('[FORMATIONS-BG] Business formation search failed:', err);
          const msg = err && err.message ? String(err.message) : 'Formation search failed';
          await dbService.clearActiveJob({ failed: true, error: msg });
        }
      });
    }

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).render('error', {
          message: parsed.message,
          activePage: 'find',
        });
      }

      if (!businessFormationSearch.isConfigured(integrationEnv)) {
        return res.status(503).render('error', {
          message:
            'Business formation search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
          activePage: 'find',
        });
      }

      await dbService.saveSchedule({
        ...jobParams,
        keyword: businessFormationSearch.scheduleKeywordLabel(searchParams),
        monitorMode: true,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        workspaceId: wid,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      await persistWorkspaceIcp(wid, {
        keyword: jobParams.keyword || 'new formations',
        city: '',
        state: jobParams.state,
        qty: params.maxResults,
      });

      const runNowAlso = String(req.body.runNowAlso || '').toLowerCase() === 'on';
      if (runNowAlso) {
        await startBackgroundFormationRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    if (!businessFormationSearch.isConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message:
          'Business formation search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.',
        activePage: 'find',
      });
    }

    await persistWorkspaceIcp(wid, {
      keyword: jobParams.keyword || 'new formations',
      city: '',
      state: jobParams.state,
      qty: params.maxResults,
    });
    await startBackgroundFormationRun();
    const qs = new URLSearchParams({ tab: 'pipeline', preset: 'formations', searchInProgress: '1' });
    if (folderResolved.targetFolderKey) qs.set('folderKey', folderResolved.targetFolderKey);
    return res.redirect(`/prospecting?${qs.toString()}`);
  } catch (err) {
    console.error('Business formation search error:', err);
    next(err);
  }
});

module.exports = router;
