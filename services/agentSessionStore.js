/**
 * In-memory store for continuous agent-first calling sessions.
 * One active session per workspace. Tracks the agent's live call SID
 * and manages a queue of leads to dial without re-calling the agent.
 *
 * Lifecycle:
 *   createSession  → agent call placed, first lead queued
 *   queueNextLead  → UI click queues another lead
 *   popNextLead    → TwiML poll pops the next lead to dial
 *   removeSession  → agent hangs up or session ended
 */

const sessions = new Map();

/** Drop sessions older than this even if status webhooks were missed. */
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function getSession(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const s = sessions.get(wid) || null;
  if (!s) return null;
  if (isSessionStale(s)) {
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

function createSession(workspaceId, data) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const s = {
    workspaceId: wid,
    callSid: data.callSid || '',
    agentTo: data.agentTo || '',
    from: data.from || '',
    queuedLeadKeys: data.queuedLeadKeys || [],
    currentLeadKey: data.currentLeadKey || null,
    createdAt: Date.now(),
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
  // Deduplicate — don't re-queue same lead if it's already waiting
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

/**
 * Clear a session when its agent call SID matches (or when sid is empty and any session exists).
 * Prefer matching CallSid so concurrent workspaces stay isolated.
 */
function removeSessionForCall(workspaceId, callSid) {
  const wid = String(workspaceId || '').trim();
  const sid = String(callSid || '').trim();
  if (!wid) return false;
  const s = sessions.get(wid);
  if (!s) return false;
  if (sid && s.callSid && s.callSid !== sid) return false;
  return sessions.delete(wid);
}

module.exports = {
  SESSION_MAX_AGE_MS,
  getSession,
  createSession,
  updateSession,
  removeSession,
  removeSessionForCall,
  queueNextLead,
  popNextLead,
  hasSession,
  isSessionStale,
};
