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

/**
 * Reply in Instantly Unibox thread from a lead that previously replied.
 * Body: { leadKey, text, subject? }
 * Uses lead.instantlyLastEmailId + lead.instantlyEmailAccount (from reply webhook).
 */
router.post('/reply', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const leadKey = String(body.leadKey || '').trim();
    const text = String(body.text || body.body || '').trim();
    const subject = String(body.subject || '').trim() || 'Re:';
    if (!leadKey) {
      return res.status(400).json({ success: false, error: 'leadKey is required.' });
    }
    if (!text) {
      return res.status(400).json({ success: false, error: 'Reply text is required.' });
    }
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!instantlyClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Instantly is not connected. Add an API key under Workspace → Integrations.',
      });
    }
    let lead = await dbService.getLead(leadKey, req.workspaceId);
    if (!lead) {
      const resolved = await dbService.resolveLeadStorageKey(leadKey, req.workspaceId);
      if (resolved) lead = await dbService.getLead(resolved, req.workspaceId);
    }
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    const replyToUuid = String(
      body.replyToUuid || lead.instantlyLastEmailId || '',
    ).trim();
    const eaccount = String(
      body.eaccount || lead.instantlyEmailAccount || '',
    ).trim();
    if (!replyToUuid || !eaccount) {
      return res.status(400).json({
        success: false,
        error:
          'No Instantly thread on this lead yet. Wait for a reply webhook (needs email id + sending account), or open Unibox.',
        uniboxUrl: String(lead.instantlyUniboxUrl || '').trim() || undefined,
      });
    }
    const data = await instantlyClient.replyToEmail(integrationEnv, {
      eaccount,
      replyToUuid,
      subject,
      text,
    });
    const at = new Date().toISOString();
    const updates = Array.isArray(lead.updates) ? [...lead.updates] : [];
    updates.push({
      timestamp: at,
      type: 'email_outbound',
      value: text.slice(0, 2000),
      provider: 'instantly',
      instantlyEmailId: replyToUuid,
      channel: 'email',
    });
    await dbService.updateLead(
      lead.key,
      {
        updates,
        lastTouchChannel: 'email',
        logs: [
          {
            type: 'instantly_reply',
            message: 'Replied via Instantly',
            timestamp: at,
          },
        ],
      },
      req.workspaceId,
    );
    return res.json({
      success: true,
      uniboxUrl: String(lead.instantlyUniboxUrl || '').trim() || undefined,
      data: data && typeof data === 'object' ? data : {},
    });
  } catch (e) {
    const status =
      e && (e.code === 'INSTANTLY_NOT_CONFIGURED' || String(e.code || '').startsWith('INSTANTLY_REPLY_'))
        ? 400
        : e && e.status === 401
          ? 401
          : 502;
    return res.status(status).json({
      success: false,
      error: (e && e.message) || 'Instantly reply failed.',
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
