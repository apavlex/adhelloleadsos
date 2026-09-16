/**
 * Agent-first calling sessions.
 * Supports:
 *  - outbound agent ring (legacy)
 *  - dial-in: agent calls the workspace DID, then we bridge the lead
 *
 * Dial-in sessions are mirrored to SQLite kv so they survive Render restarts
 * (in-memory alone is lost on every deploy / cold start).
 */

const sessions = new Map();

/** Drop sessions older than this even if status webhooks were missed. */
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** Dial-in pending window — agent must call the DID within this time. */
const DIAL_IN_PENDING_MS = 5 * 60 * 1000;

function kvKey(workspaceId) {
  return `agent_session:${String(workspaceId || '').trim()}`;
}

function getDb() {
  try {
    return require('./database');
  } catch (_) {
    return null;
  }
}

function persistSession(session) {
  if (!session || !session.workspaceId) return;
  const db = getDb();
  if (!db || typeof db.setKvSync !== 'function') return;
  try {
    db.setKvSync(kvKey(session.workspaceId), JSON.stringify(session));
  } catch (err) {
    console.warn('[agentSessionStore] persist failed:', err && err.message);
  }
}

/**
 * SQLite writes are synchronous (better-sqlite3) and block the event loop while
 * another writer holds the lock. The inbound voice webhook must answer SignalWire
 * in well under a second, so it persists after the response is flushed.
 */
function persistSessionDeferred(session) {
  if (!session || !session.workspaceId) return;
  setImmediate(() => {
    try {
      persistSession(session);
    } catch (_) {
      /* already logged */
    }
  });
}

function deletePersisted(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return;
  const db = getDb();
  if (!db || typeof db.deleteKvSync !== 'function') return;
  try {
    db.deleteKvSync(kvKey(wid));
  } catch (_) {
    /* ignore */
  }
}

function loadPersisted(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  const db = getDb();
  if (!db || typeof db.getKvSync !== 'function') return null;
  try {
    const raw = db.getKvSync(kvKey(wid));
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function listPersistedDialInSessions() {
  const db = getDb();
  if (!db || typeof db.listKvKeysSync !== 'function') return [];
  try {
    const keys = db.listKvKeysSync('agent_session:') || [];
    const out = [];
    for (const key of keys) {
      try {
        const raw = db.getKvSync(key);
        if (!raw) continue;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') out.push(parsed);
      } catch (_) {
        /* skip bad row */
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

function getSession(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return null;
  let s = sessions.get(wid) || null;
  if (!s) {
    s = loadPersisted(wid);
    if (s) sessions.set(wid, s);
  }
  if (!s) return null;
  if (isSessionStale(s)) {
    sessions.delete(wid);
    deletePersisted(wid);
    return null;
  }
  if (s.mode === 'dial_in' && s.status === 'pending_dial_in' && isDialInExpired(s)) {
    sessions.delete(wid);
    deletePersisted(wid);
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
    testDialIn: !!(data && data.testDialIn),
    // Whether the DID's inbound Voice webhook was verified when the session was
    // parked — the UI must not promise "dial in now" when it was not.
    inboundConfigured: data.inboundConfigured == null ? null : !!data.inboundConfigured,
    inboundError: data.inboundError || '',
    createdAt: Date.now(),
    expiresAt: mode === 'dial_in' ? Date.now() + DIAL_IN_PENDING_MS : null,
  };
  sessions.set(wid, s);
  if (mode === 'dial_in') persistSession(s);
  return s;
}

function updateSession(workspaceId, patch, opts) {
  const s = getSession(workspaceId);
  if (!s) return null;
  Object.assign(s, patch);
  if (s.mode === 'dial_in') {
    if (opts && opts.defer) persistSessionDeferred(s);
    else persistSession(s);
  }
  return s;
}

function removeSession(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return false;
  sessions.delete(wid);
  deletePersisted(wid);
  return true;
}

function queueNextLead(workspaceId, leadKey) {
  const s = getSession(workspaceId);
  if (!s) return false;
  if (!s.queuedLeadKeys) s.queuedLeadKeys = [];
  if (s.queuedLeadKeys.includes(leadKey)) return true;
  s.queuedLeadKeys.push(leadKey);
  if (s.mode === 'dial_in') persistSession(s);
  return true;
}

function popNextLead(workspaceId) {
  const s = getSession(workspaceId);
  if (!s || !s.queuedLeadKeys || !s.queuedLeadKeys.length) return null;
  const leadKey = s.queuedLeadKeys.shift();
  s.currentLeadKey = leadKey;
  if (s.mode === 'dial_in') persistSession(s);
  return leadKey;
}

function hasSession(workspaceId) {
  return !!getSession(workspaceId);
}

function removeSessionForCall(workspaceId, callSid) {
  const wid = String(workspaceId || '').trim();
  const sid = String(callSid || '').trim();
  if (!wid) return false;
  const s = sessions.get(wid) || loadPersisted(wid);
  if (!s) return false;
  if (sid && s.callSid && s.callSid !== sid) return false;
  sessions.delete(wid);
  deletePersisted(wid);
  return true;
}

/** Digits only, so "+1 (360) 609-6937", "3606096937" and "+13606096937" compare equal. */
function phoneDigits(raw) {
  return String(raw == null ? '' : raw).replace(/\D/g, '');
}

function phonesMatch(aRaw, bRaw) {
  const a = phoneDigits(aRaw);
  const b = phoneDigits(bRaw);
  if (!a || !b) return false;
  // Short strings (extensions, partial input) must be exact — comparing suffixes
  // there would match unrelated numbers.
  if (a.length < 10 || b.length < 10) return a === b;
  return a.slice(-10) === b.slice(-10);
}

function isPendingDialInFor(session, did, nowMs) {
  if (!session || session.mode !== 'dial_in') return false;
  if (!String(session.workspaceId || '').trim()) return false;
  if (session.status !== 'pending_dial_in') return false;
  if (isSessionStale(session, nowMs) || isDialInExpired(session, nowMs)) return false;
  const dialIn = session.dialInNumber || session.from || '';
  if (!dialIn || !did) return false;
  return phonesMatch(did, dialIn);
}

/**
 * Find a pending dial-in session for this DID (and optional agent From).
 * Memory is checked first: the inbound webhook runs on the same process that
 * parked the session, and the SQLite scan can stall behind a background writer.
 */
function findPendingDialInByDid(didRaw, fromRaw) {
  const did = phoneDigits(didRaw);
  if (!did) return null;
  const from = phoneDigits(fromRaw);
  const now = Date.now();

  // Prefer a session whose stored agent mobile matches the calling handset, but
  // never require it — dual-SIM, Google Voice and blocked caller ID all present
  // a different From than the number saved in Workspace.
  let fallback = null;
  for (const s of sessions.values()) {
    if (!isPendingDialInFor(s, did, now)) continue;
    if (from && s.agentTo && phonesMatch(from, s.agentTo)) return s;
    if (!fallback) fallback = s;
  }
  if (fallback) return fallback;

  const seen = new Set();
  for (const s of listPersistedDialInSessions()) {
    if (!isPendingDialInFor(s, did, now)) continue;
    const wid = String(s.workspaceId || '').trim();
    if (seen.has(wid)) continue;
    seen.add(wid);
    // Hydrate memory for subsequent updates.
    sessions.set(wid, s);
    if (from && s.agentTo && phonesMatch(from, s.agentTo)) return s;
    if (!fallback) fallback = s;
  }
  return fallback;
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
  phonesMatch,
  phoneDigits,
};
