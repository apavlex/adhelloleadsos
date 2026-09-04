const dbService = require('./database');
const {
  listBuiltinSops,
  getBuiltinSopById,
  normalizeSop,
  newSopId,
} = require('../config/sops');

async function ensureBuiltinSopsSeeded(workspaceId) {
  const wid = String(workspaceId || 'default').trim();
  const existing = await dbService.listWorkspaceSops(wid);
  const have = new Set(existing.map((s) => String(s.id || '').toLowerCase()));
  const seeded = [];
  for (const builtin of listBuiltinSops()) {
    if (have.has(builtin.id)) continue;
    const saved = await dbService.saveWorkspaceSop(wid, {
      ...builtin,
      builtin: true,
    });
    seeded.push(saved);
  }
  return seeded;
}

async function listSopsForWorkspace(workspaceId) {
  await ensureBuiltinSopsSeeded(workspaceId);
  return dbService.listWorkspaceSops(workspaceId);
}

async function getSopForWorkspace(workspaceId, sopId) {
  await ensureBuiltinSopsSeeded(workspaceId);
  const hit = await dbService.getWorkspaceSop(workspaceId, sopId);
  if (hit) return hit;
  return getBuiltinSopById(sopId);
}

async function createSop(workspaceId, body, updatedBy) {
  const draft = {
    ...body,
    id: body && body.id ? body.id : newSopId(body && body.title),
    builtin: false,
  };
  const sop = normalizeSop(draft, { updatedBy });
  const existing = await dbService.getWorkspaceSop(workspaceId, sop.id);
  if (existing) {
    sop.id = newSopId(sop.title);
  }
  return dbService.saveWorkspaceSop(workspaceId, sop);
}

async function updateSop(workspaceId, sopId, body, updatedBy) {
  const prev = await dbService.getWorkspaceSop(workspaceId, sopId);
  const builtin = getBuiltinSopById(sopId);
  const base = prev || builtin;
  if (!base) throw new Error('SOP not found.');
  const sop = normalizeSop(
    {
      ...base,
      ...body,
      id: sopId,
      builtin: !!(prev && prev.builtin) || !!builtin,
      createdAt: (prev && prev.createdAt) || (builtin && builtin.createdAt),
    },
    { updatedBy },
  );
  return dbService.saveWorkspaceSop(workspaceId, sop);
}

async function deleteSop(workspaceId, sopId) {
  const id = String(sopId || '').trim();
  const prev = await dbService.getWorkspaceSop(workspaceId, id);
  const builtin = getBuiltinSopById(id);
  await dbService.deleteWorkspaceSop(workspaceId, id);
  // Deleting a builtin seed: write a tombstone so it is not re-seeded.
  if (builtin) {
    await dbService.saveWorkspaceSop(workspaceId, {
      id,
      title: builtin.title,
      purpose: '',
      owner: '',
      trigger: '',
      successMeasure: '',
      relatedPaths: [],
      steps: ['(Removed)'],
      builtin: true,
      deleted: true,
      createdAt: (prev && prev.createdAt) || builtin.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }
}

function visibleSops(list) {
  return (list || []).filter((s) => s && !s.deleted);
}

module.exports = {
  ensureBuiltinSopsSeeded,
  listSopsForWorkspace,
  getSopForWorkspace,
  createSop,
  updateSop,
  deleteSop,
  visibleSops,
};
