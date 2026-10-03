/**
 * Workspace automation tools for MCP clients and the in-app chat: overview, opportunity boards
 * (list, stages, pipelines, deal cards), prospecting stages, tags, folders, lead create/delete/
 * notes/assignment, lead history, recent replies and the team activity feed. Each write mirrors the
 * matching app route and lands in Team history under the assistant's name.
 */
const { z } = require('zod/v3');
const { zodToJsonSchema } = require('zod-to-json-schema');
const dbService = require('../database');
const workspaceService = require('../workspaceService');
const teamActivity = require('../teamActivity');
const pipelineStagesService = require('../pipelineStagesService');
const { filterBusinessPipelineLeads } = require('../leadListFilters');
const {
  normalizeBoards,
  buildOpportunityBoard,
  addStage,
  renameStage,
  renamePipeline,
  removePipeline,
  removeStage,
  selectPipeline,
} = require('../opportunityBoards');
const { moveFolder } = require('../folderMove');
const { deleteFolderComplete } = require('../pipelineFolders');
const { triggerGhlProspectSync } = require('../ghlProspectSync');
const { resolveLeadKey, resolveFolderRef, buildReqLike } = require('./mcpCrmService');
const { listTeamMembers, matchMember } = require('./mcpPavlexOps');
const { resolvePerson } = require('./mcpLeadPeople');

const MAX_BULK = 100;
const MAX_DELETE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function toolError(message, code = 'WORKSPACE_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' ? s : '';
}

function record(ctx, entry) {
  return teamActivity.record(teamActivity.toolActivityContext(ctx), {
    ...entry,
    meta: { ...(entry.meta || {}), via: 'pavlex' },
  });
}

async function roleOf(ctx) {
  const ws = await dbService.getWorkspace(ctx.workspaceId);
  if (!ws) throw toolError('Workspace not found.', 'NOT_FOUND');
  return { ws, role: workspaceService.roleForEmail(ws, ctx.userEmail || '') };
}

async function requireWriter(ctx) {
  const { ws, role } = await roleOf(ctx);
  if (role === 'viewer') {
    throw toolError('Viewers can\'t change this workspace. Ask an owner or admin for member access.', 'FORBIDDEN');
  }
  return ws;
}

async function requireManager(ctx, what) {
  if (ctx && ctx.canManage === true) return;
  const { role } = await roleOf(ctx);
  if (!workspaceService.canManageTeam(role)) {
    throw toolError(`Only workspace owners and admins can ${what}.`, 'FORBIDDEN');
  }
}

async function visibleLeads(ctx) {
  const all = await dbService.getAllLeads(ctx.workspaceId);
  return workspaceService.filterLeadsForRequest(buildReqLike(ctx.workspaceId, ctx.userEmail), all);
}

function uniqueIds(list) {
  return [...new Set((list || []).map((v) => String(v || '').trim()).filter(Boolean))];
}

/** Resolve each id to a lead in this workspace; misses become per-lead errors instead of failing the batch. */
async function resolveMany(ctx, ids) {
  const found = [];
  const missing = [];
  for (const id of uniqueIds(ids)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { fullKey, lead } = await resolveLeadKey(ctx.workspaceId, id);
      found.push({ id, key: fullKey, lead });
    } catch (e) {
      missing.push({ lead_id: id, success: false, error: e.message, code: e.code || 'NOT_FOUND' });
    }
  }
  return { found, missing };
}

/* ---------- opportunity boards ---------- */

async function loadBoards(workspaceId) {
  const stored = await dbService.getWorkspace(workspaceId);
  const workspace = stored || { id: workspaceId };
  const boards = normalizeBoards(workspace.opportunityBoards).boards;
  if (stored && !workspace.opportunityBoards) {
    workspace.opportunityBoards = boards;
    await dbService.saveWorkspace(workspaceId, workspace);
  }
  return { workspace, boards };
}

async function saveBoards(ctx, workspace, boards) {
  workspace.opportunityBoards = normalizeBoards(boards).boards;
  await dbService.saveWorkspace(ctx.workspaceId, workspace);
}

function findByRef(list, ref, kind) {
  const want = String(ref || '').trim().toLowerCase();
  if (!want) return null;
  const hit =
    list.find((x) => String(x.id).toLowerCase() === want) ||
    list.find((x) => String(x.name || '').toLowerCase() === want);
  if (hit) return hit;
  const partial = list.filter((x) => String(x.name || '').toLowerCase().includes(want));
  if (partial.length === 1) return partial[0];
  const names = list.map((x) => x.name).join(', ') || 'none';
  if (partial.length > 1) throw toolError(`"${ref}" matches several ${kind}s: ${partial.map((x) => x.name).join(', ')}. Use the exact name.`, 'AMBIGUOUS');
  throw toolError(`No ${kind} named "${ref}". ${kind[0].toUpperCase()}${kind.slice(1)}s: ${names}.`, 'NOT_FOUND');
}

function pickPipeline(boards, ref) {
  if (!clean(ref)) return boards.pipelines.find((p) => p.id === boards.activePipelineId) || boards.pipelines[0];
  return findByRef(boards.pipelines, ref, 'pipeline');
}

/** Stage by id/name inside the given pipeline, or across all pipelines when none was named. */
function pickStage(boards, pipeline, ref, pipelineNamed) {
  if (pipelineNamed || !clean(ref)) return { pipeline, stage: findByRef(pipeline.stages, ref, 'stage') };
  const all = boards.pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p })));
  const want = String(ref).trim().toLowerCase();
  const byId = all.find((s) => String(s.id).toLowerCase() === want);
  if (byId) return { pipeline: byId.pipeline, stage: byId };
  return { pipeline, stage: findByRef(pipeline.stages, ref, 'stage') };
}

async function listOpportunities(ctx, input) {
  const { boards } = await loadBoards(ctx.workspaceId);
  const pipeline = pickPipeline(boards, input.pipeline);
  const stageFilter = clean(input.stage) ? findByRef(pipeline.stages, input.stage, 'stage') : null;
  const leads = filterBusinessPipelineLeads(await visibleLeads(ctx));
  const email = clean(ctx.userEmail);
  const tasks = email ? await dbService.listUserTasks(ctx.workspaceId, email) : [];
  const board = buildOpportunityBoard({ boards, leads, tasks, pipelineId: pipeline.id });
  const rows = [];
  for (const stage of board.stages) {
    if (stageFilter && stage.id !== stageFilter.id) continue;
    for (const card of stage.cards) {
      rows.push({
        lead_id: card.key,
        title: card.title,
        stage: stage.name,
        stage_id: stage.id,
        value: card.value,
        status: card.status || '',
        source: card.source || '',
        phone: card.phone || '',
        email: card.email || '',
        city: card.city || '',
        category: card.category || '',
        last_note: card.note || '',
      });
    }
  }
  const limit = input.limit || 50;
  const offset = input.offset || 0;
  return {
    pipeline: board.pipeline,
    stages: board.stages.map((s) => ({ id: s.id, name: s.name, count: s.count, value: s.value })),
    total: rows.length,
    total_value: rows.reduce((sum, r) => sum + r.value, 0),
    offset,
    opportunities: rows.slice(offset, offset + limit),
    has_more: offset + limit < rows.length,
  };
}

async function manageOpportunityPipeline(ctx, input) {
  await requireWriter(ctx);
  const { action } = input;
  if (action === 'delete_pipeline' || action === 'delete_stage') {
    await requireManager(ctx, 'delete opportunity pipelines or stages');
  }
  const { workspace, boards } = await loadBoards(ctx.workspaceId);
  const pipelineNamed = !!clean(input.pipeline);
  const pipeline = pickPipeline(boards, input.pipeline);
  const name = clean(input.name);
  const needName = () => {
    if (!name) throw toolError('`name` is required for this action.', 'INVALID_ARGUMENTS');
  };
  const fail = (result) => {
    if (!result.ok) throw toolError(result.error || 'Could not update the pipeline.', 'INVALID_ARGUMENTS');
    return result;
  };
  const log = (summary) => record(ctx, { category: 'pipeline', action: 'opportunity_board_edit', summary });

  if (action === 'rename_pipeline') {
    needName();
    const r = fail(renamePipeline(boards, pipeline.id, name));
    await saveBoards(ctx, workspace, r.boards);
    log(`Renamed pipeline "${pipeline.name}" → "${name}"`);
    return { message: `Renamed pipeline "${pipeline.name}" to "${name}".`, pipeline_id: pipeline.id };
  }
  if (action === 'set_active_pipeline') {
    const r = selectPipeline(boards, pipeline.id);
    if (r.changed) await saveBoards(ctx, workspace, r.boards);
    return { message: `"${pipeline.name}" is now the default opportunity pipeline.`, pipeline_id: pipeline.id };
  }
  if (action === 'delete_pipeline') {
    if (!pipelineNamed) throw toolError('Name the pipeline to delete.', 'INVALID_ARGUMENTS');
    const r = fail(removePipeline(boards, pipeline.id));
    await saveBoards(ctx, workspace, r.boards);
    const stageSet = new Set((r.stageIds || []).map(String));
    let cleared = 0;
    for (const lead of await dbService.getAllLeads(ctx.workspaceId)) {
      const onPipeline = String(lead.opportunityPipelineId || '') === String(r.removedPipelineId);
      if (!onPipeline && !stageSet.has(String(lead.opportunityStageId || ''))) continue;
      // eslint-disable-next-line no-await-in-loop
      await dbService.updateLead(lead.key, { opportunityPipelineId: '', opportunityStageId: '' }, ctx.workspaceId);
      cleared += 1;
    }
    log(`Deleted pipeline "${pipeline.name}" (${cleared} card${cleared === 1 ? '' : 's'} cleared)`);
    return { message: `Deleted pipeline "${pipeline.name}". ${cleared} lead(s) were taken off it; the leads themselves are kept.`, cleared, active_pipeline_id: r.activePipelineId };
  }
  if (action === 'add_stage') {
    needName();
    const r = fail(addStage(boards, pipeline.id, name));
    await saveBoards(ctx, workspace, r.boards);
    log(`Added stage "${name}" to pipeline "${pipeline.name}"`);
    return { message: `Added stage "${name}" to "${pipeline.name}".`, pipeline_id: pipeline.id, stage_id: r.stageId };
  }
  if (!clean(input.stage)) throw toolError('Name the stage (`stage`).', 'INVALID_ARGUMENTS');
  const { pipeline: owner, stage } = pickStage(boards, pipeline, input.stage, pipelineNamed);
  if (action === 'rename_stage') {
    needName();
    const r = fail(renameStage(boards, stage.id, name));
    await saveBoards(ctx, workspace, r.boards);
    log(`Renamed stage "${stage.name}" → "${name}" in "${owner.name}"`);
    return { message: `Renamed stage "${stage.name}" to "${name}" in "${owner.name}".`, stage_id: stage.id };
  }
  if (action === 'delete_stage') {
    const r = fail(removeStage(boards, stage.id));
    await saveBoards(ctx, workspace, r.boards);
    let moved = 0;
    for (const lead of await dbService.getAllLeads(ctx.workspaceId)) {
      if (String(lead.opportunityStageId || '') !== String(stage.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      await dbService.updateLead(lead.key, { opportunityPipelineId: r.pipelineId, opportunityStageId: r.fallbackStageId }, ctx.workspaceId);
      moved += 1;
    }
    const fallback = (r.boards.pipelines.find((p) => p.id === r.pipelineId) || { stages: [] }).stages.find((s) => s.id === r.fallbackStageId);
    log(`Deleted stage "${stage.name}" from "${owner.name}"`);
    return {
      message: `Deleted stage "${stage.name}" from "${owner.name}".${moved ? ` ${moved} card(s) moved to "${(fallback && fallback.name) || 'the first stage'}".` : ''}`,
      moved,
    };
  }
  throw toolError(`Unknown action: ${action}`, 'INVALID_ARGUMENTS');
}

async function createOpportunity(ctx, input) {
  await requireWriter(ctx);
  const { workspace, boards } = await loadBoards(ctx.workspaceId);
  const pipelineNamed = !!clean(input.pipeline);
  const pipeline = pickPipeline(boards, input.pipeline);
  const { pipeline: owner, stage } = clean(input.stage)
    ? pickStage(boards, pipeline, input.stage, pipelineNamed)
    : { pipeline, stage: pipeline.stages[0] };
  const source = clean(input.source).slice(0, 40);
  const { key, merged } = await dbService.saveLeadWithMeta({
    title: input.title.trim().slice(0, 120),
    phone: clean(input.phone) || 'N/A',
    email: clean(input.email) || 'N/A',
    website: clean(input.website) || 'N/A',
    address: 'N/A',
    city: clean(input.city),
    state: clean(input.state),
    categoryName: clean(input.category) || 'Offline / word of mouth',
    status: 'Not Contacted',
    source: 'manual_offline',
    tags: /referral/i.test(source) ? ['referral'] : [],
    opportunityPipelineId: owner.id,
    opportunityStageId: stage.id,
    opportunityDismissed: false,
    opportunitySource: source,
    opportunityValue: input.value > 0 ? input.value : 0,
    onPipelineBoard: true,
    workspaceId: ctx.workspaceId,
    savedAt: new Date().toISOString(),
  });
  const remembered = selectPipeline(boards, owner.id);
  if (remembered.changed) await saveBoards(ctx, workspace, remembered.boards);
  record(ctx, {
    category: 'leads',
    action: 'opportunity_card_add',
    summary: `Added opportunity card in ${owner.name} → ${stage.name}`,
    leadKey: key,
    leadTitle: input.title,
    created: !merged,
  });
  return {
    message: merged
      ? `"${input.title}" matched an existing lead (same phone/email/website), so it was placed in ${owner.name} → ${stage.name} instead of creating a duplicate.`
      : `Added "${input.title}" to ${owner.name} → ${stage.name}.`,
    lead_id: key,
    merged_with_existing: !!merged,
    pipeline: owner.name,
    stage: stage.name,
  };
}

async function removeOpportunities(ctx, input) {
  await requireWriter(ctx);
  const { found, missing } = await resolveMany(ctx, input.lead_ids);
  const results = [...missing];
  for (const { key, lead } of found) {
    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(key, { opportunityPipelineId: '', opportunityStageId: '', opportunityDismissed: true }, ctx.workspaceId);
    record(ctx, { category: 'pipeline', action: 'opportunity_remove', summary: 'Removed from opportunities', leadKey: key, leadTitle: lead.title || '' });
    results.push({ lead_id: key, title: lead.title || '', success: true });
  }
  const removed = results.filter((r) => r.success).length;
  return { message: `Removed ${removed} lead(s) from the opportunity board. The leads stay in the CRM.`, removed, results };
}

/* ---------- prospecting stages ---------- */

async function listLeadStages(ctx) {
  const stages = await pipelineStagesService.ensureWorkspaceStagesSeeded(ctx.workspaceId);
  const leads = await visibleLeads(ctx);
  const byStage = {};
  const byStatus = {};
  for (const lead of leads) {
    const sid = lead.stageId || 'none';
    byStage[sid] = (byStage[sid] || 0) + 1;
    const st = clean(lead.status) || 'Not Contacted';
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  return {
    stages: pipelineStagesService.stagesForKanban(stages).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      is_won: !!s.isWon,
      is_lost: !!s.isLost,
      lead_count: byStage[s.id] || 0,
    })),
    leads_without_stage: byStage.none || 0,
    statuses: Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count })),
  };
}

async function setLeadStage(ctx, input) {
  await requireWriter(ctx);
  const stages = await pipelineStagesService.ensureWorkspaceStagesSeeded(ctx.workspaceId);
  const stage = findByRef(stages.map((s) => ({ ...s, name: s.name || s.key })), input.stage, 'stage');
  const { found, missing } = await resolveMany(ctx, input.lead_ids);
  const results = [...missing];
  const now = new Date().toISOString();
  for (const { key, lead } of found) {
    const patch = { ...pipelineStagesService.patchLeadStageFields(lead, stages, stage.id), pipelineStageUpdatedAt: now, onPipelineBoard: true };
    if (clean(input.status)) patch.status = clean(input.status);
    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(key, patch, ctx.workspaceId);
    results.push({ lead_id: key, title: lead.title || '', success: true });
  }
  const moved = results.filter((r) => r.success);
  if (moved.length) {
    record(ctx, {
      category: 'pipeline',
      action: 'bulk_stage',
      summary: `Moved ${moved.length} lead${moved.length === 1 ? '' : 's'} to stage "${stage.name}"`,
      leadKeys: moved.map((r) => r.lead_id),
      ...(moved.length === 1 ? { leadTitle: moved[0].title } : {}),
    });
  }
  return { message: `Moved ${moved.length} lead(s) to "${stage.name}".`, stage: stage.name, moved: moved.length, results };
}

/* ---------- tags ---------- */

async function manageTags(ctx, input) {
  await requireWriter(ctx);
  const wid = ctx.workspaceId;
  const name = clean(input.name);
  if (input.action === 'create') {
    const label = name || clean(input.tag);
    if (!label) throw toolError('`name` is required to create a tag.', 'INVALID_ARGUMENTS');
    const existing = (await dbService.listTags(wid)).find((t) => String(t.name || '').toLowerCase() === label.toLowerCase());
    if (existing) {
      if (existing.isActive === false) await dbService.setTagActive(wid, existing.key, true);
      return { message: `Tag "${existing.name}" already exists${existing.isActive === false ? ' and was restored' : ''}.`, tag: { key: existing.key, name: existing.name } };
    }
    const tag = await dbService.createTag(wid, label, clean(input.color) || undefined);
    record(ctx, { category: 'tags', action: 'tag_create', summary: `Created tag "${label}"` });
    return { message: `Created tag "${label}".`, tag: { key: tag.key, name: tag.name, color: tag.color } };
  }
  const tags = await dbService.listTags(wid);
  const tag = findByRef(tags.map((t) => ({ ...t, id: t.key })), input.tag, 'tag');
  if (input.action === 'rename') {
    if (!name) throw toolError('`name` is required to rename a tag.', 'INVALID_ARGUMENTS');
    await dbService.renameTag(wid, tag.key, name);
    record(ctx, { category: 'tags', action: 'tag_rename', summary: `Renamed tag "${tag.name}" → "${name}"` });
    return { message: `Renamed tag "${tag.name}" to "${name}".` };
  }
  if (input.action === 'recolor') {
    if (!clean(input.color)) throw toolError('`color` is required, e.g. "#22c55e".', 'INVALID_ARGUMENTS');
    await dbService.setTagColor(wid, tag.key, clean(input.color));
    return { message: `Tag "${tag.name}" is now ${clean(input.color)}.` };
  }
  if (input.action === 'archive' || input.action === 'restore') {
    await dbService.setTagActive(wid, tag.key, input.action === 'restore');
    record(ctx, { category: 'tags', action: 'tag_edit', summary: `${input.action === 'restore' ? 'Restored' : 'Archived'} tag "${tag.name}"` });
    return { message: `${input.action === 'restore' ? 'Restored' : 'Archived'} tag "${tag.name}".` };
  }
  if (input.action === 'delete') {
    await dbService.deleteTag(wid, tag.key);
    record(ctx, { category: 'tags', action: 'tag_delete', summary: `Deleted tag "${tag.name}"` });
    return { message: `Deleted tag "${tag.name}" and removed it from every lead.` };
  }
  throw toolError(`Unknown action: ${input.action}`, 'INVALID_ARGUMENTS');
}

/* ---------- folders ---------- */

function folderRef(raw) {
  const s = clean(raw);
  return s.startsWith('folder:') ? { folder_id: s } : { folder_id: s, folder_name: s };
}

async function manageFolder(ctx, input) {
  await requireWriter(ctx);
  const folder = await resolveFolderRef(ctx.workspaceId, folderRef(input.folder));
  if (input.action === 'delete') {
    const r = await deleteFolderComplete(ctx.workspaceId, folder.key);
    if (!r.deleted) throw toolError(r.error || 'Folder not found.', 'NOT_FOUND');
    record(ctx, { category: 'leads', action: 'folder_delete', summary: `Deleted folder "${folder.name}"` });
    return { message: `Deleted folder "${folder.name}". ${r.unassigned || 0} lead(s) are now unfiled (not deleted).`, unfiled: r.unassigned || 0 };
  }
  if (input.action === 'move') {
    const parent = clean(input.parent_folder) ? await resolveFolderRef(ctx.workspaceId, folderRef(input.parent_folder)) : null;
    const r = await moveFolder(ctx.workspaceId, folder.key, parent ? parent.key : '');
    if (!r.ok) throw toolError(r.error || 'Could not move folder.', 'INVALID_ARGUMENTS');
    const summary = parent ? `Moved folder "${folder.name}" into "${parent.name}"` : `Moved folder "${folder.name}" to top level`;
    record(ctx, { category: 'leads', action: 'folder_move', summary });
    return { message: `${summary}.` };
  }
  throw toolError(`Unknown action: ${input.action}`, 'INVALID_ARGUMENTS');
}

async function moveLeadsToFolder(ctx, input) {
  await requireWriter(ctx);
  const unfile = /^(none|unfiled|no folder)$/i.test(clean(input.folder));
  const folder = unfile ? null : await resolveFolderRef(ctx.workspaceId, folderRef(input.folder));
  const { found, missing } = await resolveMany(ctx, input.lead_ids);
  const results = [...missing];
  for (const { key, lead } of found) {
    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(key, { folderKey: folder ? folder.key : '' }, ctx.workspaceId);
    results.push({ lead_id: key, title: lead.title || '', success: true });
  }
  const moved = results.filter((r) => r.success).length;
  const where = folder ? `"${folder.name}"` : 'no folder';
  if (moved) {
    record(ctx, {
      category: 'pipeline',
      action: 'folder_assign',
      summary: `Moved ${moved} lead${moved === 1 ? '' : 's'} to ${where}`,
      leadKeys: results.filter((r) => r.success).map((r) => r.lead_id),
    });
  }
  return { message: `Moved ${moved} lead(s) to ${where}.`, moved, results };
}

/* ---------- leads ---------- */

async function createLead(ctx, input) {
  await requireWriter(ctx);
  const folder = clean(input.folder) ? await resolveFolderRef(ctx.workspaceId, folderRef(input.folder)) : null;
  let tagKeys = [];
  if (input.tags && input.tags.length) {
    const tags = await dbService.listTags(ctx.workspaceId);
    for (const raw of input.tags) {
      const label = clean(raw);
      if (!label) continue;
      let hit = tags.find((t) => String(t.name || '').toLowerCase() === label.toLowerCase());
      // eslint-disable-next-line no-await-in-loop
      if (!hit) hit = await dbService.createTag(ctx.workspaceId, label);
      tagKeys.push(hit.key);
    }
    tagKeys = [...new Set(tagKeys)];
  }
  const now = new Date().toISOString();
  const { key, merged } = await dbService.saveLeadWithMeta({
    title: input.title.trim().slice(0, 160),
    phone: clean(input.phone) || 'N/A',
    email: clean(input.email) || 'N/A',
    website: clean(input.website) || 'N/A',
    address: clean(input.address) || 'N/A',
    city: clean(input.city),
    state: clean(input.state),
    categoryName: clean(input.category),
    status: 'Not Contacted',
    source: 'manual',
    tags: tagKeys,
    ...(folder ? { folderKey: folder.key } : {}),
    ...(clean(input.note) ? { updates: [{ type: 'note', value: clean(input.note), timestamp: now, source: 'ai_assistant' }] } : {}),
    workspaceId: ctx.workspaceId,
    savedAt: now,
  });
  record(ctx, { category: 'leads', action: merged ? 'lead_edit' : 'lead_create', summary: merged ? 'Updated existing lead (duplicate)' : 'Created lead', leadKey: key, leadTitle: input.title, created: !merged });
  return {
    message: merged ? `"${input.title}" already exists (same phone/email/website); merged into that lead.` : `Created lead "${input.title}".`,
    lead_id: key,
    merged_with_existing: !!merged,
    ...(folder ? { folder: folder.name } : {}),
  };
}

async function deleteLeads(ctx, input) {
  await requireWriter(ctx);
  if (input.confirm !== true) {
    throw toolError('Deleting leads is permanent. Confirm with the user, then call again with confirm: true.', 'CONFIRMATION_REQUIRED');
  }
  const { found, missing } = await resolveMany(ctx, input.lead_ids);
  const results = [...missing];
  for (const { key, lead } of found) {
    // eslint-disable-next-line no-await-in-loop
    await dbService.deleteLead(key);
    results.push({ lead_id: key, title: lead.title || '', success: true });
  }
  const deleted = results.filter((r) => r.success);
  if (deleted.length) {
    record(ctx, {
      category: 'leads',
      action: 'bulk_delete',
      summary: `Deleted ${deleted.length} lead${deleted.length === 1 ? '' : 's'}: ${deleted.slice(0, 5).map((r) => r.title).filter(Boolean).join(', ')}`,
      leadCount: deleted.length,
      attribute: false,
    });
  }
  return { message: `Deleted ${deleted.length} lead(s).`, deleted: deleted.length, results };
}

async function addLeadNote(ctx, input) {
  await requireWriter(ctx);
  const { fullKey, lead } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const content = input.note.trim();
  const ts = new Date().toISOString();
  const by = teamActivity.toolActivityContext(ctx);
  const author = (by && by.actor && (by.actor.name || by.actor.email)) || clean(ctx.clientName) || 'AI assistant';
  const entry = { type: 'note', value: content, timestamp: ts, source: 'ai_assistant', by: author };
  const updates = [...(Array.isArray(lead.updates) ? lead.updates : []), entry];
  await dbService.updateLead(fullKey, { updates, logs: [{ type: 'note', message: content, timestamp: ts, by: author }] }, ctx.workspaceId);
  triggerGhlProspectSync(fullKey, ctx.workspaceId, { trigger: 'note_added', note: content });
  record(ctx, { category: 'notes', action: 'note_add', summary: `Note: ${content.slice(0, 200)}`, leadKey: fullKey, leadTitle: lead.title || '' });
  return { message: `Added a note to "${lead.title || fullKey}".`, lead_id: fullKey };
}

async function assignLeads(ctx, input) {
  await requireManager(ctx, 'assign leads');
  const raw = clean(input.assignee);
  const unassign = /^(none|unassigned|nobody)$/i.test(raw);
  const roundRobin = /^round[\s_-]?robin$/i.test(raw);
  let fixed = '';
  if (!unassign && !roundRobin) {
    const { members } = await listTeamMembers(ctx);
    fixed = matchMember(members, /^me$/i.test(raw) ? ctx.userEmail : raw).email;
  }
  const { found, missing } = await resolveMany(ctx, input.lead_ids);
  const results = [...missing];
  for (const { key, lead } of found) {
    // eslint-disable-next-line no-await-in-loop
    const assignee = roundRobin ? await workspaceService.pickRoundRobinAssignee(ctx.workspaceId) : fixed;
    if (roundRobin && !assignee) {
      results.push({ lead_id: key, success: false, error: 'No teammates in the round-robin pool.', code: 'NO_ASSIGNEES' });
      continue;
    }
    const message = unassign ? 'Unassigned' : `${roundRobin ? 'Round-robin assigned' : 'Assigned'} to ${assignee}`;
    // eslint-disable-next-line no-await-in-loop
    await dbService.updateLead(key, { assignedTo: unassign ? '' : assignee, logs: [{ type: 'assignment', message, timestamp: new Date().toISOString() }] }, ctx.workspaceId);
    record(ctx, { category: 'leads', action: 'lead_assign', summary: message, leadKey: key, leadTitle: lead.title || '' });
    results.push({ lead_id: key, title: lead.title || '', assigned_to: unassign ? '' : assignee, success: true });
  }
  const done = results.filter((r) => r.success).length;
  return { message: `${unassign ? 'Unassigned' : 'Assigned'} ${done} lead(s)${fixed ? ` to ${fixed}` : roundRobin ? ' round-robin' : ''}.`, assigned: done, results };
}

/* ---------- reads ---------- */

const INBOUND = { sms_inbound: 'sms', email_inbound: 'email', call_inbound: 'call' };

function entryText(e) {
  return clean(e.value || e.message || e.body || e.note || e.summary || e.subject || e.disposition).slice(0, 600);
}

function isOutbound(type) {
  return /outbound|^sms$|^email$|^call$|^call_log$|^voicemail/.test(String(type || ''));
}

async function getLeadHistory(ctx, input) {
  const { fullKey, lead } = await resolveLeadKey(ctx.workspaceId, input.lead_id);
  const seen = new Set();
  const rows = [];
  const add = (e, from) => {
    if (!e || typeof e !== 'object') return;
    const at = e.timestamp || e.at || e.createdAt || '';
    const text = entryText(e);
    const type = String(e.type || from);
    const dedupe = `${text}|${String(at).slice(0, 16)}`;
    if (!text || seen.has(dedupe)) return;
    seen.add(dedupe);
    rows.push({
      at,
      type,
      direction: INBOUND[type] ? 'inbound' : isOutbound(type) ? 'outbound' : '',
      text,
      ...(e.by ? { by: e.by } : {}),
      ...(e.via ? { via: e.via } : {}),
      ...(e.statusChange ? { status_change: e.statusChange } : {}),
    });
  };
  (Array.isArray(lead.updates) ? lead.updates : []).forEach((e) => add(e, 'update'));
  (Array.isArray(lead.logs) ? lead.logs : []).forEach((e) => add(e, 'log'));
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const types = (input.types || []).map((t) => t.toLowerCase());
  const filtered = types.length ? rows.filter((r) => types.some((t) => r.type.includes(t))) : rows;
  const limit = input.limit || 30;
  return {
    lead_id: fullKey,
    title: lead.title || '',
    status: lead.status || '',
    assigned_to: lead.assignedTo || '',
    total: filtered.length,
    history: filtered.slice(0, limit),
  };
}

async function listRecentReplies(ctx, input) {
  const sinceMs = Date.now() - (input.since_hours || 72) * 60 * 60 * 1000;
  const channel = input.channel || 'any';
  const out = [];
  for (const lead of await visibleLeads(ctx)) {
    const updates = Array.isArray(lead.updates) ? lead.updates : [];
    let lastIn = null;
    let lastOutMs = 0;
    for (const e of updates) {
      const ms = Date.parse((e && e.timestamp) || '');
      if (!Number.isFinite(ms)) continue;
      const ch = INBOUND[e.type];
      if (ch) {
        if (ms >= sinceMs && (channel === 'any' || channel === ch) && (!lastIn || ms > lastIn.ms)) lastIn = { ms, ch, e };
      } else if (isOutbound(e.type) && ms > lastOutMs) {
        lastOutMs = ms;
      }
    }
    if (!lastIn) continue;
    const awaiting = lastOutMs < lastIn.ms;
    if (input.unanswered_only && !awaiting) continue;
    out.push({
      lead_id: lead.key,
      title: lead.title || '',
      channel: lastIn.ch,
      at: new Date(lastIn.ms).toISOString(),
      message: entryText(lastIn.e),
      awaiting_our_reply: awaiting,
      status: lead.status || '',
      phone: clean(lead.phone),
      email: clean(lead.email),
      assigned_to: lead.assignedTo || '',
    });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  const limit = input.limit || 25;
  return { since_hours: input.since_hours || 72, total: out.length, replies: out.slice(0, limit) };
}

async function listTeamActivity(ctx, input) {
  const sinceMs = Date.now() - (input.since_hours || 24) * 60 * 60 * 1000;
  const limit = input.limit || 50;
  let rows;
  let who = 'everyone';
  if (clean(input.person)) {
    const person = await resolvePerson(ctx, input.person);
    who = person.label;
    rows = person.emails.flatMap((email) =>
      dbService.listTeamActivity({ workspaceId: ctx.workspaceId, actorEmail: email, category: input.category, since: sinceMs, limit }),
    );
  } else {
    rows = dbService.listTeamActivity({ workspaceId: ctx.workspaceId, category: input.category, since: sinceMs, limit });
  }
  rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  return {
    who,
    since_hours: input.since_hours || 24,
    count: Math.min(rows.length, limit),
    activity: rows.slice(0, limit).map((r) => ({
      at: new Date(r.created_at).toISOString(),
      by: r.actor_name || r.actor_email,
      ...(teamActivity.isBotEmail(r.actor_email) ? { is_ai_assistant: true, on_behalf_of: (r.meta && r.meta.onBehalfOf) || '' } : {}),
      category: r.category,
      action: r.action,
      summary: r.summary,
      ...(r.lead_key ? { lead_id: r.lead_key, lead_title: r.lead_title || '' } : {}),
      ...(r.lead_count > 1 ? { lead_count: r.lead_count } : {}),
    })),
  };
}

async function getWorkspaceOverview(ctx) {
  const ws = (await dbService.getWorkspace(ctx.workspaceId)) || { id: ctx.workspaceId };
  const leads = await visibleLeads(ctx);
  const now = Date.now();
  const byStatus = {};
  let assignedToMe = 0;
  let bookmarked = 0;
  let newThisWeek = 0;
  let repliesToday = 0;
  let awaitingReply = 0;
  const me = String(ctx.userEmail || '').toLowerCase();
  for (const lead of leads) {
    const st = clean(lead.status) || 'Not Contacted';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (me && String(lead.assignedTo || '').toLowerCase() === me) assignedToMe += 1;
    if (lead.bookmarked) bookmarked += 1;
    const created = Date.parse(lead.savedAt || lead.createdAt || '');
    if (Number.isFinite(created) && now - created < 7 * DAY_MS) newThisWeek += 1;
    let lastIn = 0;
    let lastOut = 0;
    for (const e of Array.isArray(lead.updates) ? lead.updates : []) {
      const ms = Date.parse((e && e.timestamp) || '');
      if (!Number.isFinite(ms)) continue;
      if (INBOUND[e.type]) lastIn = Math.max(lastIn, ms);
      else if (isOutbound(e.type)) lastOut = Math.max(lastOut, ms);
    }
    if (lastIn && now - lastIn < DAY_MS) repliesToday += 1;
    if (lastIn && lastIn > lastOut && now - lastIn < 7 * DAY_MS) awaitingReply += 1;
  }
  const stages = await listLeadStages(ctx);
  const { boards } = await loadBoards(ctx.workspaceId);
  const email = clean(ctx.userEmail);
  const tasks = email ? await dbService.listUserTasks(ctx.workspaceId, email) : [];
  const business = filterBusinessPipelineLeads(leads);
  const pipelines = boards.pipelines.map((p) => {
    const board = buildOpportunityBoard({ boards, leads: business, tasks, pipelineId: p.id });
    return {
      id: p.id,
      name: p.name,
      active: p.id === boards.activePipelineId,
      cards: board.stages.reduce((n, s) => n + s.count, 0),
      value: board.stages.reduce((n, s) => n + s.value, 0),
      stages: board.stages.map((s) => ({ name: s.name, count: s.count, value: s.value })),
    };
  });
  const open = tasks.filter((t) => t && t.column !== 'done' && !t.done);
  const dueMs = (t) => Date.parse(t.scheduledAt || t.dueAt || '');
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const tags = (await dbService.listTags(ctx.workspaceId)).filter((t) => t.isActive !== false);
  const tagCounts = {};
  for (const lead of leads) for (const k of Array.isArray(lead.tags) ? lead.tags : []) tagCounts[k] = (tagCounts[k] || 0) + 1;
  return {
    workspace: { id: ctx.workspaceId, name: ws.name || '' },
    leads: {
      total: leads.length,
      new_this_week: newThisWeek,
      assigned_to_you: assignedToMe,
      bookmarked,
      by_status: Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
    },
    replies: { leads_replied_last_24h: repliesToday, awaiting_our_reply_last_7d: awaitingReply },
    prospecting_stages: stages.stages.map((s) => ({ name: s.name, lead_count: s.lead_count })),
    opportunity_pipelines: pipelines,
    your_tasks: {
      open: open.length,
      overdue: open.filter((t) => dueMs(t) < now).length,
      due_today: open.filter((t) => dueMs(t) >= now && dueMs(t) <= endOfToday.getTime()).length,
    },
    tags: tags.map((t) => ({ name: t.name, lead_count: tagCounts[t.key] || 0 })).sort((a, b) => b.lead_count - a.lead_count),
    folders: (await dbService.listFolders(ctx.workspaceId)).length,
    members: Object.keys(ws.members || {}).length,
  };
}

/* ---------- schemas ---------- */

const LEAD_IDS = (max) => z.array(z.string().min(1)).min(1).max(max).describe(`Lead ids (up to ${max}).`);

const WORKSPACE_TOOLS = [
  {
    name: 'get_workspace_overview',
    description:
      'One-call snapshot of the whole workspace to plan work: lead totals by status, new this week, assigned to you, replies (last 24h, awaiting our reply), prospecting stage counts, every opportunity pipeline with per-stage card counts and deal value, your open/overdue/due-today tasks, tags with lead counts, folders and members.',
    schema: z.object({}),
    run: getWorkspaceOverview,
  },
  {
    name: 'list_opportunities',
    description:
      'List every opportunity (deal card) on an opportunity pipeline, paginated, with stage, deal value, status, source, contact info and last note. Filter by stage. Defaults to the active pipeline. Use get_opportunity_board for a quick capped view.',
    schema: z.object({
      pipeline: z.string().optional().describe('Pipeline name or id; default the active pipeline.'),
      stage: z.string().optional().describe('Only this stage (name or id).'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 50.'),
      offset: z.number().int().min(0).optional(),
    }),
    run: listOpportunities,
  },
  {
    name: 'manage_opportunity_pipeline',
    description:
      'Edit opportunity pipelines and their stages: rename_pipeline, set_active_pipeline, delete_pipeline (cards come off it; leads are kept), add_stage, rename_stage, delete_stage (its cards move to the pipeline\'s first remaining stage). Deletes are owners/admins only. Create pipelines with create_opportunity_pipeline.',
    schema: z.object({
      action: z.enum(['rename_pipeline', 'set_active_pipeline', 'delete_pipeline', 'add_stage', 'rename_stage', 'delete_stage']),
      pipeline: z.string().optional().describe('Pipeline name or id; default the active pipeline (required for delete_pipeline).'),
      stage: z.string().optional().describe('Stage name or id, for rename_stage / delete_stage.'),
      name: z.string().max(60).optional().describe('New name, for rename_* and add_stage.'),
    }),
    run: manageOpportunityPipeline,
  },
  {
    name: 'create_opportunity',
    description:
      'Add a new deal card to an opportunity pipeline (creates the lead, e.g. a referral or word-of-mouth job) with an optional deal value. For an existing lead use move_opportunity; to change a deal value use update_lead with fields.opportunityValue.',
    schema: z.object({
      title: z.string().min(1).max(120).describe('Business or contact name.'),
      pipeline: z.string().optional(),
      stage: z.string().optional().describe('Default the pipeline\'s first stage.'),
      value: z.number().min(0).optional().describe('Deal value in USD.'),
      source: z.string().max(40).optional().describe('e.g. "Referral", "Walk-in".'),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      category: z.string().optional(),
    }),
    run: createOpportunity,
  },
  {
    name: 'remove_opportunities',
    description: 'Take leads off the opportunity board (they stay in the CRM and won\'t reappear on the board automatically).',
    schema: z.object({ lead_ids: LEAD_IDS(MAX_BULK) }),
    run: removeOpportunities,
  },
  {
    name: 'list_lead_stages',
    description:
      'List the prospecting pipeline stages (the Pipeline page columns, separate from opportunity pipelines) with lead counts, won/lost flags, and a count of leads per status.',
    schema: z.object({}),
    run: listLeadStages,
  },
  {
    name: 'set_lead_stage',
    description: 'Move leads to a prospecting pipeline stage by name or id (same as dragging on the Pipeline page). Optionally set status too.',
    schema: z.object({
      lead_ids: LEAD_IDS(MAX_BULK),
      stage: z.string().min(1).describe('Stage name or id from list_lead_stages.'),
      status: z.string().max(40).optional().describe('Optional lead status, e.g. "Interested".'),
    }),
    run: setLeadStage,
  },
  {
    name: 'manage_tags',
    description:
      'Create, rename, recolor, archive, restore or delete workspace tags. Deleting removes the tag from every lead. Use tag_leads to add or remove tags on leads, list_tags to see them.',
    schema: z.object({
      action: z.enum(['create', 'rename', 'recolor', 'archive', 'restore', 'delete']),
      tag: z.string().optional().describe('Existing tag name or key (not needed for create).'),
      name: z.string().max(40).optional().describe('Tag name for create, new name for rename.'),
      color: z.string().max(20).optional().describe('Hex color, e.g. "#22c55e".'),
    }),
    run: manageTags,
  },
  {
    name: 'manage_folder',
    description:
      'Delete a lead folder (its leads become unfiled, not deleted; subfolders move up) or move/nest it under another folder (omit parent_folder for top level). Create/rename folders with create_folder / rename_folder.',
    schema: z.object({
      action: z.enum(['delete', 'move']),
      folder: z.string().min(1).describe('Folder name or id.'),
      parent_folder: z.string().optional().describe('For move: new parent folder name or id.'),
    }),
    run: manageFolder,
  },
  {
    name: 'move_leads_to_folder',
    description: 'File leads into a folder, or take them out of any folder with folder: "none".',
    schema: z.object({
      lead_ids: LEAD_IDS(MAX_BULK),
      folder: z.string().min(1).describe('Folder name or id, or "none".'),
    }),
    run: moveLeadsToFolder,
  },
  {
    name: 'create_lead',
    description:
      'Create a lead by hand (deduplicated by phone/email/website). Optionally file it in a folder, tag it (missing tags are created) and add a first note.',
    schema: z.object({
      title: z.string().min(1).max(160).describe('Business name.'),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      category: z.string().optional().describe('Business category, e.g. "Roofing contractor".'),
      folder: z.string().optional().describe('Folder name or id.'),
      tags: z.array(z.string()).max(10).optional().describe('Tag names.'),
      note: z.string().max(2000).optional(),
    }),
    run: createLead,
  },
  {
    name: 'delete_leads',
    description:
      'Permanently delete leads. Always confirm with the user first (list the leads), then call with confirm: true. Prefer moving leads to a folder or setting a lost status when unsure.',
    schema: z.object({
      lead_ids: LEAD_IDS(MAX_DELETE),
      confirm: z.boolean().describe('Must be true, after the user confirmed.'),
    }),
    run: deleteLeads,
  },
  {
    name: 'add_lead_note',
    description: 'Add a note to a lead\'s timeline (kept with earlier notes, synced to GHL). Use this instead of overwriting update_lead fields.notes.',
    schema: z.object({
      lead_id: z.string().min(1),
      note: z.string().min(1).max(4000),
    }),
    run: addLeadNote,
  },
  {
    name: 'assign_leads',
    description:
      'Assign leads to a teammate (name or email, or "me"), round-robin across the team pool ("round_robin"), or clear the owner ("none"). Owners/admins only. See list_team_members.',
    schema: z.object({
      lead_ids: LEAD_IDS(MAX_BULK),
      assignee: z.string().min(1),
    }),
    run: assignLeads,
  },
  {
    name: 'get_lead_history',
    description:
      'A lead\'s timeline, newest first: notes, texts and emails in both directions, calls, status changes, assignments and other events. Filter by type substrings like ["sms", "note", "call"].',
    schema: z.object({
      lead_id: z.string().min(1),
      types: z.array(z.string()).max(10).optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
    }),
    run: getLeadHistory,
  },
  {
    name: 'list_recent_replies',
    description:
      'Leads that texted, emailed or called in recently, newest first, with the message and whether we still owe them a reply. Use to triage the inbox and follow up.',
    schema: z.object({
      since_hours: z.number().int().min(1).max(720).optional().describe('Default 72.'),
      channel: z.enum(['any', 'sms', 'email', 'call']).optional(),
      unanswered_only: z.boolean().optional().describe('Only leads with no outbound message after their reply.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
    }),
    run: listRecentReplies,
  },
  {
    name: 'list_team_activity',
    description:
      'The Team history feed: what teammates and AI assistants did (calls, notes, tags, moves, sends), newest first. Filter by person ("me", a name/email, or an assistant like "Muse") and category.',
    schema: z.object({
      person: z.string().optional(),
      category: z.enum(teamActivity.CATEGORIES.map((c) => c.key)).optional(),
      since_hours: z.number().int().min(1).max(720).optional().describe('Default 24.'),
      limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
    }),
    run: listTeamActivity,
  },
];

const BY_NAME = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t.name, t]));
const WORKSPACE_TOOL_NAMES = WORKSPACE_TOOLS.map((t) => t.name);

async function executeWorkspaceTool(ctx, name, input) {
  const tool = BY_NAME[name];
  if (!tool) throw toolError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  const parsed = tool.schema.safeParse(input || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw toolError(`${issue.path.join('.') || 'input'}: ${issue.message}`, 'INVALID_ARGUMENTS');
  }
  return tool.run(ctx, parsed.data);
}

function openAiFunctionTools() {
  return WORKSPACE_TOOLS.map((tool) => {
    const { $schema, ...parameters } = zodToJsonSchema(tool.schema, { target: 'openApi3' });
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
  });
}

module.exports = {
  WORKSPACE_TOOLS,
  WORKSPACE_TOOL_NAMES,
  READ_ONLY_WORKSPACE_TOOLS: [
    'get_workspace_overview',
    'list_opportunities',
    'list_lead_stages',
    'get_lead_history',
    'list_recent_replies',
    'list_team_activity',
  ],
  DESTRUCTIVE_WORKSPACE_TOOLS: ['manage_opportunity_pipeline', 'manage_tags', 'manage_folder', 'delete_leads'],
  OPEN_WORLD_WORKSPACE_TOOLS: ['add_lead_note'],
  executeWorkspaceTool,
  openAiFunctionTools,
};
