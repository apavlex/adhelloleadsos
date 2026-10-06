const express = require('express');
const router = express.Router();
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { resolvePermitSearch, runPermitSearchInBackground } = require('../services/leadSourceRuns');
const { userEmail } = require('../services/workspaceService');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');

router.post('/search', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const body = req.body || {};
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    const resolved = await resolvePermitSearch(
      wid,
      {
        city: body.city || body.permitCity,
        state: body.state,
        category: body.category,
        keyword: body.permitKeyword || body.keyword,
        contractor: body.contractor,
        zip: body.zip,
        filedAfter: body.filed_after,
        maxResults: body.maxResults,
        folderKey: body.folderKey,
        newFolderName: body.newFolderName,
      },
      integrationEnv
    );
    if (!resolved.ok) {
      return res.status(resolved.status).render('error', { message: resolved.error, activePage: 'find' });
    }
    const { params, folder } = resolved;

    await persistWorkspaceIcp(wid, {
      keyword: params.category || params.keyword || 'permits',
      city: params.city,
      state: params.state,
      qty: params.maxResults,
    });
    await runPermitSearchInBackground({
      workspaceId: wid,
      integrationEnv,
      params,
      folder,
      actorEmail: userEmail(req),
    });
    const qs = new URLSearchParams({ tab: 'pipeline', preset: 'permits', searchInProgress: '1' });
    if (folder.targetFolderKey) qs.set('folderKey', folder.targetFolderKey);
    res.redirect(`/prospecting?${qs.toString()}`);
  } catch (err) {
    console.error('Permit search error:', err);
    next(err);
  }
});

module.exports = router;
