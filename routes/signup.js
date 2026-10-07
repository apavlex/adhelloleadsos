/**
 * Public self-serve signup: details form → Google sign-in → trial workspace.
 * Mounted before ensureAuthenticated / withWorkspace (new users have no workspace yet).
 */
const express = require('express');
const trials = require('../services/trials');
const signupNotify = require('../services/signupNotify');
const workspaceBootstrap = require('../services/workspaceBootstrap');
const workspaceService = require('../services/workspaceService');
const withWorkspace = require('../middleware/withWorkspace');
const { isGoogleAuthConfigured } = require('../services/auth');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();

function signedInEmail(req) {
  if (!(req.isAuthenticated && req.isAuthenticated())) return '';
  if (req.user && req.user.demoGuest) return '';
  return workspaceService.userEmail(req).toLowerCase();
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
    .split(',')[0]
    .trim();
}

function render(res, { form = {}, errors = [], signedInAs = '', status = 200 } = {}) {
  return res.status(status).render('signup', {
    form,
    errors,
    signedInAs,
    googleAuthConfigured: isGoogleAuthConfigured,
    trialDays: trials.defaults().days,
    TEAM_SIZES: trials.TEAM_SIZES,
    SOURCES: trials.SOURCES,
  });
}

async function hasWorkspace(email) {
  const ids = await workspaceBootstrap.collectWorkspaceIdsForEmail(email);
  return ids.length > 0;
}

router.get('/signup', async (req, res, next) => {
  try {
    const email = signedInEmail(req);
    if (email && (await hasWorkspace(email))) return res.redirect('/today');
    const pending = (req.session && req.session.pendingSignup) || {};
    const googleName = (req.user && req.user.displayName) || '';
    return render(res, { form: { name: googleName, ...pending }, signedInAs: email });
  } catch (e) {
    return next(e);
  }
});

router.post('/signup', express.urlencoded({ extended: false, limit: '16kb' }), (req, res, next) => {
  const { form, errors } = trials.readSignupForm(req.body || {});
  const email = signedInEmail(req);
  if (errors.length) return render(res, { form, errors, signedInAs: email, status: 400 });

  const proceed = () => {
    req.session.pendingSignup = form;
    if (email) return req.session.save(() => res.redirect('/signup/complete'));
    req.session.returnTo = '/signup/complete';
    return req.session.save(() => res.redirect('/auth/google'));
  };
  // A live-demo visitor signing up: drop the guest session first.
  if (req.user && req.user.demoGuest) return req.logout((err) => (err ? next(err) : proceed()));
  return proceed();
});

router.get('/signup/complete', async (req, res, next) => {
  try {
    const email = signedInEmail(req);
    if (!email) return res.redirect('/signup');
    if (await hasWorkspace(email)) {
      if (req.session) delete req.session.pendingSignup;
      return res.redirect('/today');
    }
    const pending = req.session && req.session.pendingSignup;
    if (!pending) return res.redirect('/signup');
    const { form, errors } = trials.readSignupForm(pending);
    if (errors.length) return render(res, { form, errors, signedInAs: email, status: 400 });

    const ip = clientIp(req);
    if (!trials.takeIpSlot(ip)) {
      return render(res, {
        form,
        errors: ['Too many trials were started from this network today. Try again tomorrow or contact us.'],
        signedInAs: email,
        status: 429,
      });
    }

    const { workspaceId, signup } = await trials.createTrialWorkspace({
      email,
      form,
      googleName: req.user && req.user.displayName,
      ip,
    });
    delete req.session.pendingSignup;
    req.session.activeWorkspaceId = workspaceId;
    req.session.workspaceId = workspaceId;
    delete req.session._wsBootstrapped;
    withWorkspace.clearSwitcherCache(email);

    const baseUrl = getPublicBaseUrl(req);
    setImmediate(() => {
      signupNotify
        .notifyNewSignup(signup, { baseUrl })
        .then((r) => {
          if (r.errors.length) console.warn('[signup] notify:', r.errors.join(' | '));
        })
        .catch((e) => console.warn('[signup] notify failed:', e.message));
    });
    return req.session.save(() => res.redirect('/today?welcome=trial'));
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
