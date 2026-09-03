/**
 * In-memory store for continuous agent-first calling sessions.
 * Supports:
 *  - outbound agent ring (legacy)
 *  - dial-in: agent calls the workspace DID, then we bridge the lead
 */

const sessions = new Map();

/** Drop sessions older than this even if status webhooks were missed. */
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** Dial-in pending window — agent must call the DID within this time. */
const DIAL_IN_PENDING_MS = 5 * 60 * 1000;

function getSession(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const s = sessions.get(wid) || null;
  if (!s) return null;
  if (isSessionStale(s)) {
    sessions.delete(wid);
    return null;
  }
  if (s.mode === 'dial_in' && s.status === 'pending_dial_in' && isDialInExpired(s)) {
    sessions.delete(wid);
    return null;
  }
  return s;
}

function isSessionStale(session, nowMs = Date.now()) {
  if (!session || typeof session !== 'object') return true;
  const createdAt = Number(session.createdAt) || 0;
  if (!createdAt) return true;
  return nowMs - createdAt > SESSION_MAX_AGE_MS;
}

function isDialInExpired(session, nowMs = Date.now()) {
  const exp = Number(session && session.expiresAt) || 0;
  if (exp) return nowMs > exp;
  const createdAt = Number(session && session.createdAt) || 0;
  return !createdAt || nowMs - createdAt > DIAL_IN_PENDING_MS;
}

function createSession(workspaceId, data) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const mode = String((data && data.mode) || 'outbound').trim() || 'outbound';
  const s = {
    workspaceId: wid,
    mode,
    status: mode === 'dial_in' ? 'pending_dial_in' : 'active',
    callSid: data.callSid || '',
    agentTo: data.agentTo || '',
    from: data.from || '',
    dialInNumber: data.dialInNumber || data.from || '',
    dialTo: data.dialTo || '',
    leadKey: data.leadKey || data.currentLeadKey || null,
    leadCallerId: data.leadCallerId || data.from || '',
    queuedLeadKeys: data.queuedLeadKeys || [],
    currentLeadKey: data.currentLeadKey || data.leadKey || null,
    createdAt: Date.now(),
    expiresAt: mode === 'dial_in' ? Date.now() + DIAL_IN_PENDING_MS : null,
  };
  sessions.set(wid, s);
  return s;
}

function updateSession(workspaceId, patch) {
  const s = getSession(workspaceId);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

function removeSession(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return false;
  return sessions.delete(wid);
}

function queueNextLead(workspaceId, leadKey) {
  const s = getSession(workspaceId);
  if (!s) return false;
  if (!s.queuedLeadKeys) s.queuedLeadKeys = [];
  if (s.queuedLeadKeys.includes(leadKey)) return true;
  s.queuedLeadKeys.push(leadKey);
  return true;
}

function popNextLead(workspaceId) {
  const s = getSession(workspaceId);
  if (!s || !s.queuedLeadKeys || !s.queuedLeadKeys.length) return null;
  const leadKey = s.queuedLeadKeys.shift();
  s.currentLeadKey = leadKey;
  return leadKey;
}

function hasSession(workspaceId) {
  return !!getSession(workspaceId);
}

function removeSessionForCall(workspaceId, callSid) {
  const wid = String(workspaceId || '').trim();
  const sid = String(callSid || '').trim();
  if (!wid) return false;
  const s = sessions.get(wid);
  if (!s) return false;
  if (sid && s.callSid && s.callSid !== sid) return false;
  return sessions.delete(wid);
}

/** Find a pending dial-in session for this DID (and optional agent From). */
function findPendingDialInByDid(didRaw, fromRaw) {
  const did = String(didRaw || '').replace(/[^\d+]/g, '');
  const from = String(fromRaw || '').replace(/[^\d+]/g, '');
  const now = Date.now();
  for (const s of sessions.values()) {
    if (!s || s.mode !== 'dial_in') continue;
    if (s.status !== 'pending_dial_in') continue;
    if (isSessionStale(s, now) || isDialInExpired(s, now)) continue;
    const dialIn = String(s.dialInNumber || s.from || '').replace(/[^\d+]/g, '');
    if (!dialIn || !did) continue;
    const didDigits = did.replace(/\D/g, '');
    const inDigits = dialIn.replace(/\D/g, '');
    if (!didDigits.endsWith(inDigits.slice(-10)) && !inDigits.endsWith(didDigits.slice(-10))) {
      continue;
    }
    if (from && s.agentTo) {
      const agentDigits = String(s.agentTo).replace(/\D/g, '');
      const fromDigits = from.replace(/\D/g, '');
      // Prefer matching agent mobile, but still allow if agentTo unset.
      if (agentDigits && fromDigits && !fromDigits.endsWith(agentDigits.slice(-10))) {
        continue;
      }
    }
    return s;
  }
  return null;
}

module.exports = {
  SESSION_MAX_AGE_MS,
  DIAL_IN_PENDING_MS,
  getSession,
  createSession,
  updateSession,
  removeSession,
  removeSessionForCall,
  queueNextLead,
  popNextLead,
  hasSession,
  isSessionStale,
  isDialInExpired,
  findPendingDialInByDid,
};
