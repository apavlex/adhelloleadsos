/**
 * Public live demo link: /live-demo/:key
 * GET shows a launch page (auto-continues in the browser, so link scanners that
 * only fetch the URL never build a sandbox); POST builds the sandbox and signs in.
 */
const express = require('express');
const publicDemo = require('../services/publicDemo');

const router = express.Router();

function visitorFrom(src) {
  const s = src || {};
  return { name: s.name || s.first_name || '', email: s.email || '', source: s.source || s.utm_source || '' };
}

function render(res, status, locals) {
  res.status(status).render('live_demo', {
    state: 'launch',
    message: '',
    key: '',
    visitor: {},
    signedInAs: '',
    cta: publicDemo.getConfig(),
    ...locals,
  });
}

router.get('/ended', (req, res) => {
  render(res, 200, { state: 'ended', endedByVisitor: req.query.by === 'you' });
});

router.get('/:key', (req, res) => {
  const guest = req.user && req.user.demoGuest;
  if (!publicDemo.keyMatches(req.params.key)) return render(res, 404, { state: 'inactive' });
  if (guest && publicDemo.isSandboxLive(guest)) return res.redirect('/today');
  const signedInAs =
    req.user && !guest && req.user.emails && req.user.emails[0] ? String(req.user.emails[0].value || '') : '';
  return render(res, 200, { key: req.params.key, visitor: visitorFrom(req.query), signedInAs });
});

router.post('/:key', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    if (!publicDemo.keyMatches(req.params.key)) return render(res, 404, { state: 'inactive' });
    const guest = req.user && req.user.demoGuest;
    if (guest && publicDemo.isSandboxLive(guest)) return res.redirect('/today');

    const { user, sandbox } = await publicDemo.launchSandbox({ ip: req.ip, visitor: visitorFrom(req.body) });
    return req.login(user, (err) => {
      if (err) return next(err);
      if (req.session) {
        req.session.cookie.maxAge = Math.max(60000, Date.parse(sandbox.expiresAt) - Date.now());
        req.session.activeWorkspaceId = sandbox.workspaceId;
        req.session.workspaceId = sandbox.workspaceId;
      }
      return res.redirect('/today');
    });
  } catch (e) {
    if (e instanceof publicDemo.DemoLimitError) {
      return render(res, 429, { state: 'error', message: e.message, key: req.params.key });
    }
    return next(e);
  }
});

module.exports = router;
