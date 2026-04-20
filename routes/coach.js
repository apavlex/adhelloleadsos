const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const { getCoachPayload } = require('../services/flowCoach');
const { getLeadsCoachPayload } = require('../services/opportunityScore');
const { filterLeadsForRequest } = require('../services/workspaceService');

/**
 * GET /coach — JSON for the flow coach (refresh button, optional clients)
 */
router.get('/', async (req, res, next) => {
  try {
    const coach = await getCoachPayload(req);
    res.json(coach);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /coach/leads — gap-ranked coaching for Saved Leads page
 */
router.get('/leads', async (req, res, next) => {
  try {
    const all = await dbService.getAllLeads(req.workspaceId);
    const leads = filterLeadsForRequest(req, all);
    res.json(getLeadsCoachPayload(leads));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
