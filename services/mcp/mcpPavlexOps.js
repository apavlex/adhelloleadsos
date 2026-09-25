/**
 * Extended Pavlex MCP ops — opportunities, enrichment, tasks, follow-ups, daily suggestions.
 */
const dbService = require('../database');
const { filterLeadsForRequest } = require('../workspaceService');
const { filterBusinessPipelineLeads } = require('../leadListFilters');
const {
  normalizeBoards,
  buildOpportunityBoard,
  addPipeline,
  listPipelineTemplates,
  resolvePlacement,
  selectPipeline,
} = require('../opportunityBoards');
const { ensureLeadEmail, hasUsableEmail } = require('../ensureLeadEmail');
const {
  upsertOpenTaskForLead,
  filterManualUserTasks,
  TASK_SOURCE_MANUAL,
} = require('../userTasks');
const { getLead } = require('./mcpCrmService');

const TASK_COLUMNS = new Set(['backlog', 'todo', 'doing', 'done']);

function buildReqLike(workspaceId, userEmail) {
  return {
    workspaceId,
    workspace: { id: workspaceId },
    user: userEmail ? { emails: [{ value: userEmail }] } : undefined,
  };
}

function requireEmail(ctx) {
  const email = String((ctx && ctx.userEmail) || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('A signed-in user email is required for tasks.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return email;
}

function normColumn(raw) {
  const s = String(raw || '').toLowerCase().trim();
  return TASK_COLUMNS.has(s) ? s : 'todo';
}

function normScheduledAt(v) {
  if (v == null || v === '') return null;
  const ts = Date.parse(String(v));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function leadKeyNorm(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!s.startsWith('lead:')) s = `lead:${s.replace(/^lead:/i, '')}`;
  return s.slice(0, 200);
}

async function loadVisibleLeads(ctx) {
  const { workspaceId, userEmail } = ctx;
  const all = await dbService.getAllLeads(workspaceId);
  return filterLeadsForRequest(buildReqLike(workspaceId, userEmail), all);
}

async function loadWorkspaceBoards(workspaceId) {
  const workspace = (await dbService.getWorkspace(workspaceId)) || { id: workspaceId };
  return {
    workspace,
    boards: normalizeBoards(workspace.opportunityBoards).boards,
  };
}

async function listOpportunityPipelines(ctx) {
  const { boards } = await loadWorkspaceBoards(ctx.workspaceId);
  return {
    activePipelineId: boards.activePipelineId,
    templates: listPipelineTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      stages: t.stages,
    })),
    pipelines: boards.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stageCount: p.stages.length,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
    })),
  };
}

async function getOpportunityBoard(ctx, input = {}) {
  const { workspaceId, userEmail } = ctx;
  const { boards } = await loadWorkspaceBoards(workspaceId);
  const leads = filterBusinessPipelineLeads(await loadVisibleLeads(ctx));
  const email = String(userEmail || '').trim();
  const tasks = email ? await dbService.listUserTasks(workspaceId, email) : [];
  const board = buildOpportunityBoard({
    boards,
    leads,
    tasks,
    pipelineId: input.pipeline_id || input.pipelineId || boards.activePipelineId,
    compactLimit: Number(input.limit) > 0 ? Math.min(Number(input.limit), 20) : 8,
  });
  return {
    pipeline: board.pipeline,
    stages: board.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      count: stage.count,
      valueLabel: stage.valueLabel || '',
      leads: (stage.cards || []).map((card) => ({
        lead_id: card.key,
        title: card.title,
        status: card.status || '',
        category: card.category || '',
        phone: card.phone || '',
        email: card.email || '',
        city: card.city || '',
      })),
    })),
  };
}

async function createOpportunityPipeline(ctx, input = {}) {
  const { workspace, boards } = await loadWorkspaceBoards(ctx.workspaceId);
  const result = addPipeline(boards, input.name, input.template_id || input.templateId);
  if (!result.ok) {
    const err = new Error(result.error || 'Could not create pipeline.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  workspace.opportunityBoards = result.boards;
  await dbService.saveWorkspace(ctx.workspaceId, workspace);
  const created = result.boards.pipelines.find((p) => p.id === result.pipelineId);
  return {
    pipelineId: result.pipelineId,
    templateId: result.templateId,
    pipeline: created
      ? {
          id: created.id,
          name: created.name,
          stages: created.stages.map((s) => ({ id: s.id, name: s.name })),
        }
      : null,
  };
}

async function moveOpportunity(ctx, input = {}) {
  const leadId = leadKeyNorm(input.lead_id || input.leadKey);
  if (!leadId) {
    const err = new Error('lead_id is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const { workspace, boards } = await loadWorkspaceBoards(ctx.workspaceId);
  const pipelineId =
    String(input.pipeline_id || input.pipelineId || '').trim() || boards.activePipelineId;
  const placement = resolvePlacement(
    boards,
    pipelineId,
    input.stage_id || input.stageId,
    input.stage_name || input.stageName,
  );
  if (!placement.ok) {
    const err = new Error(placement.error || 'Could not place opportunity.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const updated = await dbService.updateLead(
    leadId,
    {
      opportunityPipelineId: placement.pipelineId,
      opportunityStageId: placement.stageId,
      opportunityDismissed: false,
    },
    ctx.workspaceId,
  );
  if (!updated) {
    const err = new Error('Lead not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const remembered = selectPipeline(boards, placement.pipelineId);
  if (remembered.changed) {
    workspace.opportunityBoards = remembered.boards;
    await dbService.saveWorkspace(ctx.workspaceId, workspace);
  }
  return {
    lead_id: leadId,
    pipelineId: placement.pipelineId,
    stageId: placement.stageId,
    pipelineName: placement.pipelineName,
    stageName: placement.stageName,
  };
}

async function enrichLead(ctx, input = {}) {
  const leadId = leadKeyNorm(input.lead_id || input.leadKey);
  if (!leadId) {
    const err = new Error('lead_id is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const existing = await getLead(ctx, { lead_id: leadId });
  const lead = existing.lead || {};
  if (hasUsableEmail(lead) && input.force !== true && input.force !== 'true') {
    return {
      found: true,
      alreadyHad: true,
      lead_id: leadId,
      email: String(lead.email || '').trim(),
      phone: String(lead.phone || '').trim(),
      message: 'Lead already has a usable email. Pass force=true to hunt again.',
    };
  }
  const pack = await ensureLeadEmail({
    lead,
    workspaceId: ctx.workspaceId,
    persist: true,
    totalBudgetMs: 45000,
  });
  return {
    found: !!pack.found,
    alreadyHad: !!pack.alreadyHad,
    timedOut: !!pack.timedOut,
    lead_id: leadId,
    email: pack.email || '',
    sources: pack.sources || [],
    lead: pack.lead
      ? {
          title: pack.lead.title || pack.lead.company || '',
          email: pack.lead.email || '',
          phone: pack.lead.phone || '',
          website: pack.lead.website || '',
        }
      : null,
  };
}

function mapTask(task, leadTitle) {
  return {
    id: task.id,
    title: task.title,
    column: task.column,
    scheduledAt: task.scheduledAt || null,
    remindMinutesBefore: task.remindMinutesBefore || null,
    lead_id: task.leadKey || null,
    leadTitle: leadTitle || null,
    source: task.source || 'manual',
    updatedAt: task.updatedAt || null,
  };
}

async function listTasks(ctx, input = {}) {
  const email = requireEmail(ctx);
  const raw = await dbService.listUserTasks(ctx.workspaceId, email);
  let tasks = filterManualUserTasks(raw);
  const column = String(input.column || '').trim().toLowerCase();
  if (column && TASK_COLUMNS.has(column)) {
    tasks = tasks.filter((t) => String(t.column || '') === column);
  }
  const leadId = leadKeyNorm(input.lead_id || input.leadKey);
  if (leadId) tasks = tasks.filter((t) => String(t.leadKey || '') === leadId);
  const limit = Math.min(Math.max(parseInt(input.limit, 10) || 25, 1), 100);
  const leads = await loadVisibleLeads(ctx);
  const leadMap = Object.fromEntries(leads.map((l) => [l.key, l]));
  return {
    tasks: tasks.slice(0, limit).map((t) => {
      const L = t.leadKey && leadMap[t.leadKey];
      return mapTask(t, L ? String(L.title || L.company || L.email || '').slice(0, 120) : null);
    }),
  };
}

async function createTask(ctx, input = {}) {
  const email = requireEmail(ctx);
  const title = String(input.title || '').trim();
  if (!title) {
    const err = new Error('title is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  let leadKey = leadKeyNorm(input.lead_id || input.leadKey);
  if (leadKey) {
    const leads = await loadVisibleLeads(ctx);
    if (!leads.some((l) => l.key === leadKey)) {
      const err = new Error('Lead not found in this workspace.');
      err.code = 'NOT_FOUND';
      throw err;
    }
  } else {
    leadKey = null;
  }
  const saved = await upsertOpenTaskForLead(ctx.workspaceId, email, {
    title,
    column: normColumn(input.column),
    scheduledAt: normScheduledAt(input.scheduled_at || input.scheduledAt),
    remindMinutesBefore: input.remind_minutes_before ?? input.remindMinutesBefore ?? null,
    leadKey,
    source: TASK_SOURCE_MANUAL,
  });
  return { task: mapTask(saved) };
}

async function updateTask(ctx, input = {}) {
  const email = requireEmail(ctx);
  const taskId = String(input.task_id || input.taskId || '').trim();
  if (!taskId) {
    const err = new Error('task_id is required.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const tasks = await dbService.listUserTasks(ctx.workspaceId, email);
  const existing = tasks.find((t) => t && t.id === taskId);
  if (!existing) {
    const err = new Error('Task not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const next = {
    ...existing,
    title: input.title != null ? String(input.title).trim() || existing.title : existing.title,
    column: input.column != null ? normColumn(input.column) : existing.column,
    scheduledAt:
      input.scheduled_at !== undefined || input.scheduledAt !== undefined
        ? normScheduledAt(input.scheduled_at ?? input.scheduledAt)
        : existing.scheduledAt,
    remindMinutesBefore:
      input.remind_minutes_before !== undefined || input.remindMinutesBefore !== undefined
        ? input.remind_minutes_before ?? input.remindMinutesBefore
        : existing.remindMinutesBefore,
  };
  if (input.lead_id !== undefined || input.leadKey !== undefined) {
    const lk = leadKeyNorm(input.lead_id ?? input.leadKey);
    next.leadKey = lk || null;
  }
  const saved = await dbService.saveUserTask(ctx.workspaceId, email, next);
  return { task: mapTask(saved) };
}

async function listFollowups(ctx, input = {}) {
  const email = requireEmail(ctx);
  const raw = await dbService.listUserTasks(ctx.workspaceId, email);
  const now = Date.now();
  const withinHours = Math.min(Math.max(parseInt(input.within_hours, 10) || 48, 1), 24 * 14);
  const horizon = now + withinHours * 60 * 60 * 1000;
  const includeDone = input.include_done === true || input.include_done === 'true';
  let tasks = raw.filter((t) => t && t.scheduledAt);
  if (!includeDone) tasks = tasks.filter((t) => String(t.column || '') !== 'done');
  const followups = tasks
    .map((t) => {
      const due = Date.parse(t.scheduledAt);
      return {
        task: t,
        dueMs: Number.isFinite(due) ? due : null,
      };
    })
    .filter((row) => row.dueMs != null && row.dueMs <= horizon)
    .sort((a, b) => a.dueMs - b.dueMs);

  const leads = await loadVisibleLeads(ctx);
  const leadMap = Object.fromEntries(leads.map((l) => [l.key, l]));
  return {
    withinHours,
    followups: followups.slice(0, 40).map((row) => {
      const L = row.task.leadKey && leadMap[row.task.leadKey];
      const overdue = row.dueMs < now;
      return {
        ...mapTask(row.task, L ? String(L.title || L.company || L.email || '').slice(0, 120) : null),
        overdue,
        dueInHours: Math.round((row.dueMs - now) / 3600000),
      };
    }),
  };
}

async function suggestDailyLeads(ctx, input = {}) {
  const { workspaceId } = ctx;
  const { boards } = await loadWorkspaceBoards(workspaceId);
  const pipelineId = String(input.pipeline_id || input.pipelineId || boards.activePipelineId || '').trim();
  const email = String((ctx && ctx.userEmail) || '').trim();
  const tasks = email ? await dbService.listUserTasks(workspaceId, email) : [];
  const leads = filterBusinessPipelineLeads(await loadVisibleLeads(ctx));
  const board = buildOpportunityBoard({
    boards,
    leads,
    tasks,
    pipelineId,
    compactLimit: 0,
  });
  const limit = Math.min(Math.max(parseInt(input.limit, 10) || 8, 1), 20);
  const priorityStageNames = /new|contact|qualif|prospect|outreach|to contact/i;
  const orderedStages = [...board.stages].sort((a, b) => {
    const aPri = priorityStageNames.test(a.name) ? 0 : 1;
    const bPri = priorityStageNames.test(b.name) ? 0 : 1;
    if (aPri !== bPri) return aPri - bPri;
    return 0;
  });
  const suggestions = [];
  for (const stage of orderedStages) {
    for (const card of stage.cards || []) {
      if (suggestions.length >= limit) break;
      suggestions.push({
        lead_id: card.key,
        title: card.title,
        stage: stage.name,
        status: card.status || '',
        category: card.category || '',
        phone: card.phone || '',
        email: card.email || '',
        why: `On ${board.pipeline.name} · ${stage.name}`,
      });
    }
    if (suggestions.length >= limit) break;
  }
  return {
    pipeline: board.pipeline,
    suggestions,
    message:
      suggestions.length > 0
        ? `Top ${suggestions.length} leads to work from ${board.pipeline.name}.`
        : 'No opportunity leads found on this pipeline yet.',
  };
}

module.exports = {
  listOpportunityPipelines,
  getOpportunityBoard,
  createOpportunityPipeline,
  moveOpportunity,
  enrichLead,
  listTasks,
  createTask,
  updateTask,
  listFollowups,
  suggestDailyLeads,
};
