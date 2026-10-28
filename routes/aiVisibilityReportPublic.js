/**
 * Public AI Visibility share report — signed token, no Agency OS session.
 *   GET  /ai-visibility/report/:token
 *   POST /ai-visibility/report/:token/telemetry
 */

const express = require('express');
const crypto = require('crypto');
const dbService = require('../services/database');
const {
  REPORT_TYPE,
  verifyAiVisibilityToken,
  shareAccessError,
  buildAiVisibilityClientViewModel,
  getShareMeta,
} = require('../services/aiVisibilityReport');

const router = express.Router();

function baseUrlFromReq(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function invalidReportHtml(msg) {
  const m = msg || 'This visibility report link is invalid or has expired.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Report unavailable</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#334155}h1{font-size:1.25rem}</style></head><body><h1>Report unavailable</h1><p>${m}</p></body></html>`;
}

function hashClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = String(xf || req.ip || (req.connection && req.connection.remoteAddress) || '').trim();
  const salt = String(
    process.env.REPORT_VIEW_IP_SALT || process.env.SESSION_SECRET || 'adhello-report-view',
  ).trim();
  return crypto.createHash('sha256').update(`${salt}|${raw || 'unknown'}`).digest('hex').slice(0, 32);
}

async function loadReportForToken(token) {
  const payload = verifyAiVisibilityToken(token);
  if (!payload) return { error: 'invalid', payload: null, lead: null, workspace: null };
  const lead = await dbService.getLead(payload.leadKey);
  if (!lead || String(lead.workspaceId || '') !== String(payload.workspaceId)) {
    return { error: 'notfound', payload, lead: null, workspace: null };
  }
  const accessErr = shareAccessError(payload, lead);
  if (accessErr) return { error: accessErr, payload, lead, workspace: null };
  const workspace = (await dbService.getWorkspace(payload.workspaceId)) || {
    id: payload.workspaceId,
  };
  return { error: null, payload, lead, workspace };
}

function errorMessage(code) {
  if (code === 'revoked') return 'This report link has been revoked. Ask your agency for a new link.';
  if (code === 'noreport') return 'This visibility report is not ready yet.';
  if (code === 'notfound') return 'This visibility report link is invalid or has expired.';
  return 'This visibility report link is invalid or has expired.';
}

router.get('/ai-visibility/report/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { error, lead, workspace, payload } = await loadReportForToken(token);
    if (error) {
      return res.status(404).send(invalidReportHtml(errorMessage(error)));
    }

    const printMode = req.query.print === '1' || req.query.pdf === '1';
    const baseUrl = baseUrlFromReq(req);
    const reportUrl = `${baseUrl}/ai-visibility/report/${token}`;
    const share = getShareMeta(lead);
    const vm = buildAiVisibilityClientViewModel(lead, {
      baseUrl,
      reportUrl,
      workspaceAccent: workspace && workspace.accentColor,
      agencyName: (workspace && (workspace.name || workspace.companyName)) || 'AdHello',
      expiresAt: share.expiresAt || (payload.exp ? new Date(payload.exp).toISOString() : ''),
      allowSample: true,
    });

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.render('ai_visibility_report', {
      vm,
      printMode,
      token,
      reportUrl,
      followUpEmail: vm.followUpEmail,
    });
  } catch (err) {
    console.error('[ai-visibility-report]', err);
    return res.status(500).send(invalidReportHtml('Something went wrong loading this report.'));
  }
});

router.post('/ai-visibility/report/:token/telemetry', express.json({ limit: '12kb' }), async (req, res) => {
  try {
    const token = req.params.token;
    const { error, payload } = await loadReportForToken(token);
    if (error) return res.status(404).json({ ok: false });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const viewId = typeof body.view_id === 'string' ? body.view_id.trim() : '';
    const durationSec = Math.min(86400, Math.max(0, Math.round(Number(body.duration_seconds) || 0)));

    if (viewId && typeof dbService.updateReportViewDuration === 'function') {
      const ok = await dbService.updateReportViewDuration(
        payload.workspaceId,
        viewId,
        durationSec,
        payload.leadKey,
      );
      return res.json({ ok: !!ok });
    }

    if (typeof dbService.createReportView === 'function') {
      const ipHash = hashClientIp(req);
      const ua = String(req.headers['user-agent'] || '').slice(0, 512);
      const row = await dbService.createReportView({
        workspaceId: payload.workspaceId,
        leadId: payload.leadKey,
        ipHash,
        userAgent: ua,
        kind: REPORT_TYPE,
      });
      return res.json({ ok: true, view_id: row && row.id ? row.id : '' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[ai-visibility-report-telemetry]', err);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
