const express = require('express');
const router = express.Router();
const activationService = require('../services/activationService');
const workspaceService = require('../services/workspaceService');

router.get('/', async (req, res, next) => {
  try {
    const email = workspaceService.userEmail(req);
    const activation = await activationService.getState(email);
    res.render('activation', {
      title: '7-day activation plan',
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
    await activationService.completeDay(email, dayId);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      const activation = await activationService.getState(email);
      return res.json({ success: true, activation });
    }
    res.redirect('/activation');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
