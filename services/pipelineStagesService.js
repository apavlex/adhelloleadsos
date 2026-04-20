/**
 * Per-workspace pipeline stages (KV: pstage:{workspaceId}:{stageUuid}).
 */
const { randomUUID } = require('crypto');
const dbService = require('./database');
const { normalizeStages, coerceStageDefinitionsForSave } = require('../lib/pipeline/normalize');
const { PRESETS } = require('../lib/pipeline/presets');

function storageKey(workspaceId, stageId) {
  return `pstage:${workspaceId}:${stageId}`;
}

async function listStages(workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const prefix = `pstage:${wid}:`;
  const keys = await dbService.listStorageKeysWithPrefix(prefix);
  const rows = [];
  for (const k of keys) {
    const raw = await dbService.peekStorageKey(k);
    if (!raw) continue;
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && o.id && o.workspaceId === wid) rows.push(o);
    } catch (_) {
      /* skip */
    }
  }
  rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return rows;
}

function normalizedPresetToRows(workspaceId, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset || !Array.isArray(preset.stages)) return [];
  const norm = normalizeStages(
    preset.stages.map((s) => ({
      key: s.key,
      name: s.name,
      color: s.color,
      slaHours: s.slaHours,
      isWon: s.isWon,
      isLost: s.isLost,
    }))
  );
  const now = new Date().toISOString();
  return norm.map((s, i) => ({
    id: randomUUID(),
    workspaceId,
    key: s.key,
    name: s.name,
    color: s.color,
    sortOrder: i,
    isWon: s.isWon,
    isLost: s.isLost,
    slaHours: s.slaHours,
    description: null,
    createdAt: now,
  }));
}

async function putStageRow(row) {
  await dbService.putStorageKey(storageKey(row.workspaceId, row.id), JSON.stringify(row));
}

async function saveStageRows(workspaceId, rows) {
  for (const row of rows) {
    await putStageRow({ ...row, workspaceId });
  }
}

async function deleteAllStages(workspaceId) {
  const prefix = `pstage:${workspaceId}:`;
  const keys = await dbService.listStorageKeysWithPrefix(prefix);
  for (const k of keys) {
    await dbService.deleteStorageKey(k);
  }
}

/**
 * @param {Array<object>} normalizedFromWizard - output of normalizeStages (no ids)
 */
async function persistNormalizedStages(workspaceId, normalized) {
  const wid = String(workspaceId || '').trim();
  const now = new Date().toISOString();
  const rows = normalized.map((s, i) => ({
    id: randomUUID(),
    workspaceId: wid,
    key: s.key,
    name: s.name,
    color: s.color,
    sortOrder: i,
    isWon: s.isWon,
    isLost: s.isLost,
    slaHours: s.slaHours,
    description: null,
    createdAt: now,
  }));
  await saveStageRows(wid, rows);
  return rows;
}

async function getDefaultStageIdForWorkspace(workspaceId) {
  const stages = await listStages(workspaceId);
  if (!stages.length) return null;
  const firstOpen = stages.find((s) => !s.isWon && !s.isLost);
  return (firstOpen || stages[0]).id;
}

/** 1-based index in sorted stages for legacy metrics code */
function stageIndex1Based(stages, stageId) {
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx < 0) return 1;
  return idx + 1;
}

function resolveStageIdForLead(lead, stages) {
  if (!stages.length) return null;
  if (lead.stageId && stages.some((s) => s.id === lead.stageId)) return lead.stageId;
  const legacy = parseInt(lead.legacyStageNumber ?? lead.pipelineStage, 10);
  const n = Number.isFinite(legacy) ? legacy : 1;
  const maxLegacy = 10;
  const clamped = Math.min(Math.max(1, n), maxLegacy);
  const denom = Math.max(1, maxLegacy - 1);
  const idx = Math.round(((clamped - 1) * (stages.length - 1)) / denom);
  const safe = Math.min(Math.max(0, idx), stages.length - 1);
  return stages[safe].id;
}

function patchLeadStageFields(lead, stages, stageId) {
  const row = stages.find((s) => s.id === stageId);
  if (!row) return {};
  const idx = stageIndex1Based(stages, stageId);
  return {
    stageId,
    pipelineStageKey: row.key,
    pipelineStage: idx,
    pipelineStageUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Shape for EJS / kanban: id = uuid string (was numeric 1–10).
 */
function stagesForKanban(stages) {
  return stages.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    color: s.color,
    sortOrder: s.sortOrder,
    isWon: s.isWon,
    isLost: s.isLost,
    description: s.description || '',
    slaHours: s.slaHours,
  }));
}

async function seedWorkspaceFromPreset(workspaceId, presetKey = 'agency') {
  const wid = String(workspaceId || '').trim();
  if (!wid) return [];
  const existing = await listStages(wid);
  if (existing.length > 0) return existing;
  const rows = normalizedPresetToRows(wid, presetKey);
  await saveStageRows(wid, rows);
  return rows;
}

async function backfillLeadsForWorkspace(workspaceId, stages) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !stages.length) return 0;
  const leads = await dbService.getAllLeads(wid);
  let n = 0;
  for (const lead of leads) {
    const sid = resolveStageIdForLead(lead, stages);
    const legacyNum = parseInt(lead.pipelineStage, 10);
    const patch = {
      ...patchLeadStageFields(lead, stages, sid),
      legacyStageNumber: Number.isFinite(legacyNum) ? legacyNum : lead.legacyStageNumber ?? null,
    };
    const legacyOk = lead.legacyStageNumber != null || !Number.isFinite(legacyNum);
    if (lead.stageId === sid && legacyOk && lead.pipelineStageKey) continue;
    await dbService.updateLead(lead.key, patch, wid);
    n += 1;
  }
  return n;
}

let seedPromise = null;
async function ensureWorkspaceStagesSeeded(workspaceId) {
  const stages = await listStages(workspaceId);
  if (stages.length > 0) return stages;
  await seedWorkspaceFromPreset(workspaceId, 'agency');
  return listStages(workspaceId);
}

async function ensureAllWorkspacesSeeded() {
  const ids = await dbService.listWorkspaceIds();
  for (const wid of ids) {
    const stages = await listStages(wid);
    if (stages.length) continue;
    const seeded = await seedWorkspaceFromPreset(wid, 'agency');
    await backfillLeadsForWorkspace(wid, seeded);
    console.log(`[pipeline] Seeded agency preset for workspace ${wid}`);
  }
}

function runGlobalPipelineSeedOnce() {
  if (seedPromise) return seedPromise;
  seedPromise = ensureAllWorkspacesSeeded().catch((e) => {
    console.error('[pipeline] Global seed failed:', e.message);
  });
  return seedPromise;
}

async function countLeadsByStageId(workspaceId) {
  const leads = await dbService.getAllLeads(workspaceId);
  const counts = {};
  for (const l of leads) {
    const id = l.stageId || 'none';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

async function updateStageDescription(workspaceId, stageId, description) {
  const stages = await listStages(workspaceId);
  const row = stages.find((s) => s.id === stageId);
  if (!row) return null;
  const next = { ...row, description: String(description || '').trim() || null };
  await putStageRow(next);
  return next;
}

/**
 * Replace stages and map old stage ids → new stage ids for leads. No SQL transaction (KV).
 */
async function replaceStagesWithMapping(workspaceId, newRows, oldToNewId) {
  const wid = String(workspaceId || '').trim();
  const leads = await dbService.getAllLeads(wid);
  await deleteAllStages(wid);
  await saveStageRows(wid, newRows);
  const map = oldToNewId && typeof oldToNewId === 'object' ? oldToNewId : {};
  for (const lead of leads) {
    let sid = lead.stageId;
    if (sid && map[sid]) sid = map[sid];
    if (!sid || !newRows.some((r) => r.id === sid)) {
      sid = resolveStageIdForLead({ ...lead, stageId: null }, newRows);
    }
    const patch = patchLeadStageFields(lead, newRows, sid);
    await dbService.updateLead(lead.key, patch, wid);
  }
}

async function leadCountForStage(workspaceId, stageId) {
  const counts = await countLeadsByStageId(workspaceId);
  return counts[stageId] || 0;
}

/**
 * Replace stage rows from the settings / wizard editor (stable ids when provided).
 * @param {Array<object>} stagePayloads — rows with optional id, key, name, color, isWon, isLost, slaHours, sortOrder
 */
async function saveStagesFromEditor(workspaceId, stagePayloads, deleteStageIds = []) {
  const wid = String(workspaceId || '').trim();
  const existing = await listStages(wid);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const toDelete = new Set((deleteStageIds || []).map(String));

  for (const sid of toDelete) {
    const c = await leadCountForStage(wid, sid);
    if (c > 0) {
      const err = new Error('STAGE_HAS_LEADS');
      err.code = 'STAGE_HAS_LEADS';
      err.stageId = sid;
      err.count = c;
      throw err;
    }
    await dbService.deleteStorageKey(storageKey(wid, sid));
  }

  const sorted = [...(stagePayloads || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const coerced = coerceStageDefinitionsForSave(sorted);

  const keptIds = new Set();
  const rows = coerced.map((s, i) => {
    const src = sorted[i] || {};
    const prevId = src.id && byId.has(String(src.id)) ? String(src.id) : null;
    const id = prevId || randomUUID();
    keptIds.add(id);
    const prev = prevId ? byId.get(prevId) : null;
    return {
      id,
      workspaceId: wid,
      key: s.key,
      name: s.name,
      color: s.color,
      sortOrder: i,
      isWon: s.isWon,
      isLost: s.isLost,
      slaHours: s.slaHours,
      description: prev && prev.description != null ? prev.description : null,
      createdAt: prev && prev.createdAt ? prev.createdAt : new Date().toISOString(),
    };
  });

  const oldIds = new Set(existing.map((r) => r.id));
  for (const oid of oldIds) {
    if (!keptIds.has(oid) && !toDelete.has(oid)) {
      const c = await leadCountForStage(wid, oid);
      if (c > 0) {
        const err = new Error('STAGE_HAS_LEADS');
        err.code = 'STAGE_HAS_LEADS';
        err.stageId = oid;
        err.count = c;
        throw err;
      }
      await dbService.deleteStorageKey(storageKey(wid, oid));
    }
  }

  await saveStageRows(wid, rows);
  const leads = await dbService.getAllLeads(wid);
  for (const lead of leads) {
    if (lead.stageId && rows.some((r) => r.id === lead.stageId)) continue;
    const sid = resolveStageIdForLead(lead, rows);
    const patch = patchLeadStageFields(lead, rows, sid);
    await dbService.updateLead(lead.key, patch, wid);
  }
  return rows;
}

module.exports = {
  listStages,
  saveStageRows,
  persistNormalizedStages,
  normalizedPresetToRows,
  seedWorkspaceFromPreset,
  getDefaultStageIdForWorkspace,
  stagesForKanban,
  resolveStageIdForLead,
  patchLeadStageFields,
  stageIndex1Based,
  backfillLeadsForWorkspace,
  ensureWorkspaceStagesSeeded,
  ensureAllWorkspacesSeeded,
  runGlobalPipelineSeedOnce,
  countLeadsByStageId,
  updateStageDescription,
  replaceStagesWithMapping,
  deleteAllStages,
  normalizeStages,
  PRESETS,
  saveStagesFromEditor,
  leadCountForStage,
};
