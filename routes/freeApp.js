/**
 * Public free member-app signup — pasteable AdHello.io / reviews.adhello.io links.
 *   GET/POST /app           → AdHello Agency network (default public trial)
 *   GET/POST /join/:slug    → that agency's network (workspace slug)
 * Mounted before ensureAuthenticated (no Google / workspace required).
 */
const express = require('express');
const freeAppSignup = require('../services/freeAppSignup');
const networkBrand = require('../services/networkBrand');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '16kb' });

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
    .split(',')[0]
    .trim() || 'unknown';
}

async function brandForNetwork(network) {
  try {
    return networkBrand.brandView(network || null, null, { freeApp: true });
  } catch (_) {
    return networkBrand.brandView(null, null, { freeApp: true });
  }
}

async function render(req, res, {
  formValues = {},
  errors = [],
  sent = false,
  status = 200,
  network = null,
  joinSlug = '',
} = {}) {
  const brand = await brandForNetwork(network);
  const slug = freeAppSignup.cleanJoinSlug(joinSlug);
  const formAction = slug ? `/join/${encodeURIComponent(slug)}` : '/app';
  return res.status(status).render('free_app', {
    brand,
    form: formValues,
    errors,
    sent,
    trialSignupHref: '/signup',
    loginHref: '/m/login',
    formAction,
    joinSlug: slug,
    joinNetworkName: network && network.name ? network.name : '',
  });
}

router.get('/app', async (req, res, next) => {
  try {
    return await render(req, res);
  } catch (err) {
    return next(err);
  }
});

router.post('/app', form, async (req, res, next) => {
  try {
    const { form: formValues, errors, digits, email } = freeAppSignup.readForm(req.body || {});
    if (errors.length) {
      return render(req, res, { formValues, errors, status: 400 });
    }
    const result = await freeAppSignup.signupFreeApp({
      form: formValues,
      digits,
      email,
      baseUrl: getReviewPublicBaseUrl(),
      ip: clientIp(req),
    });
    if (!result.ok) {
      return render(req, res, {
        formValues,
        errors: [result.error || 'Could not send your app link. Try again.'],
        status: result.code === 'rate_limit' ? 429 : 400,
      });
    }
    return render(req, res, { formValues: {}, sent: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/join/:slug', async (req, res, next) => {
  try {
    const joinSlug = freeAppSignup.cleanJoinSlug(req.params.slug);
    if (!joinSlug) return res.redirect(302, '/app');
    const network = await freeAppSignup.resolveNetworkByJoinSlug(joinSlug);
    if (!network) {
      return render(req, res, {
        joinSlug,
        errors: ['That signup link is not valid. Ask your agency for a fresh link.'],
        status: 404,
      });
    }
    return render(req, res, { network, joinSlug });
  } catch (err) {
    return next(err);
  }
});

router.post('/join/:slug', form, async (req, res, next) => {
  try {
    const joinSlug = freeAppSignup.cleanJoinSlug(req.params.slug);
    if (!joinSlug) return res.redirect(302, '/app');
    const network = await freeAppSignup.resolveNetworkByJoinSlug(joinSlug);
    if (!network) {
      return render(req, res, {
        joinSlug,
        formValues: req.body || {},
        errors: ['That signup link is not valid. Ask your agency for a fresh link.'],
        status: 404,
      });
    }
    const { form: formValues, errors, digits, email } = freeAppSignup.readForm(req.body || {});
    if (errors.length) {
      return render(req, res, { formValues, errors, status: 400, network, joinSlug });
    }
    const result = await freeAppSignup.signupFreeApp({
      form: formValues,
      digits,
      email,
      baseUrl: getReviewPublicBaseUrl(),
      ip: clientIp(req),
      network,
      joinSlug,
    });
    if (!result.ok) {
      return render(req, res, {
        formValues,
        errors: [result.error || 'Could not send your app link. Try again.'],
        status: result.code === 'rate_limit' ? 429 : 400,
        network,
        joinSlug,
      });
    }
    return render(req, res, { formValues: {}, sent: true, network, joinSlug });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
