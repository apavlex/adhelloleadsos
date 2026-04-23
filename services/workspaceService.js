const dbService = require('./database');

function parseEmailSet(envVal) {
  const s = new Set();
  if (!envVal || typeof envVal !== 'string') return s;
  envVal.split(',').forEach((raw) => {
    const e = raw.trim().toLowerCase();
    if (e) s.add(e);
  });
  return s;
}

function userEmail(req) {
  return ((req.user && req.user.emails && req.user.emails[0] && req.user.emails[0].value) || '').trim();
}

/**
 * Visible leads for current workspace + role (SDRs only see assigned leads).
 */
function filterLeadsForRequest(req, leads) {
  if (!Array.isArray(leads)) return [];
  const wid = req && req.workspaceId;
  if (!wid) return [];
  const role = (req && req.workspaceRole) || 'admin';
  let list = leads.filter((l) => (l.workspaceId || 'default') === wid);
  if (role === 'sdr') {
    const email = userEmail(req).toLowerCase();
    list = list.filter((l) => (l.assignedTo || '').toLowerCase() === email);
  }
  return list;
}

async function ensureWorkspaceAndMember(workspaceId, userEmailRaw) {
  const id = workspaceId;
  if (!id || typeof id !== 'string') {
    throw new Error('ensureWorkspaceAndMember: workspaceId required');
  }
  let w = await dbService.getWorkspace(id);
  if (!w || typeof w !== 'object') {
    throw new Error(`Workspace not found: ${id}`);
  }
  const em = (userEmailRaw || '').toLowerCase().trim();
  if (!em) return w;

  const ownerEm = (w.ownerUserId || '').toLowerCase().trim();
  const sdrSet = parseEmailSet(process.env.WORKSPACE_SDR_EMAILS);
  if (!w.members[em]) {
    let role = 'admin';
    if (ownerEm && em === ownerEm) role = 'owner';
    else if (sdrSet.has(em)) role = 'sdr';
    else if (Object.keys(w.members || {}).length === 0) role = 'owner';
    else role = 'viewer';
    w.members = { ...(w.members || {}), [em]: { role, joinedAt: new Date().toISOString(), userId: em } };
    await dbService.saveWorkspace(id, w);
  }

  return dbService.getWorkspace(id);
}

function roleForEmail(workspace, email) {
  const em = (email || '').toLowerCase().trim();
  const m = workspace && workspace.members && workspace.members[em];
  return (m && m.role) || 'viewer';
}

function canManageTeam(role) {
  return role === 'owner' || role === 'admin';
}

function assignablePool(workspace) {
  if (!workspace || !workspace.members) return [];
  return Object.entries(workspace.members)
    .filter(([, meta]) => meta && (meta.role === 'sdr' || meta.role === 'admin'))
    .map(([email]) => email)
    .sort();
}

/**
 * Admins + SDRs in persisted order (drag ribbon), then any new pool members appended.
 */
function orderedRoundRobinPool(workspace) {
  const base = assignablePool(workspace);
  if (base.length === 0) return [];
  const set = new Set(base.map((e) => e.toLowerCase()));
  const raw =
    workspace && Array.isArray(workspace.roundRobinOrder) ? workspace.roundRobinOrder : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const em = String(item || '')
      .trim()
      .toLowerCase();
    if (!em || !set.has(em) || seen.has(em)) continue;
    const canonical = base.find((x) => x.toLowerCase() === em);
    if (!canonical) continue;
    seen.add(em);
    out.push(canonical);
  }
  for (const em of base) {
    const low = em.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      out.push(em);
    }
  }
  return out;
}

/**
 * @param {object} workspace
 * @param {string[]} incoming emails (any subset order — must cover pool exactly for a full reorder)
 */
function normalizeRoundRobinOrder(workspace, incoming) {
  const base = assignablePool(workspace);
  if (base.length === 0) return [];
  if (!Array.isArray(incoming) || incoming.length === 0) return [...base];
  const lowerBase = new Set(base.map((e) => e.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const item of incoming) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const match = base.find((e) => e.toLowerCase() === raw.toLowerCase());
    if (!match || seen.has(match.toLowerCase())) continue;
    if (!lowerBase.has(match.toLowerCase())) continue;
    seen.add(match.toLowerCase());
    out.push(match);
  }
  for (const em of base) {
    if (!seen.has(em.toLowerCase())) out.push(em);
  }
  return out;
}

/**
 * Round-robin among SDR/admin assignees; persists counter on workspace.
 */
async function pickRoundRobinAssignee(workspaceId) {
  const id = workspaceId;
  if (!id) return null;
  let w = await dbService.getWorkspace(id);
  if (!w) w = await ensureWorkspaceAndMember(id, '');
  const pool = orderedRoundRobinPool(w);
  if (pool.length === 0) return null;
  let idx = typeof w.roundRobinIndex === 'number' ? w.roundRobinIndex : 0;
  idx = ((idx % pool.length) + pool.length) % pool.length;
  const email = pool[idx];
  w.roundRobinIndex = (idx + 1) % pool.length;
  await dbService.saveWorkspace(id, w);
  return email;
}

module.exports = {
  filterLeadsForRequest,
  ensureWorkspaceAndMember,
  roleForEmail,
  canManageTeam,
  assignablePool,
  orderedRoundRobinPool,
  normalizeRoundRobinOrder,
  pickRoundRobinAssignee,
  userEmail,
};
