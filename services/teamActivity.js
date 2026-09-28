/**
 * Team activity — who did what in a workspace (searches, tags, pipeline moves,
 * notes, lead adds/deletes, outreach) plus per-lead "added by / last worked by".
 */
const dbService = require('./database');
const { userEmail } = require('./workspaceService');

const CATEGORIES = [
  { key: 'search', label: 'Searches' },
  { key: 'tags', label: 'Tags' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'notes', label: 'Notes & logs' },
  { key: 'leads', label: 'Leads' },
  { key: 'outreach', label: 'Outreach' },
];
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

/* Bulk actions store at most this many lead keys in meta; attribution still covers all. */
const META_LEAD_KEYS_CAP = 50;

function normalizeLeadKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.startsWith('lead:') ? s : `lead:${s.replace(/^lead:/i, '')}`;
}

function actorFromReq(req) {
  const email = String(userEmail(req) || '').trim().toLowerCase();
  if (!email) return null;
  const user = (req && req.user) || {};
  const name = user.displayName ? String(user.displayName).trim() : '';
  const avatar = user.photos && user.photos[0] && user.photos[0].value ? String(user.photos[0].value) : '';
  return { email, name, avatar };
}

/** Snapshot for work that finishes after the request (background searches, imports). */
function captureContext(req) {
  return { workspaceId: req && req.workspaceId, actor: actorFromReq(req) };
}

function resolveContext(reqOrCtx) {
  if (!reqOrCtx) return { workspaceId: '', actor: null };
  if (reqOrCtx.actor !== undefined && !reqOrCtx.headers) return reqOrCtx;
  return captureContext(reqOrCtx);
}

/**
 * Record one activity row. Never throws — attribution must not break the action itself.
 * entry: { category, action, summary, leadKey?, leadKeys?, leadTitle?, meta?, created?, attribute? }
 */
function record(reqOrCtx, entry) {
  try {
    const { workspaceId, actor } = resolveContext(reqOrCtx);
    if (!workspaceId || !actor || !entry || !CATEGORY_KEYS.has(entry.category)) return null;
    const keys = []
      .concat(entry.leadKeys || [])
      .concat(entry.leadKey ? [entry.leadKey] : [])
      .map(normalizeLeadKey)
      .filter(Boolean);
    const unique = [...new Set(keys)];
    const meta = { ...(entry.meta || {}) };
    if (unique.length > 1) meta.leadKeys = unique.slice(0, META_LEAD_KEYS_CAP);
    const now = Date.now();
    const id = dbService.insertTeamActivity({
      workspaceId,
      actorEmail: actor.email,
      actorName: actor.name,
      category: entry.category,
      action: String(entry.action || entry.category),
      summary: String(entry.summary || '').slice(0, 500),
      leadKey: unique.length === 1 ? unique[0] : null,
      leadTitle: entry.leadTitle ? String(entry.leadTitle).slice(0, 200) : null,
      leadCount: unique.length || (Number.isFinite(entry.leadCount) ? entry.leadCount : 0),
      meta: Object.keys(meta).length ? meta : null,
      createdAt: now,
    });
    if (unique.length && entry.attribute !== false) {
      dbService.touchLeadAttribution(workspaceId, unique, actor.email, { created: !!entry.created, at: now });
    }
    return id;
  } catch (err) {
    console.warn('[teamActivity] record failed:', err && err.message);
    return null;
  }
}

/** Record once the response finishes without an error status (handlers with many early returns). */
function recordOnSuccess(req, res, entry) {
  if (!res || typeof res.on !== 'function') return;
  const ctx = captureContext(req);
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    record(ctx, typeof entry === 'function' ? entry() : entry);
  });
}

function reviewKey(workspaceId, reviewerEmail) {
  const frag = String(reviewerEmail || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `team_review:${workspaceId}:${frag}`;
}

/** { [actorEmail]: lastReviewedAtMs } for the signed-in reviewer. */
function getReviewCheckpoints(workspaceId, reviewerEmail) {
  if (!workspaceId || !reviewerEmail) return {};
  try {
    const raw = dbService.getKvSync(reviewKey(workspaceId, reviewerEmail));
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markReviewed(workspaceId, reviewerEmail, actorEmail, at) {
  const email = String(actorEmail || '').trim().toLowerCase();
  if (!workspaceId || !reviewerEmail || !email) return null;
  const checkpoints = getReviewCheckpoints(workspaceId, reviewerEmail);
  checkpoints[email] = at || Date.now();
  dbService.setKvSync(reviewKey(workspaceId, reviewerEmail), checkpoints);
  return checkpoints[email];
}

/** Keep teammates' names/avatars on the workspace so history can label other people. */
async function rememberMemberProfile(req) {
  const ws = req && req.workspace;
  const actor = actorFromReq(req);
  if (!ws || !actor || !ws.members) return;
  const member = ws.members[actor.email];
  if (!member) return;
  if (member.name === actor.name && member.avatar === actor.avatar) return;
  ws.members[actor.email] = { ...member, name: actor.name, avatar: actor.avatar };
  await dbService.saveWorkspace(ws.id, ws);
}

function memberDirectory(ws, stats) {
  const out = new Map();
  const members = (ws && ws.members) || {};
  Object.entries(members).forEach(([email, m]) => {
    const em = String(email || '').toLowerCase();
    out.set(em, {
      email: em,
      name: (m && m.name) || '',
      avatar: (m && m.avatar) || '',
      role: (m && m.role) || '',
      total: 0,
      unseen: 0,
      lastAt: null,
    });
  });
  (stats || []).forEach((s) => {
    const em = String(s.actor_email || '').toLowerCase();
    const cur = out.get(em) || { email: em, name: '', avatar: '', role: 'former', total: 0, unseen: 0, lastAt: null };
    out.set(em, {
      ...cur,
      name: cur.name || s.actor_name || '',
      total: s.total || 0,
      unseen: s.unseen || 0,
      lastAt: s.last_at || null,
    });
  });
  return [...out.values()].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0) || a.email.localeCompare(b.email));
}

/**
 * Resolve filters.workedBy (teammate email) into the lead keys they added or last worked.
 * Non-enumerable so leadListFilterQuerySuffix doesn't serialize the Set.
 */
function attachWorkedByKeys(filters, workspaceId) {
  const email = String((filters && filters.workedBy) || '').trim().toLowerCase();
  if (!email || !workspaceId) return filters;
  let keys = [];
  try {
    keys = dbService.listLeadKeysByActor(workspaceId, email, 'any');
  } catch (err) {
    console.warn('[teamActivity] workedBy lookup failed:', err && err.message);
  }
  Object.defineProperty(filters, 'workedByKeys', { value: new Set(keys), enumerable: false, configurable: true });
  return filters;
}

function displayName(entry) {
  if (!entry) return '';
  if (entry.name) return entry.name;
  return String(entry.email || '').split('@')[0];
}

module.exports = {
  CATEGORIES,
  actorFromReq,
  captureContext,
  record,
  recordOnSuccess,
  getReviewCheckpoints,
  markReviewed,
  rememberMemberProfile,
  memberDirectory,
  attachWorkedByKeys,
  displayName,
  normalizeLeadKey,
};
