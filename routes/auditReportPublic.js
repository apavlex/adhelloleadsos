const express = require('express');
const crypto = require('crypto');
const dbService = require('../services/database');
const { verifyAuditReportToken } = require('../services/auditReportSign');
const { buildAuditReportViewModel } = require('../services/auditReportModel');
const { renderAuditReportPdfBuffer } = require('../services/auditReportPdf');
const { applyEngagementSignal } = require('../services/engagementSignals');

const router = express.Router();

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function loadLeadForToken(token) {
  const payload = verifyAuditReportToken(token);
  if (!payload) return { error: 'invalid', payload: null, lead: null };
  const lead = await dbService.getLead(payload.leadKey);
  if (!lead || String(lead.workspaceId || '') !== String(payload.workspaceId)) {
    return { error: 'notfound', payload, lead: null };
  }
  const analysis = lead.aiWebsiteAnalysis;
  if (!analysis || typeof analysis !== 'object') {
    return { error: 'noanalysis', payload, lead };
  }
  return { error: null, payload, lead, analysis };
}

function hashClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = String(xf || req.ip || req.connection?.remoteAddress || '').trim();
  const salt = String(
    process.env.REPORT_VIEW_IP_SALT || process.env.SESSION_SECRET || 'adhello-report-view',
  ).trim();
  return crypto.createHash('sha256').update(`${salt}|${raw || 'unknown'}`).digest('hex').slice(0, 32);
}

/** HTML report (public, signed URL). */
router.get('/audit/report/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, analysis } = await loadLeadForToken(token);
    if (error === 'invalid') return res.status(404).send(invalidReportHtml());
    if (error === 'notfound' || error === 'noanalysis') return res.status(404).send(invalidReportHtml());

    const printMode = req.query.print === '1' || req.query.pdf === '1';
    const baseUrl = baseUrlFromReq(req);
    const vm = buildAuditReportViewModel(lead, analysis, { baseUrl });
    const reportUrl = `${baseUrl}/audit/report/${token}`;
    const company = String(lead.title || 'your team').trim() || 'your team';
    const book = String(process.env.ADHELLO_BOOK_URL || 'https://adhello.ai/book').trim();
    const followUpEmail = {
      subject: 'Your audit, attached — plus the 3 fixes we discussed.',
      body: `Hi ${company},\n\nGreat speaking with you. Attached is the one-page website audit PDF from our call.\n\nThe three fixes we walked through are still the fastest wins — happy to implement or QA anything your dev pushes live.\n\nIf you want the deeper pass (competitor benchmark, Core Web Vitals, and a 30-day plan), grab a slot here: ${book}\n\nBest,\n`,
    };
    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('audit_report', {
      vm,
      printMode,
      token,
      pdfHref: `${baseUrl}/audit/report/${encodeURIComponent(token)}/download.pdf`,
      reportUrl,
      followUpEmail,
    });
  } catch (err) {
    console.error('[audit-report]', err);
    return res.status(500).send(invalidReportHtml('Something went wrong loading this report.'));
  }
});

/** PDF download — same visual as hosted page (Puppeteer print). */
router.get('/audit/report/:token/download.pdf', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, analysis } = await loadLeadForToken(token);
    if (error === 'invalid') return res.status(404).end();
    if (error === 'notfound' || error === 'noanalysis') return res.status(404).end();

    const baseUrl = baseUrlFromReq(req);
    const vm = buildAuditReportViewModel(lead, analysis, { baseUrl });
    const printUrl = `${baseUrl}/audit/report/${encodeURIComponent(token)}?print=1`;

    const pdf = await renderAuditReportPdfBuffer(printUrl);
    const filename = vm.pdfFilename || 'website-audit.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('[audit-report-pdf]', err && err.message, err && err.code);
    if (err && err.code === 'PUPPETEER_MISSING') {
      return res.status(501).type('text/plain').send(err.message);
    }
    return res.status(500).type('text/plain').send('PDF generation failed. Check server logs.');
  }
});

/** Open / duration telemetry for hosted audit (no session; token must verify). */
router.post('/audit/report/:token/telemetry', express.json({ limit: '12kb' }), async (req, res) => {
  try {
    const token = req.params.token;
    const { error, payload } = await loadLeadForToken(token);
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
    try {
      const lead = await dbService.getLead(payload.leadKey, payload.workspaceId);
      if (lead) {
        await applyEngagementSignal({
          lead,
          workspaceId: payload.workspaceId,
          signalType: 'audit_open',
          at: row.viewedAt || new Date().toISOString(),
          createTask: true,
          provider: 'audit',
        });
      }
    } catch (e) {
      console.warn('[audit-report-telemetry] engagement signal failed:', e && e.message);
    }
    return res.json({ ok: true, view_id: row.id });
  } catch (err) {
    console.error('[audit-report-telemetry]', err);
    return res.status(500).json({ ok: false });
  }
});

function invalidReportHtml(msg) {
  const m = msg || 'This report link is invalid or has expired.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Report unavailable</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#334155}</style></head><body><h1>Report unavailable</h1><p>${m}</p></body></html>`;
}

module.exports = router;
