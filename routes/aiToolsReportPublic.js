const express = require('express');
const crypto = require('crypto');
const dbService = require('../services/database');
const { verifyAuditReportToken } = require('../services/auditReportSign');
const { buildAiToolsReportViewModel } = require('../services/aiToolsReportModel');
const { renderAuditReportPdfBuffer } = require('../services/auditReportPdf');
const workspaceService = require('../services/workspaceService');
const workspaceBootstrap = require('../services/workspaceBootstrap');

const router = express.Router();

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function loadLeadForAiToolsToken(token) {
  const payload = verifyAuditReportToken(token);
  if (!payload) return { error: 'invalid', payload: null, lead: null };
  if (payload.type && payload.type !== 'ai_tools') {
    return { error: 'invalid', payload, lead: null };
  }
  const lead = await dbService.getLead(payload.leadKey);
  if (!lead || String(lead.workspaceId || '') !== String(payload.workspaceId)) {
    return { error: 'notfound', payload, lead: null };
  }
  const assessment = lead.aiToolsAssessment;
  if (!assessment || typeof assessment !== 'object') {
    return { error: 'noassessment', payload, lead };
  }
  return { error: null, payload, lead, assessment };
}

function hashClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = String(xf || req.ip || req.connection?.remoteAddress || '').trim();
  const salt = String(
    process.env.REPORT_VIEW_IP_SALT || process.env.SESSION_SECRET || 'adhello-report-view',
  ).trim();
  return crypto.createHash('sha256').update(`${salt}|${raw || 'unknown'}`).digest('hex').slice(0, 32);
}

async function staffCanEditAssessment(req, lead) {
  const email = workspaceService.userEmail(req);
  if (!email || !lead || !lead.workspaceId) return false;
  const ws = await dbService.getWorkspace(lead.workspaceId);
  return !!(ws && workspaceBootstrap.userCanAccessWorkspace(ws, email));
}

function invalidReportHtml(msg) {
  const m = msg || 'This assessment link is invalid or has expired.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Assessment unavailable</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#334155}</style></head><body><h1>Assessment unavailable</h1><p>${m}</p></body></html>`;
}

/** Public AI Tools Assessment deck (signed URL). */
router.get('/ai-tools/report/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, assessment } = await loadLeadForAiToolsToken(token);
    if (error === 'invalid') return res.status(404).send(invalidReportHtml());
    if (error === 'notfound' || error === 'noassessment') {
      return res.status(404).send(invalidReportHtml());
    }

    const printMode = req.query.print === '1' || req.query.pdf === '1';
    const baseUrl = baseUrlFromReq(req);
    const reportUrl = `${baseUrl}/ai-tools/report/${token}`;
    const ws = lead.workspaceId ? await dbService.getWorkspace(lead.workspaceId) : null;
    const workspaceAccent = (ws && ws.accentColor) || null;
    const vm = buildAiToolsReportViewModel(lead, assessment, {
      baseUrl,
      reportUrl,
      workspaceAccent,
    });
    const editMode = !printMode && (await staffCanEditAssessment(req, lead));

    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('ai_tools_report', {
      vm,
      printMode,
      editMode,
      token,
      leadKey: lead.key,
      pdfHref: `${baseUrl}/ai-tools/report/${encodeURIComponent(token)}/download.pdf`,
      reportUrl,
      followUpEmail: vm.followUpEmail,
    });
  } catch (err) {
    console.error('[ai-tools-report]', err);
    return res.status(500).send(invalidReportHtml('Something went wrong loading this assessment.'));
  }
});

router.get('/ai-tools/report/:token/download.pdf', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, assessment } = await loadLeadForAiToolsToken(token);
    if (error) return res.status(404).end();

    const baseUrl = baseUrlFromReq(req);
    const ws = lead.workspaceId ? await dbService.getWorkspace(lead.workspaceId) : null;
    const workspaceAccent = (ws && ws.accentColor) || null;
    const vm = buildAiToolsReportViewModel(lead, assessment, { baseUrl, workspaceAccent });
    const printUrl = `${baseUrl}/ai-tools/report/${encodeURIComponent(token)}?print=1`;
    const pdf = await renderAuditReportPdfBuffer(printUrl);
    const filename = vm.pdfFilename || 'ai-tools-assessment.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('[ai-tools-report-pdf]', err && err.message);
    if (err && err.code === 'PUPPETEER_MISSING') {
      return res.status(501).type('text/plain').send(err.message);
    }
    return res.status(500).type('text/plain').send('PDF generation failed.');
  }
});

router.post('/ai-tools/report/:token/telemetry', express.json({ limit: '12kb' }), async (req, res) => {
  try {
    const token = req.params.token;
    const { error, payload } = await loadLeadForAiToolsToken(token);
    if (error) return res.status(404).json({ ok: false });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const viewId = typeof body.view_id === 'string' ? body.view_id.trim() : '';
    const durationSec = Math.min(86400, Math.max(0, Math.round(Number(body.duration_seconds) || 0)));

    if (viewId) {
      const ok = await dbService.updateReportViewDuration(
        payload.workspaceId,
        viewId,
        durationSec,
        payload.leadKey,
      );
      return res.json({ ok: !!ok });
    }

    const ipHash = hashClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 512);
    const row = await dbService.createReportView({
      workspaceId: payload.workspaceId,
      leadId: payload.leadKey,
      ipHash,
      userAgent: ua,
    });
    return res.json({ ok: true, view_id: row.id });
  } catch (err) {
    console.error('[ai-tools-report-telemetry]', err);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
