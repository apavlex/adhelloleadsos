const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const sequenceEngine = require('../services/sequenceEngine');
const sequenceTemplates = require('../services/sequenceTemplates');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest } = require('../services/workspaceService');

function mapTemplateSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => ({
    dayOffset: s.dayOffset,
    channel: s.channel,
    title: s.title,
    hint: s.hint || '',
  }));
}

function serializeSequenceTemplates(req) {
  const raw = req.app.locals.sequenceTemplates || sequenceEngine.listTemplates();
  return (Array.isArray(raw) ? raw : []).map((t) => {
    if (!t || !t.id) return null;
    let steps = mapTemplateSteps(t.steps);
    if (!steps.length) {
      const full = sequenceTemplates.getTemplate(t.id);
      if (full && Array.isArray(full.steps)) steps = mapTemplateSteps(full.steps);
    }
    const stepCount = steps.length || (t.stepCount != null ? t.stepCount : 0);
    return {
      id: t.id,
      persona: t.persona,
      name: t.name,
      description: t.description,
      stepCount,
      steps,
    };
  }).filter(Boolean);
}

/** JSON playbook list for lead panel cadence picker (and other clients). */
router.get('/templates.json', (req, res) => {
  res.json({ success: true, templates: serializeSequenceTemplates(req) });
});

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, all);
    const templates = serializeSequenceTemplates(req).map((t) => ({
      id: t.id,
      persona: t.persona,
      name: t.name,
      description: t.description,
      stepCount: t.stepCount,
    }));
    const active = leads.filter(
      (l) => l.sequenceState && l.sequenceState.status === 'active'
    );
    const stageRows = await pipelineStagesService.ensureWorkspaceStagesSeeded(req.workspaceId);
    const pipelineStages = pipelineStagesService.stagesForKanban(stageRows);
    res.render('sequences', {
      title: 'Cadences | Agency OS',
      activePage: 'sequences',
      templates,
      activeSequences: active,
      activeCount: active.length,
      pipelineStages,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
