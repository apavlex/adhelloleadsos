const express = require('express');
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { filterLeadsForRequest } = require('../services/workspaceService');
const instantlyClient = require('../services/instantlyClient');
const instantlyExport = require('../services/instantlyExport');

const router = express.Router();

function destinationRows(items, { withStatus }) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const id = String((item && item.id) || '').trim();
      const name = String((item && (item.name || item.title)) || '').trim();
      if (!id || !name) return null;
      const status = withStatus ? instantlyClient.campaignStatusLabel(item.status) : '';
      return { id, name, status };
    })
    .filter(Boolean);
}

router.get('/destinations', async (req, res) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!instantlyClient.isConfigured(integrationEnv)) {
      return res.json({ success: true, configured: false, campaigns: [], lists: [] });
    }
    const [campaigns, lists] = await Promise.all([
      instantlyClient.listCampaigns(integrationEnv),
      instantlyClient.listLeadLists(integrationEnv),
    ]);
    return res.json({
      success: true,
      configured: true,
      campaigns: destinationRows(campaigns, { withStatus: true }),
      lists: destinationRows(lists, { withStatus: false }),
    });
  } catch (e) {
    const status = e && e.status === 401 ? 401 : 502;
    return res.status(status).json({
      success: false,
      error: (e && e.message) || 'Could not load Instantly campaigns.',
    });
  }
});

router.post('/export', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawKeys = Array.isArray(body.leadKeys) ? body.leadKeys : [];
    const leadKeys = [...new Set(rawKeys.map((key) => String(key || '').trim()).filter(Boolean))].slice(
      0,
      instantlyExport.MAX_LEADS,
    );
    if (!leadKeys.length) {
      return res.status(400).json({ success: false, error: 'Select at least one lead.' });
    }
    const campaignId = String(body.campaignId || '').trim();
    const listId = String(body.listId || '').trim();
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const visible = filterLeadsForRequest(req, await dbService.getAllLeads(req.workspaceId));
    const byKey = new Map(visible.map((lead) => [lead.key, lead]));
    const leads = [];
    const missing = [];
    for (const raw of leadKeys) {
      let lead = byKey.get(raw) || byKey.get(raw.replace(/^lead:/i, '')) || byKey.get(`lead:${raw}`);
      if (!lead) {
        // eslint-disable-next-line no-await-in-loop
        const resolved = await dbService.resolveLeadStorageKey(raw, req.workspaceId);
        if (resolved) lead = byKey.get(resolved);
      }
      if (lead) leads.push(lead);
      else missing.push(raw);
    }
    if (!leads.length) {
      return res.status(404).json({ success: false, error: 'None of the selected leads are in this workspace.' });
    }
    const result = await instantlyExport.exportLeads({
      leads,
      campaignId,
      listId,
      integrationEnv,
      markLead: (key, stamp) => dbService.updateLead(key, stamp, req.workspaceId),
    });
    return res.json({ success: true, missing: missing.length, ...result });
  } catch (e) {
    const code = e && e.code;
    const status =
      code === 'INSTANTLY_NOT_CONFIGURED' || (e && e.status === 400)
        ? 400
        : e && e.status === 401
          ? 401
          : 502;
    if (code !== 'INSTANTLY_NOT_CONFIGURED' && !(e && e.status)) {
      console.error('Instantly export failed:', e && e.message ? e.message : e);
    }
    return res.status(status).json({
      success: false,
      error: (e && e.message) || 'Instantly export failed.',
    });
  }
});

module.exports = router;
