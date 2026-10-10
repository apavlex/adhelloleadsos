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
 * AdHello brand TLDs are interchangeable for the same local-part
 * (alex@adhello.io ↔ alex@adhello.ai) so logging into either host sees the same workspaces.
 */
function emailAliases(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return [];
  const out = [e];
  if (e.endsWith('@adhello.io')) {
    out.push(e.replace(/@adhello\.io$/, '@adhello.ai'));
  } else if (e.endsWith('@adhello.ai')) {
    out.push(e.replace(/@adhello\.ai$/, '@adhello.io'));
  }
  return [...new Set(out)];
}

/**
 * Visible leads for current workspace + role (SDRs only see assigned leads).
 */
function filterLeadsForRequest(req, leads) {
  if (!Array.isArray(leads)) return [];
  const wid = req && req.workspaceId;
  if (!wid) return [];
  let list = leads.filter((l) => (l.workspaceId || 'default') === wid);
  if (seesOnlyAssignedLeads(req)) {
    const email = userEmail(req).toLowerCase();
    list = list.filter((l) => (l.assignedTo || '').toLowerCase() === email);
  }
  return list;
}

/** True when this member's role is set to "only leads assigned to them" (Team → Roles & access). */
function seesOnlyAssignedLeads(req) {
  const role = (req && req.workspaceRole) || 'admin';
  const ws = req && req.workspace && req.workspace.id === req.workspaceId ? req.workspace : null;
  if (!ws) return role === 'sdr';
  return require('./rolePermissions').leadScope(ws, role) === 'assigned';
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

  const aliases = emailAliases(em);
  const ownerEm = (w.ownerUserId || '').toLowerCase().trim();
  const ownerAliases = ownerEm ? emailAliases(ownerEm) : [];
  const isOwner = Boolean(ownerEm && aliases.some((a) => ownerAliases.includes(a)));
  const sdrSet = parseEmailSet(process.env.WORKSPACE_SDR_EMAILS);
  const members = { ...(w.members || {}) };
  const existingKey = aliases.find((a) => members[a] && members[a].role);

  if (existingKey) {
    // Owner login must stay owner even if an alias was previously stored as viewer/sdr.
    if (isOwner && members[existingKey].role !== 'owner') {
      members[existingKey] = { ...members[existingKey], role: 'owner' };
      w.members = members;
      await dbService.saveWorkspace(id, w);
      return dbService.getWorkspace(id);
    }
    return w;
  }

  let role = 'admin';
  if (isOwner) role = 'owner';
  else if (aliases.some((a) => sdrSet.has(a))) role = 'sdr';
  else if (Object.keys(members).length === 0) role = 'owner';
  else role = 'viewer';
  members[em] = { role, joinedAt: new Date().toISOString(), userId: em };
  w.members = members;
  await dbService.saveWorkspace(id, w);
  return dbService.getWorkspace(id);
}

function roleForEmail(workspace, email) {
  const aliases = emailAliases(email);
  if (!aliases.length) return 'viewer';
  const ownerEm = String((workspace && workspace.ownerUserId) || '')
    .toLowerCase()
    .trim();
  if (ownerEm) {
    const ownerAliases = emailAliases(ownerEm);
    if (aliases.some((a) => ownerAliases.includes(a))) return 'owner';
  }
  for (const em of aliases) {
    const m = workspace && workspace.members && workspace.members[em];
    if (m && m.role) return m.role;
  }
  return 'viewer';
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
  seesOnlyAssignedLeads,
  ensureWorkspaceAndMember,
  roleForEmail,
  canManageTeam,
  assignablePool,
  orderedRoundRobinPool,
  normalizeRoundRobinOrder,
  pickRoundRobinAssignee,
  userEmail,
  emailAliases,
};
