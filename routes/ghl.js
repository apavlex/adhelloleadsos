/**
 * Go High Level sync — authenticated UI routes for push/pull.
 */

const express = require('express');
const router = express.Router();
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlSync = require('../services/ghlSync');
const ghlClient = require('../services/ghlClient');
const { patchLeadDispositionForGhlPush, appendPanelNoteBeforeGhlPush } = require('../services/ghlProspectSync');

router.get('/status', async (req, res) => {
  try {
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const status = ghlSync.statusFromEnv(integrationEnv);
    const verify = String(req.query.verify || '').trim() === '1';
    if (verify && status.configured) {
      try {
        const test = await ghlClient.testConnection(integrationEnv);
        status.connected = true;
        status.connectionMessage = test.message || 'Connected';
      } catch (e) {
        status.connected = false;
        status.connectionError = e && e.message ? e.message : 'Connection test failed';
      }
    }
    return res.json({
      success: true,
      workspaceId: wid,
      ...status,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'status_failed' });
  }
});

router.post('/push', express.json(), async (req, res, next) => {
  try {
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const disposition = String(body.disposition || '').trim().toLowerCase();
    const dispositionNotes = String(body.dispositionNotes || body.notes || '').trim();
    const pendingNote = String(body.pendingNote || body.syncNote || '').trim();
    const leadKeys = Array.isArray(body.leadKeys) ? body.leadKeys : [];
    if (disposition && leadKeys.length) {
      for (const leadKey of leadKeys) {
        // eslint-disable-next-line no-await-in-loop
        await patchLeadDispositionForGhlPush({
          leadKey,
          code: disposition,
          notes: dispositionNotes,
          workspaceId: wid,
        });
      }
    } else if (pendingNote && leadKeys.length) {
      for (const leadKey of leadKeys) {
        // eslint-disable-next-line no-await-in-loop
        await appendPanelNoteBeforeGhlPush({
          leadKey,
          content: pendingNote,
          workspaceId: wid,
        });
      }
    }
    const result = await ghlSync.pushLeads({
      workspaceId: wid,
      integrationEnv,
      leadKeys: body.leadKeys,
      limit: body.limit,
      tagNoWebsite: body.tagNoWebsite === true || body.tagNoWebsite === '1',
    });
    const requested = Array.isArray(body.leadKeys) ? body.leadKeys.filter(Boolean).length : 0;
    if (requested > 0 && result.pushed === 0) {
      const firstErr = (result.results || []).find((r) => r && r.ok === false);
      return res.status(422).json({
        success: false,
        error: (firstErr && firstErr.error) || 'GHL sync failed for the requested lead.',
        ...result,
      });
    }
    return res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.post('/pull', express.json(), async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can sync from GHL.' });
    }
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await ghlSync.pullContacts({
      workspaceId: wid,
      integrationEnv,
      limit: body.limit,
      maxPages: body.maxPages,
      startAfterId: body.startAfterId,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.post('/sync', express.json(), async (req, res, next) => {
  try {
    if (!req.canManageWorkspace) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can sync with GHL.' });
    }
    const wid = req.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const direction = String(body.direction || 'both').toLowerCase();
    const opts = {
      workspaceId: wid,
      integrationEnv,
      leadKeys: body.leadKeys,
      limit: body.limit,
      maxPages: body.maxPages,
      pushLimit: body.pushLimit,
      pullMaxPages: body.pullMaxPages,
    };
    if (direction === 'push') {
      const push = await ghlSync.pushLeads(opts);
      return res.json({ success: true, push });
    }
    if (direction === 'pull') {
      const pull = await ghlSync.pullContacts(opts);
      return res.json({ success: true, pull });
    }
    const result = await ghlSync.syncBoth(opts);
    return res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
