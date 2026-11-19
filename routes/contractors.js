const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { resolveContractorSearch, runContractorSearchInBackground } = require('../services/leadSourceRuns');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const { parseSchedulePayload } = require('../services/scheduleHelpers');

router.post('/search', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const mode = String(req.body.mode || 'run').trim().toLowerCase();
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const resolved = await resolveContractorSearch(wid, req.body);
    const renderError = (status, message) =>
      res.status(status).render('error', { message, activePage: 'find' });
    if (!resolved.ok) return renderError(resolved.status, resolved.error);

    const { params, jobParams } = resolved;
    const startRun = () =>
      runContractorSearchInBackground({
        workspaceId: wid,
        integrationEnv,
        resolved,
        actorEmail: userEmail(req),
      });
    const rememberIcp = () =>
      persistWorkspaceIcp(wid, {
        keyword: jobParams.keyword || 'licensed contractors',
        city: jobParams.city || '',
        state: jobParams.state || '',
        qty: params.maxResults,
      });

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) return renderError(400, parsed.message);
      await dbService.saveSchedule({
        ...jobParams,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        workspaceId: wid,
      });
      await activationService.recordEvent(userEmail(req), 'autopilot_scheduled');
      await rememberIcp();
      const runNowAlso = String(req.body.runNowAlso || '').toLowerCase() === 'on';
      if (runNowAlso) {
        await startRun();
        return res.redirect('/today?searchInProgress=1&scheduleSaved=1');
      }
      return res.redirect('/prospecting?tab=queue&scheduleSuccess=true');
    }

    await rememberIcp();
    await startRun();
    const qs = new URLSearchParams({ searchInProgress: '1' });
    if (params.splitByTrade) {
      qs.set('tab', 'folders');
    } else {
      qs.set('tab', 'pipeline');
      if (resolved.folder.targetFolderKey) qs.set('folderKey', resolved.folder.targetFolderKey);
    }
    return res.redirect(`/prospecting?${qs.toString()}`);
  } catch (err) {
    console.error('Contractor license search error:', err);
    next(err);
  }
});

module.exports = router;
