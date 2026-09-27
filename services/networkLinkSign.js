const crypto = require('crypto');

const REFERRAL_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const PORTAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function secret() {
  return String(process.env.NETWORK_LINK_SECRET || process.env.SESSION_SECRET || 'adhello-secret-key');
}

// Domain-separated so an audit report token signed with the same fallback secret never verifies here.
function sign(bodyB64) {
  return crypto.createHmac('sha256', secret()).update(`network.${bodyB64}`).digest('base64url');
}

function encode(payload) {
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${bodyB64}.${sign(bodyB64)}`;
}

function createReferralLinkToken({ networkId, referralId, memberId, ttlMs = REFERRAL_TTL_MS, now = Date.now() }) {
  const n = String(networkId || '').trim();
  const r = String(referralId || '').trim();
  const m = String(memberId || '').trim();
  if (!n || !r || !m) throw new Error('createReferralLinkToken: networkId, referralId and memberId required');
  return encode({ t: 'ref', n, r, m, exp: now + (Number(ttlMs) > 0 ? ttlMs : REFERRAL_TTL_MS) });
}

function createMemberPortalToken({ networkId, memberId, ttlMs = PORTAL_TTL_MS, now = Date.now() }) {
  const n = String(networkId || '').trim();
  const m = String(memberId || '').trim();
  if (!n || !m) throw new Error('createMemberPortalToken: networkId and memberId required');
  return encode({ t: 'mem', n, m, exp: now + (Number(ttlMs) > 0 ? ttlMs : PORTAL_TTL_MS) });
}

/**
 * @param {string} token
 * @param {'ref'|'mem'} expectedType
 * @returns {{ type: string, networkId: string, referralId: string, memberId: string, exp: number } | null}
 */
function verifyNetworkToken(token, expectedType, now = Date.now()) {
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const bodyB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  if (!bodyB64 || !sigB64) return null;
  const a = Buffer.from(sigB64, 'utf8');
  const b = Buffer.from(sign(bodyB64), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (expectedType && payload.t !== expectedType) return null;
  if (!payload.n || !payload.m) return null;
  if (payload.t === 'ref' && !payload.r) return null;
  if (payload.exp && Number(payload.exp) < now) return null;
  return {
    type: String(payload.t),
    networkId: String(payload.n),
    referralId: payload.r ? String(payload.r) : '',
    memberId: String(payload.m),
    exp: Number(payload.exp) || 0,
  };
}

module.exports = {
  createReferralLinkToken,
  createMemberPortalToken,
  verifyNetworkToken,
};
