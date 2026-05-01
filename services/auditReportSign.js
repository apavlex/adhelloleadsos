const crypto = require('crypto');

function secret() {
  return String(process.env.AUDIT_REPORT_SECRET || process.env.SESSION_SECRET || 'adhello-secret-key');
}

/**
 * Signed, time-bounded token for public hosted audit + PDF (no session cookie).
 * Payload: { k: leadKey, w: workspaceId, exp: ms epoch }
 */
function createAuditReportToken({ leadKey, workspaceId, ttlMs = 90 * 24 * 60 * 60 * 1000 }) {
  const k = String(leadKey || '').trim();
  const w = String(workspaceId || '').trim();
  if (!k || !w) throw new Error('createAuditReportToken: leadKey and workspaceId required');
  const payload = { k, w, exp: Date.now() + (Number(ttlMs) > 0 ? ttlMs : 90 * 86400000) };
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function verifyAuditReportToken(token) {
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const bodyB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  if (!bodyB64 || !sigB64) return null;
  const expectedSig = crypto.createHmac('sha256', secret()).update(bodyB64).digest('base64url');
  const a = Buffer.from(sigB64, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || !payload.k || !payload.w) return null;
  if (payload.exp && Number(payload.exp) < Date.now()) return null;
  return { leadKey: String(payload.k), workspaceId: String(payload.w), exp: Number(payload.exp) || 0 };
}

module.exports = {
  createAuditReportToken,
  verifyAuditReportToken,
};
