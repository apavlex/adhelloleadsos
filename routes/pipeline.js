const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const pipelineStagesService = require('../services/pipelineStagesService');
const { explainPipelineStage } = require('../services/explainPipelineStage');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const { userEmail } = require('../services/workspaceService');

/**
 * POST /pipeline/stages/explain
 * Body: { stageId?, workspaceId?, stage?: { key, name }, position1Based?, totalStages?, businessDescription? }
 */
router.post('/stages/explain', express.json(), async (req, res) => {
  try {
    const email = userEmail(req);
    if (!email) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const body = req.body || {};
    const wid =
      String(body.workspaceId || req.workspaceId || '').trim() || String(req.workspaceId || '').trim();
    const stageId = String(body.stageId || '').trim();
    let stageKey = '';
    let stageName = '';
    let position1Based = parseInt(body.position1Based, 10) || 1;
    let totalStages = parseInt(body.totalStages, 10) || 1;

    if (stageId && wid) {
      const ws = await dbService.getWorkspace(wid);
      if (!ws || !workspaceBootstrap.userCanAccessWorkspace(ws, email)) {
        return res.status(403).json({ success: false, error: 'No access to workspace.' });
      }
      const rows = await pipelineStagesService.listStages(wid);
      const row = rows.find((s) => s.id === stageId);
      if (!row) {
        return res.status(404).json({ success: false, error: 'Stage not found.' });
      }
      stageKey = row.key;
      stageName = row.name;
      const sorted = [...rows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      position1Based = sorted.findIndex((s) => s.id === row.id) + 1;
      totalStages = sorted.length;
    } else if (body.stage && typeof body.stage === 'object') {
      stageKey = String(body.stage.key || '');
      stageName = String(body.stage.name || '');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Provide stageId (saved stage) or stage { key, name } for wizard.',
      });
    }

    let businessDescription = String(body.businessDescription || '').trim();
    if (!businessDescription && wid) {
      const ws = await dbService.getWorkspace(wid);
      const intake = ws && ws.pipelineIntake;
      if (intake && typeof intake.businessDescription === 'string') {
        businessDescription = intake.businessDescription.trim();
      }
      if (!businessDescription && ws && typeof ws.coachPrompt === 'string') {
        businessDescription = ws.coachPrompt.trim().slice(0, 400);
      }
    }
    if (!businessDescription) {
      businessDescription = 'Small business sales pipeline.';
    }

    const result = await explainPipelineStage({
      stageKey,
      stageName,
      position1Based,
      totalStages,
      businessDescription,
    });

    if (!result.success) {
      return res.json({ success: false, error: result.error || 'Explanation failed.' });
    }

    if (stageId && wid) {
      try {
        await pipelineStagesService.updateStageDescription(wid, stageId, result.description);
      } catch (_) {
        /* non-fatal */
      }
    }

    return res.json({ success: true, description: result.description });
  } catch (e) {
    console.warn('[pipeline/explain]', e.message);
    return res.json({ success: false, error: 'Could not generate explanation. Try again.' });
  }
});

module.exports = router;
