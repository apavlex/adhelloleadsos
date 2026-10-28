const crypto = require('crypto');

const REPORT_TYPES = new Set(['website', 'ai_tools', 'ai_visibility']);

function secret() {
  return String(process.env.AUDIT_REPORT_SECRET || process.env.SESSION_SECRET || 'adhello-secret-key');
}

function normalizeReportType(type) {
  const t = String(type || 'website').trim();
  return REPORT_TYPES.has(t) ? t : 'website';
}

/**
 * Signed, time-bounded token for public hosted reports (no session cookie).
 * Payload: { k: leadKey, w: workspaceId, exp: ms epoch, t?: report type,
 *            j?: jobId, v?: share version }
 */
function createAuditReportToken({
  leadKey,
  workspaceId,
  ttlMs = 90 * 24 * 60 * 60 * 1000,
  type = 'website',
  jobId = '',
  version,
} = {}) {
  const k = String(leadKey || '').trim();
  const w = String(workspaceId || '').trim();
  if (!k || !w) throw new Error('createAuditReportToken: leadKey and workspaceId required');
  const reportType = normalizeReportType(type);
  const payload = {
    k,
    w,
    exp: Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : 90 * 86400000),
    t: reportType,
  };
  const j = String(jobId || '').trim();
  if (j) payload.j = j.slice(0, 80);
  if (version != null && Number.isFinite(Number(version))) {
    payload.v = Math.max(1, Math.round(Number(version)));
  }
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
  const reportType = normalizeReportType(payload.t);
  const out = {
    leadKey: String(payload.k),
    workspaceId: String(payload.w),
    exp: Number(payload.exp) || 0,
    type: reportType,
  };
  if (payload.j) out.jobId = String(payload.j).trim().slice(0, 80);
  if (payload.v != null && Number.isFinite(Number(payload.v))) {
    out.version = Math.max(1, Math.round(Number(payload.v)));
  }
  return out;
}

module.exports = {
  REPORT_TYPES,
  createAuditReportToken,
  verifyAuditReportToken,
  normalizeReportType,
};
