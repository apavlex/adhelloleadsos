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
  reorderStages,
  renamePipeline,
  removePipeline,
  removeStage,
  resolvePlacement,
  listPipelineTemplates,
} = require('../services/opportunityBoards');
const teamActivity = require('../services/teamActivity');
const ghlClient = require('../services/ghlClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlOpportunitySync = require('../services/ghlOpportunitySync');

const SYNC_WAIT_MS = 20000;

async function ghlSyncView(req, workspace) {
  let configured = false;
  try {
    const env = await workspaceIntegrations.getResolvedIntegrationEnv(req.workspaceId);
    configured = !env.DEMO_WORKSPACE && ghlClient.isConfigured(env);
  } catch (_) {
    configured = false;
  }
  return { configured, ...ghlOpportunitySync.statusFor({ ...(workspace || {}), id: req.workspaceId }) };
}

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
    const [{ board, workspace }, tags] = await Promise.all([loadContext(req), dbService.listTags(req.workspaceId)]);
    res.render('opportunities', {
      title: 'Opportunities | Agency OS',
      activePage: 'opportunities',
      opportunityBoard: board,
      opportunityCompact: false,
      opportunityTags: tags || [],
      ghlOpportunitySync: await ghlSyncView(req, workspace),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/ghl-sync', async (req, res, next) => {
  try {
    const workspace = await dbService.getWorkspace(req.workspaceId);
    res.json({ success: true, ...(await ghlSyncView(req, workspace)) });
  } catch (e) {
    next(e);
  }
});

router.post('/ghl-sync', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    const run = ghlOpportunitySync.syncWorkspace(req.workspaceId, { trigger: 'button' });
    const finished = await Promise.race([
      run,
      new Promise((resolve) => setTimeout(() => resolve(null), SYNC_WAIT_MS)),
    ]);
    if (finished) {
      teamActivity.record(req, {
        category: 'pipeline',
        action: 'opportunity_ghl_sync',
        summary: finished.ok
          ? `Synced opportunities with GHL (${finished.pulled + finished.created} from GHL, ${finished.pushed} to GHL)`
          : 'GHL opportunity sync failed',
      });
    }
    const workspace = await dbService.getWorkspace(req.workspaceId);
    res.json({ success: true, ...(await ghlSyncView(req, workspace)), running: !finished });
  } catch (e) {
    next(e);
  }
});

router.get('/templates', (_req, res) => {
  res.json({ success: true, templates: listPipelineTemplates() });
});

router.post('/pipelines', express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = addPipeline(
      workspace.opportunityBoards,
      req.body && req.body.name,
      req.body && req.body.templateId,
    );
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true, pipelineId: result.pipelineId, templateId: result.templateId });
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

router.post('/pipelines/:pipelineId/delete', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    const { workspace, leads } = await loadContext(req);
    const result = removePipeline(workspace.opportunityBoards, req.params.pipelineId);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    const stageSet = new Set((result.stageIds || []).map(String));
    let cleared = 0;
    for (const lead of leads) {
      const onPipeline = String(lead.opportunityPipelineId || '') === String(result.removedPipelineId);
      const onStage = stageSet.has(String(lead.opportunityStageId || ''));
      if (!onPipeline && !onStage) continue;
      await dbService.updateLead(
        lead.key,
        {
          opportunityPipelineId: '',
          opportunityStageId: '',
        },
        req.workspaceId,
      );
      cleared += 1;
    }
    res.json({
      success: true,
      activePipelineId: result.activePipelineId,
      cleared,
      removedName: result.removedName || '',
    });
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

router.post('/pipelines/:pipelineId/stage-order', express.json({ limit: '8kb' }), async (req, res, next) => {
  try {
    const { workspace } = await loadContext(req);
    const result = reorderStages(workspace.opportunityBoards, req.params.pipelineId, req.body && req.body.stageIds);
    if (!result.ok) return jsonError(res, 400, result.error);
    await saveBoards(req, result.boards);
    res.json({ success: true });
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
    const stageName = String((req.body && req.body.stageName) || '').trim();
    const folderKey =
      req.body && req.body.folderKey != null && String(req.body.folderKey).trim()
        ? String(req.body.folderKey).trim()
        : '';
    const leadKeys = (Array.isArray(req.body && req.body.leadKeys) ? req.body.leadKeys : [])
      .map((key) => String(key || '').trim())
      .filter(Boolean);
    if (!leadKeys.length) return jsonError(res, 400, 'Select at least one lead.');
    const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const placement = resolvePlacement(workspace.opportunityBoards, pipelineId, stageId, stageName);
    if (!placement.ok) return jsonError(res, 400, placement.error);
    const all = await dbService.getAllLeads(req.workspaceId);
    const visibleKeys = new Set(filterLeadsForRequest(req, all).map((lead) => lead.key));
    const resolveKey = (rawKey) => {
      const key = String(rawKey || '').trim();
      const candidates = [key, key.startsWith('lead:') ? key.slice(5) : `lead:${key}`].filter(Boolean);
      return candidates.find((candidate) => visibleKeys.has(candidate)) || '';
    };
    const updatedKeys = [];
    for (const rawKey of leadKeys) {
      let fullKey = resolveKey(rawKey);
      if (!fullKey) {
        try {
          const resolved = await dbService.resolveLeadStorageKey(rawKey, req.workspaceId);
          if (resolved) {
            const lead = await dbService.getLead(resolved, req.workspaceId);
            if (lead && (lead.workspaceId || 'default') === req.workspaceId) {
              fullKey = resolved;
            }
          }
        } catch (_) {
          /* ignore resolve errors */
        }
      }
      if (!fullKey) continue;
      const patch = {
        opportunityPipelineId: placement.pipelineId,
        opportunityStageId: placement.stageId,
        opportunityDismissed: false,
        opportunityChangedAt: new Date().toISOString(),
        onPipelineBoard: true,
      };
      if (folderKey) patch.folderKey = folderKey;
      const lead = await dbService.updateLead(fullKey, patch, req.workspaceId);
      if (lead) updatedKeys.push(lead.key);
    }
    if (!updatedKeys.length) return jsonError(res, 404, 'No leads were updated.');
    const remembered = selectPipeline(workspace.opportunityBoards, placement.pipelineId);
    if (remembered.changed) {
      workspace.opportunityBoards = remembered.boards;
      await dbService.saveWorkspace(req.workspaceId, workspace);
    }
    teamActivity.record(req, {
      category: 'pipeline',
      action: 'opportunity_bulk_move',
      summary: `Moved ${updatedKeys.length} opportunit${updatedKeys.length === 1 ? 'y' : 'ies'} to ${placement.pipelineName} → ${placement.stageName}`,
      leadKeys: updatedKeys,
    });
    ghlOpportunitySync.pushLeadsNow(req.workspaceId, updatedKeys);
    res.json({
      success: true,
      updatedKeys,
      pipelineId: placement.pipelineId,
      stageId: placement.stageId,
      pipelineName: placement.pipelineName,
      stageName: placement.stageName,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/move', express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const leadKey = String((req.body && req.body.leadKey) || '').trim();
    const pipelineId = String((req.body && req.body.pipelineId) || '').trim();
    const stageId = String((req.body && req.body.stageId) || '').trim();
    const stageName = String((req.body && req.body.stageName) || '').trim();
    if (!leadKey || !pipelineId || !stageId) {
      return jsonError(res, 400, 'Choose an opportunity and a stage.');
    }
    const workspace = (await dbService.getWorkspace(req.workspaceId)) || { id: req.workspaceId };
    const placement = resolvePlacement(workspace.opportunityBoards, pipelineId, stageId, stageName);
    if (!placement.ok) return jsonError(res, 400, placement.error);
    const updated = await dbService.updateLead(
      leadKey,
      {
        opportunityPipelineId: placement.pipelineId,
        opportunityStageId: placement.stageId,
        opportunityDismissed: false,
        opportunityChangedAt: new Date().toISOString(),
      },
      req.workspaceId,
    );
    if (!updated) return jsonError(res, 404, 'Lead not found.');
    ghlOpportunitySync.pushLeadsNow(req.workspaceId, [updated.key || leadKey]);
    teamActivity.record(req, {
      category: 'pipeline',
      action: 'opportunity_move',
      summary: `Opportunity → ${placement.pipelineName} → ${placement.stageName}`,
      leadKey: updated.key || leadKey,
      leadTitle: updated.title || '',
    });

    // Reply as soon as the lead is placed; remember last pipeline off the critical path.
    res.json({
      success: true,
      pipelineId: placement.pipelineId,
      stageId: placement.stageId,
      pipelineName: placement.pipelineName,
      stageName: placement.stageName,
    });

    try {
      const remembered = selectPipeline(workspace.opportunityBoards, placement.pipelineId);
      if (remembered.changed) {
        workspace.opportunityBoards = remembered.boards;
        await dbService.saveWorkspace(req.workspaceId, workspace);
      }
    } catch (rememberErr) {
      console.warn('[opportunities/move] remember pipeline', rememberErr && rememberErr.message);
    }
  } catch (e) {
    next(e);
  }
});

router.post('/remove', express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const leadKey = String((req.body && req.body.leadKey) || '').trim();
    if (!leadKey) return jsonError(res, 400, 'Choose an opportunity to remove.');
    const updated = await dbService.updateLead(
      leadKey,
      {
        opportunityPipelineId: '',
        opportunityStageId: '',
        opportunityDismissed: true,
        opportunityChangedAt: new Date().toISOString(),
      },
      req.workspaceId,
    );
    if (!updated) return jsonError(res, 404, 'Lead not found.');
    ghlOpportunitySync.pushLeadsNow(req.workspaceId, [updated.key || leadKey]);
    teamActivity.record(req, {
      category: 'pipeline',
      action: 'opportunity_remove',
      summary: 'Removed from opportunities',
      leadKey: updated.key || leadKey,
      leadTitle: updated.title || '',
    });
    res.json({ success: true, key: updated.key });
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
    teamActivity.record(req, {
      category: 'leads',
      action: 'opportunity_card_add',
      summary: `Added opportunity card in ${pipeline.name || 'pipeline'} → ${stage.name || 'stage'}`,
      leadKey: key,
      leadTitle: title,
      created: true,
    });
    ghlOpportunitySync.pushLeadsNow(req.workspaceId, [key]);
    res.json({ success: true, key, pipelineId: pipeline.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
