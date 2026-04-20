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
 * Round-robin among SDR/admin assignees; persists counter on workspace.
 */
async function pickRoundRobinAssignee(workspaceId) {
  const id = workspaceId;
  if (!id) return null;
  let w = await dbService.getWorkspace(id);
  if (!w) w = await ensureWorkspaceAndMember(id, '');
  const pool = assignablePool(w);
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
  pickRoundRobinAssignee,
  userEmail,
};
