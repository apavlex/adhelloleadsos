const express = require('express');
const crypto = require('crypto');
const dbService = require('../services/database');
const signalwire = require('../services/signalwire');
const inboundForwardStats = require('../services/inboundForwardStats');

const router = express.Router();

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

function verifyShareToken(rawToken, storedHashHex) {
  const computed = hashToken(rawToken);
  try {
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(String(storedHashHex || ''), 'hex');
    if (a.length !== b.length || a.length !== 32) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function buildClientRows(ws) {
  const tp = ws && ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
  const entryList = Array.isArray(tp.numberBankEntries) ? tp.numberBankEntries : [];
  const legacyBank = Array.isArray(tp.numberBank) ? tp.numberBank : [];
  const emptyStats = { incoming: 0, connected: 0, missed: 0, voicemail: 0 };
  const entries = entryList.length
    ? entryList
    : legacyBank.map((n) => ({
        number: n,
        callerName: '',
        inboundStats: emptyStats,
      }));

  const rows = [];
  for (const entry of entries) {
    const number = signalwire.normalizePhone(entry.number || entry.phone || '');
    if (!number) continue;
    const forwardNumber = signalwire.normalizePhone(entry.forwardNumber || entry.forwardTo || '');
    rows.push({
      number,
      forwardNumber: forwardNumber || '',
      callerName: String(entry.callerName || '').trim().slice(0, 80),
      inboundStats: inboundForwardStats.sanitizeInboundStats(entry.inboundStats),
      lastInboundAt: entry.lastInboundAt ? String(entry.lastInboundAt) : '',
    });
  }
  return rows;
}

function invalidShareHtml(msg) {
  const m = msg || 'This link is invalid or has been revoked.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Unavailable</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#334155}</style></head><body><h1>Unavailable</h1><p>${m}</p></body></html>`;
}

/** Public read-only forwarding + inbound analytics (secret URL). */
router.get('/share/phone-analytics/:workspaceId/:token', async (req, res) => {
  try {
    const workspaceId = decodeURIComponent(String(req.params.workspaceId || '').trim());
    const token = String(req.params.token || '').trim();
    if (!workspaceId || !token) {
      return res.status(404).send(invalidShareHtml());
    }

    const ws = await dbService.getWorkspace(workspaceId);
    if (!ws) {
      return res.status(404).send(invalidShareHtml());
    }

    const tp = ws.telephony && typeof ws.telephony === 'object' ? ws.telephony : {};
    const storedHash = String(tp.phoneAnalyticsShareTokenHash || '').trim();
    if (!storedHash || !verifyShareToken(token, storedHash)) {
      return res.status(404).send(invalidShareHtml());
    }

    const rows = buildClientRows(ws);
    const workspaceName = String(ws.name || 'Workspace').trim() || 'Workspace';
    const shareCreatedAt = tp.phoneAnalyticsShareCreatedAt
      ? String(tp.phoneAnalyticsShareCreatedAt)
      : '';

    res.setHeader('Cache-Control', 'private, no-store');
    return res.render('share_phone_analytics', {
      workspaceName,
      rows,
      shareCreatedAt,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[share-phone-analytics]', err);
    return res.status(500).send(invalidShareHtml('Something went wrong loading this page.'));
  }
});

module.exports = router;
