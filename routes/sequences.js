const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const sequenceEngine = require('../services/sequenceEngine');
const { filterLeadsForRequest } = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads();
    const leads = filterLeadsForRequest(req, all);
    const templates = sequenceEngine.listTemplates();
    const active = leads.filter(
      (l) => l.sequenceState && l.sequenceState.status === 'active'
    );
    res.render('sequences', {
      title: 'Cadences | Sequences',
      activePage: 'sequences',
      templates,
      activeSequences: active,
      activeCount: active.length,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
