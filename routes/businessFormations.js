const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { resolveFormationSearch, runFormationSearchInBackground } = require('../services/leadSourceRuns');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');
const { parseSchedulePayload } = require('../services/scheduleHelpers');

router.post('/search', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const mode = String(req.body.mode || 'run').trim().toLowerCase();
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const resolved = await resolveFormationSearch(wid, req.body, integrationEnv, {
      monitor: mode === 'schedule',
    });
    const renderError = (status, message) =>
      res.status(status).render('error', { message, activePage: 'find' });
    if (!resolved.ok) return renderError(resolved.status, resolved.error);

    const { params, jobParams } = resolved;
    const startRun = () =>
      runFormationSearchInBackground({
        workspaceId: wid,
        integrationEnv,
        resolved,
        actorEmail: userEmail(req),
      });
    const rememberIcp = () =>
      persistWorkspaceIcp(wid, {
        keyword: jobParams.keyword || 'new formations',
        city: '',
        state: jobParams.state,
        qty: params.maxResults,
      });

    if (mode === 'schedule') {
      const parsed = parseSchedulePayload(req.body);
      if (!parsed.ok) return renderError(400, parsed.message);
      if (!resolved.configured) return renderError(503, resolved.notConfiguredError);

      await dbService.saveSchedule({
        ...jobParams,
        monitorMode: true,
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

    if (!resolved.configured) return renderError(503, resolved.notConfiguredError);

    await rememberIcp();
    await startRun();
    const qs = new URLSearchParams({ tab: 'pipeline', preset: 'formations', searchInProgress: '1' });
    if (resolved.folder.targetFolderKey) qs.set('folderKey', resolved.folder.targetFolderKey);
    return res.redirect(`/prospecting?${qs.toString()}`);
  } catch (err) {
    console.error('Business formation search error:', err);
    next(err);
  }
});

module.exports = router;
