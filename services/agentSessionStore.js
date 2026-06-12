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

function getSession(workspaceId) {
  return sessions.get(workspaceId) || null;
}

function createSession(workspaceId, data) {
  const s = {
    workspaceId,
    callSid: data.callSid || '',
    agentTo: data.agentTo || '',
    from: data.from || '',
    queuedLeadKeys: data.queuedLeadKeys || [],
    currentLeadKey: data.currentLeadKey || null,
    createdAt: Date.now(),
  };
  sessions.set(workspaceId, s);
  return s;
}

function updateSession(workspaceId, patch) {
  const s = sessions.get(workspaceId);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

function removeSession(workspaceId) {
  return sessions.delete(workspaceId);
}

function queueNextLead(workspaceId, leadKey) {
  const s = sessions.get(workspaceId);
  if (!s) return false;
  if (!s.queuedLeadKeys) s.queuedLeadKeys = [];
  // Deduplicate — don't re-queue same lead if it's already waiting
  if (s.queuedLeadKeys.includes(leadKey)) return true;
  s.queuedLeadKeys.push(leadKey);
  return true;
}

function popNextLead(workspaceId) {
  const s = sessions.get(workspaceId);
  if (!s || !s.queuedLeadKeys || !s.queuedLeadKeys.length) return null;
  const leadKey = s.queuedLeadKeys.shift();
  s.currentLeadKey = leadKey;
  return leadKey;
}

function hasSession(workspaceId) {
  return sessions.has(workspaceId);
}

module.exports = {
  getSession,
  createSession,
  updateSession,
  removeSession,
  queueNextLead,
  popNextLead,
  hasSession,
};
