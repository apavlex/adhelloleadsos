const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { filterLeadsForRequest, userEmail } = require('../services/workspaceService');
const { filterBusinessPipelineLeads } = require('../services/leadListFilters');
const {
  normalizeBoards,
  selectPipeline,
  buildOpportunityBoard,
  addPipeline,
  addStage,
  renameStage,
  renamePipeline,
  removeStage,
  stageBelongsToPipeline,
} = require('../services/opportunityBoards');

async function loadContext(req, pipelineId) {
  const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  const selected = selectPipeline(
    workspace.opportunityBoards,
    pipelineId || (req.query && req.query.pipeline),
  );
  if (selected.changed) {
    workspace.opportunityBoards = selected.boards;
    await dbService.saveWorkspace(req.workspaceId, workspace);
  }
  const all = await dbService.getAllLeads(req.workspaceId);
  const leads = filterBusinessPipelineLeads(filterLeadsForRequest(req, all));
  const email = userEmail(req);
  const tasks = email ? await dbService.listUserTasks(req.workspaceId, email) : [];
  const board = buildOpportunityBoard({
    boards: workspace.opportunityBoards,
    leads,
    tasks,
    pipelineId: pipelineId || (req.query && req.query.pipeline),
  });
  return { workspace, board, leads };
}

async function saveBoards(req, boards) {
  const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
  workspace.opportunityBoards = normalizeBoards(boards).boards;
  await dbService.saveWorkspace(req.workspaceId, workspace);
  return workspace.opportunityBoards;
}

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

router.get('/', async (req, res, next) => {
  try {
    const { board } = await loadContext(req);
    res.render('opportunities', {
      title: 'Opportunities | Agency OS',
      activePage: 'opportunities',
      opportunityBoard: board,
      opportunityCompact: false,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/pipelines', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = addPipeline(workspace.opportunityBoards, req.body && req.body.name);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true, pipelineId: result.pipelineId });
  } catch (e) {
    next(e);
  }
});

router.post('/pipelines/:pipelineId', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = renamePipeline(workspace.opportunityBoards, req.params.pipelineId, req.body && req.body.name);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/pipelines/:pipelineId/stages', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = addStage(workspace.opportunityBoards, req.params.pipelineId, req.body && req.body.name);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true, stageId: result.stageId });
  } catch (e) {
    next(e);
  }
});

router.post('/stages/:stageId', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = renameStage(workspace.opportunityBoards, req.params.stageId, req.body && req.body.name);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/stages/:stageId/delete', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    const { workspace, leads } = await loadContext(req);
    const result = removeStage(workspace.opportunityBoards, req.params.stageId);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    const moved = [];
    for (const lead of leads) {
      if (String(lead.opportunityStageId || '') !== String(req.params.stageId)) continue;
      await dbService.updateLead(
        lead.key,
        { opportunityPipelineId: result.pipelineId, opportunityStageId: result.fallbackStageId },
        req.workspaceId,
      );
      moved.push(lead.key);
    }
    res.json({ success: true, moved: moved.length });
  } catch (e) {
    next(e);
  }
});

router.post('/bulk-move', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const pipelineId = String((req.body && req.body.pipelineId) || '').trim();
    const stageId = String((req.body && req.body.stageId) || '').trim();
    const folderKey =
      req.body && req.body.folderKey != null && String(req.body.folderKey).trim()
        ? String(req.body.folderKey).trim()
        : '';
    const leadKeys = (Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [])
      .map((key) => String(key || '').trim())
      .filter(Boolean);
    if (!leadKeys.length) return jsonError(res, 400, 'Select at least one lead.');
    const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    if (!stageBelongsToPipeline(workspace.opportunityBoards, pipelineId, stageId)) {
      return jsonError(res, 400, 'That stage is not on this board.');
    }
    const all = await dbService.getAllLeads(req.workspaceId);
    const visibleKeys = new Set(filterLeadsForRequest(req, all).map((lead) => lead.key));
    const resolveKey = (rawKey) => {
      const key = String(rawKey || '').trim();
      const candidates = [key, key.startsWith('lead:') ? key.slice(5) : `lead:${key}`].filter(Boolean);
      return candidates.find((candidate) => visibleKeys.has(candidate)) || '';
    };
    const updatedKeys = [];
    for (const rawKey of leadKeys) {
      const fullKey = resolveKey(rawKey);
      if (!fullKey) continue;
      const patch = {
        opportunityPipelineId: pipelineId,
        opportunityStageId: stageId,
        onPipelineBoard: true,
      };
      if (folderKey) patch.folderKey = folderKey;
      const lead = await dbService.updateLead(fullKey, patch, req.workspaceId);
      if (lead) updatedKeys.push(lead.key);
    }
    if (!updatedKeys.length) return jsonError(res, 404, 'No leads were updated.');
    res.json({ success: true, updatedKeys, pipelineId, stageId });
  } catch (e) {
    next(e);
  }
});

router.post('/move', express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const leadKey = String((req.body && req.body.leadKey) || '').trim();
    const pipelineId = String((req.body && req.body.pipelineId) || '').trim();
    const stageId = String((req.body && req.body.stageId) || '').trim();
    if (!leadKey || !pipelineId || !stageId) {
      return jsonError(res, 400, 'Choose an opportunity and a stage.');
    }
    const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    if (!stageBelongsToPipeline(workspace.opportunityBoards, pipelineId, stageId)) {
      return jsonError(res, 400, 'That stage is not on this pipeline.');
    }
    const updated = await dbService.updateLead(
      leadKey,
      { opportunityPipelineId: pipelineId, opportunityStageId: stageId },
      req.workspaceId,
    );
    if (!updated) return jsonError(res, 404, 'Lead not found.');
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/cards', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
    const source = String((req.body && req.body.source) || '').trim().slice(0, 40);
    const pipelineId = String((req.body && req.body.pipelineId) || '').trim();
    const stageId = String((req.body && req.body.stageId) || '').trim();
    const value = Number(req.body && req.body.value);
    if (!title) return jsonError(res, 400, 'Name is required.');
    const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const boards = normalizeBoards(workspace.opportunityBoards).boards;
    const pipeline = boards.pipelines.find((item) => item.id === pipelineId) || boards.pipelines[0];
    const stage = pipeline.stages.find((item) => item.id === stageId) || pipeline.stages[0];
    const key = await dbService.saveLead({
      title,
      phone: 'N/A',
      website: 'N/A',
      email: 'N/A',
      categoryName: 'Offline / word of mouth',
      address: 'N/A',
      city: '',
      state: '',
      status: 'Not Contacted',
      source: 'manual_offline',
      tags: /referral/i.test(source) ? ['referral'] : [],
      opportunityPipelineId: pipeline.id,
      opportunityStageId: stage.id,
      opportunitySource: source,
      opportunityValue: Number.isFinite(value) && value > 0 ? value : 0,
      workspaceId: req.workspaceId,
      savedAt: new Date().toISOString(),
    });
    res.json({ success: true, key, pipelineId: pipeline.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
