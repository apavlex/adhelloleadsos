const express = require('express');
const router = express.Router();
const activationService = require('../services/activationService');
const workspaceService = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const email = workspaceService.userEmail(req);
    const activation = await activationService.getState(email, req.workspace || req.workspaceId);
    res.render('activation', {
      title: `${activation.total}-day activation plan`,
      activePage: 'activation',
      activation,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/day/:dayId', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const email = workspaceService.userEmail(req);
    const dayId = (req.params.dayId || '').trim();
    const activation = await activationService.completeDay(email, dayId, req.workspace || req.workspaceId);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, activation });
    }
    res.redirect('/activation');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
