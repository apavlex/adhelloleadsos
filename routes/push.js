const express = require('express');
const router = express.Router();
const push = require('../services/pushNotifications');
const { userEmail } = require('../services/workspaceService');

router.get('/key', (req, res) => {
  res.json({ success: true, publicKey: push.publicKey() });
});

router.post('/subscribe', express.json(), (req, res) => {
  const result = push.saveSubscription({
    subscription: req.body && req.body.subscription,
    userEmail: userEmail(req),
    workspaceId: req.workspaceId,
    userAgent: req.get('user-agent'),
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
});

router.post('/unsubscribe', express.json(), (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) push.removeSubscription(endpoint, userEmail(req));
  res.json({ success: true });
});

router.post('/test', express.json(), async (req, res) => {
  const { sent } = await push.sendPush(
    { userEmail: userEmail(req) },
    { title: 'Push alerts are on', body: 'You will get new leads, missed calls, texts, lead runs, and task reminders here, even with the app closed.', url: '/today', tag: 'push-test' }
  );
  res.json({ success: true, sent });
});

module.exports = router;
