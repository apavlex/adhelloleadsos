const express = require('express');
const router = express.Router();

const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { filterLeadsForRequest } = require('../services/workspaceService');
const { excludeOutreachFolderLeads } = require('../services/leadListFilters');
const lobClient = require('../services/lobClient');
const lobDirectMail = require('../services/lobDirectMail');

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead && lead.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

function leadKeyFromParam(raw) {
  return String(raw || '').trim();
}

function collectRecentSends(leads, limit = 30) {
  const rows = [];
  for (const lead of leads) {
    const logs = Array.isArray(lead.logs) ? lead.logs : [];
    for (const log of logs) {
      if (!log || log.type !== 'direct_mail_outbound') continue;
      rows.push({
        leadKey: lead.key,
        title: lead.title || 'Lead',
        message: log.message || 'Postcard sent',
        timestamp: log.timestamp || '',
        postcardId: log.postcardId || '',
      });
    }
  }
  rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return rows.slice(0, limit);
}

router.get('/', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);

    const all = await dbService.getAllLeads(req.workspaceId);
    const visible = filterLeadsForRequest(req, all);
    const pipelineVisible = excludeOutreachFolderLeads(visible);
    const mailableLeads = pipelineVisible
      .filter((l) => lobDirectMail.hasMailableAddress(l))
      .map((l) => ({
        key: l.key,
        title: l.title || 'Untitled',
        address: l.address || '',
        city: l.city || '',
        state: l.state || '',
        status: l.status || '',
        nextChannel: l.next_channel || '',
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));

    res.render('direct-mail', {
      activePage: 'direct-mail',
      lobReady: ready,
      mailableLeads,
      recentSends: collectRecentSends(visible),
      canManageWorkspace: !!req.canManageWorkspace,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/status', async (req, res, next) => {
  try {
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    const ready = lobDirectMail.directMailReady(integrationEnv);
    res.json({ success: true, ...ready });
  } catch (err) {
    next(err);
  }
});

router.post('/api/send', async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body && req.body.keys)
      ? req.body.keys.map((k) => String(k || '').trim()).filter(Boolean)
      : req.body && req.body.key
        ? [String(req.body.key).trim()].filter(Boolean)
        : [];
    if (!keys.length) {
      return res.status(400).json({ success: false, error: 'Select at least one lead.' });
    }

    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    if (!lobClient.isConfigured(integrationEnv)) {
      return res.status(400).json({
        success: false,
        error: 'Connect Lob in Workspace → Integrations before sending mail.',
      });
    }

    const headline = String((req.body && req.body.headline) || '').trim();
    const bodyText = String((req.body && req.body.bodyText) || '').trim();
    const ctaUrl = String((req.body && req.body.ctaUrl) || '').trim();

    const results = [];
    for (const key of keys) {
      const fullKey = leadKeyFromParam(key);
      const lead = await dbService.getLead(fullKey);
      if (!lead) {
        results.push({ key: fullKey, ok: false, error: 'Lead not found' });
        continue;
      }
      try {
        const sent = await lobDirectMail.sendPostcardToLead({
          lead,
          integrationEnv,
          headline: headline || undefined,
          bodyText: bodyText || undefined,
          ctaUrl: ctaUrl || undefined,
        });
        const updates = appendLeadUpdate(lead, {
          type: 'direct_mail_outbound',
          value: sent.postcardId || 'postcard',
          provider: 'lob',
          postcardId: sent.postcardId || '',
        });
        await dbService.updateLead(fullKey, {
          status: lead.status === 'Not Contacted' ? 'Mail Sent' : lead.status,
          updates,
          logs: [
            {
              type: 'direct_mail_outbound',
              message: `Lob postcard queued${sent.postcardId ? ` (${sent.postcardId})` : ''}${sent.testMode ? ' [test]' : ''}`,
              timestamp: new Date().toISOString(),
              postcardId: sent.postcardId || '',
              provider: 'lob',
            },
          ],
        });
        results.push({
          key: fullKey,
          ok: true,
          postcardId: sent.postcardId,
          expectedDeliveryDate: sent.expectedDeliveryDate,
          testMode: sent.testMode,
        });
      } catch (e) {
        results.push({ key: fullKey, ok: false, error: e && e.message ? e.message : 'Send failed' });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    res.json({
      success: okCount > 0,
      sent: okCount,
      failed: results.length - okCount,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
