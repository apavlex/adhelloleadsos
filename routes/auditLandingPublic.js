const express = require('express');
const dbService = require('../services/database');
const { verifyAuditReportToken } = require('../services/auditReportSign');
const { normalizeAuditLanding, materializeLandingCopy, buildHostedReportUrl } = require('../services/auditLandingPage');
const { applyEngagementSignal } = require('../services/engagementSignals');

const router = express.Router();

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function loadLeadForToken(token) {
  const payload = verifyAuditReportToken(token);
  if (!payload) return { error: 'invalid', payload: null, lead: null, workspace: null };
  const lead = await dbService.getLead(payload.leadKey);
  if (!lead || String(lead.workspaceId || '') !== String(payload.workspaceId)) {
    return { error: 'notfound', payload, lead: null, workspace: null };
  }
  const workspace = (await dbService.getWorkspace(payload.workspaceId)) || { id: payload.workspaceId };
  return { error: null, payload, lead, workspace };
}

function appendLeadUpdate(lead, entry) {
  const updates = Array.isArray(lead?.updates) ? [...lead.updates] : [];
  updates.push({ timestamp: new Date().toISOString(), ...entry });
  return updates;
}

router.get('/audit/request/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, workspace } = await loadLeadForToken(token);
    if (error === 'invalid' || error === 'notfound') {
      return res.status(404).render('audit_request', { invalid: true, vm: null, token: '' });
    }

    const config = normalizeAuditLanding(workspace.auditLandingPage);
    if (!config.enabled) {
      const hasAnalysis = !!(lead.aiWebsiteAnalysis && typeof lead.aiWebsiteAnalysis === 'object');
      if (hasAnalysis) {
        return res.redirect(302, `/audit/report/${encodeURIComponent(token)}`);
      }
      return res.status(404).render('audit_request', { invalid: true, vm: null, token: '' });
    }

    const vm = materializeLandingCopy(config, lead);
    const prefill = {
      name: String(lead.contactName || '').trim(),
      email: String(lead.email || '').trim().replace(/^N\/A$/i, ''),
      phone: String(lead.phone || '').trim().replace(/^N\/A$/i, ''),
      company: String(lead.title || '').trim(),
      message: '',
    };

    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('audit_request', {
      invalid: false,
      submitted: false,
      token,
      vm,
      config,
      prefill,
      leadTitle: String(lead.title || 'your business').trim(),
      workspaceName: String(workspace.name || '').trim(),
    });
  } catch (err) {
    console.error('[audit-request-get]', err);
    return res.status(500).render('audit_request', { invalid: true, vm: null, token: '' });
  }
});

router.post('/audit/request/:token', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const token = req.params.token;
    const { error, payload, lead, workspace } = await loadLeadForToken(token);
    if (error === 'invalid' || error === 'notfound') {
      return res.status(404).render('audit_request', { invalid: true, vm: null, token: '' });
    }

    const config = normalizeAuditLanding(workspace.auditLandingPage);
    if (!config.enabled) {
      return res.status(404).render('audit_request', { invalid: true, vm: null, token: '' });
    }

    const body = req.body || {};
    const values = {};
    const errors = [];
    for (const [key, field] of Object.entries(config.fields)) {
      if (!field.enabled) continue;
      const val = String(body[key] || '').trim();
      values[key] = val;
      if (field.required && !val) {
        errors.push(`${field.label || key} is required.`);
      }
    }
    if (errors.length) {
      const vm = materializeLandingCopy(config, lead);
      return res.status(400).render('audit_request', {
        invalid: false,
        submitted: false,
        token,
        vm,
        config,
        prefill: { ...values },
        leadTitle: String(lead.title || 'your business').trim(),
        workspaceName: String(workspace.name || '').trim(),
        formError: errors.join(' '),
      });
    }

    const patch = {};
    if (values.email && values.email !== 'N/A') patch.email = values.email;
    if (values.phone && values.phone !== 'N/A') patch.phone = values.phone;
    if (values.name) patch.contactName = values.name;
    patch.updates = appendLeadUpdate(lead, {
      type: 'audit_request_submitted',
      value: 'Audit request form submitted',
      form: values,
    });

    const updated = await dbService.updateLead(lead.key, patch, payload.workspaceId);

    try {
      await applyEngagementSignal({
        lead: updated || lead,
        workspaceId: payload.workspaceId,
        signalType: 'link_click',
        linkUrl: 'audit_request_form',
        createTask: false,
      });
    } catch (e) {
      console.warn('[audit-request] engagement signal failed:', e && e.message);
    }

    const vm = materializeLandingCopy(config, updated || lead);
    const hasAnalysis = !!(
      (updated || lead).aiWebsiteAnalysis &&
      typeof (updated || lead).aiWebsiteAnalysis === 'object'
    );
    const base = baseUrlFromReq(req);
    const reportHref = hasAnalysis
      ? `${base}/audit/report/${encodeURIComponent(token)}`
      : '';

    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('audit_request', {
      invalid: false,
      submitted: true,
      token,
      vm,
      config,
      prefill: values,
      leadTitle: String(lead.title || 'your business').trim(),
      workspaceName: String(workspace.name || '').trim(),
      reportHref,
    });
  } catch (err) {
    console.error('[audit-request-post]', err);
    return res.status(500).render('audit_request', { invalid: true, vm: null, token: '' });
  }
});

module.exports = router;
