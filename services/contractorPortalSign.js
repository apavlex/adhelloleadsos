/**
 * Signed tokens for contractor business portals (/p/:token).
 * Payload: { t:'portal', w: workspaceId, p: packageId, exp }
 */
const crypto = require('crypto');

function secret() {
  return String(
    process.env.CONTRACTOR_PORTAL_SECRET ||
      process.env.AUDIT_REPORT_SECRET ||
      process.env.SESSION_SECRET ||
      'adhello-secret-key',
  );
}

function createContractorPortalToken({
  workspaceId,
  packageId,
  ttlMs = 365 * 24 * 60 * 60 * 1000,
} = {}) {
  const w = String(workspaceId || '').trim();
  const p = String(packageId || '').trim();
  if (!w || !p) throw new Error('createContractorPortalToken: workspaceId and packageId required');
  const payload = {
    t: 'portal',
    w,
    p,
    exp: Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : 365 * 86400000),
  };
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function verifyContractorPortalToken(token) {
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
  if (!payload || payload.t !== 'portal' || !payload.w || !payload.p) return null;
  if (payload.exp && Number(payload.exp) < Date.now()) return null;
  return {
    workspaceId: String(payload.w),
    packageId: String(payload.p),
    exp: Number(payload.exp) || 0,
  };
}

module.exports = {
  createContractorPortalToken,
  verifyContractorPortalToken,
};
