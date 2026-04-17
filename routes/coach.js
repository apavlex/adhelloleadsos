const express = require('express');
const router = express.Router();
const { getCoachPayload } = require('../services/flowCoach');

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

module.exports = router;
