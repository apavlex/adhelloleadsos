const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const sequenceEngine = require('../services/sequenceEngine');
const pipelineStagesService = require('../services/pipelineStagesService');
const { filterLeadsForRequest } = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, all);
    const templates = sequenceEngine.listTemplates();
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
