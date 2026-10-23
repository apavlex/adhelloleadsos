/**
 * Public free member-app signup — pasteable AdHello.io / reviews.adhello.io links.
 *   GET/POST /app              → AdHello Agency network (30-day trial)
 *   GET/POST /app/flooring     → Flooring partners on TPR Flooring network
 *                                 (no trial; material quotes → that workspace owner)
 *   GET/POST /join/:slug       → that agency's network (workspace slug;
 *                                 flooring host slug creates app_flooring members)
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
  offer = '',
} = {}) {
  const brand = await brandForNetwork(network);
  const slug = freeAppSignup.cleanJoinSlug(joinSlug);
  const normalizedOffer = freeAppSignup.normalizeSignupOffer(offer);
  const flooring = normalizedOffer === freeAppSignup.OFFER_FLOORING;
  let formAction = '/app';
  if (slug) formAction = `/join/${encodeURIComponent(slug)}`;
  else if (flooring) formAction = '/app/flooring';
  return res.status(status).render('free_app', {
    brand,
    form: formValues,
    errors,
    sent,
    trialSignupHref: '/signup',
    loginHref: '/m/login',
    formAction,
    joinSlug: slug,
    // Only label "Join {network}" for /join/:slug — /app/flooring may pass
    // the host network for branding without implying a join link.
    joinNetworkName: slug && network && network.name ? network.name : '',
    signupOffer: normalizedOffer,
    flooringPartner: flooring,
  });
}

async function flooringNetworkForRender() {
  try {
    return await freeAppSignup.resolveFlooringAppNetwork();
  } catch (_) {
    return null;
  }
}

async function handleAppPost(req, res, next, { offer = '' } = {}) {
  try {
    const flooring = freeAppSignup.normalizeSignupOffer(offer) === freeAppSignup.OFFER_FLOORING;
    const hostNetwork = flooring ? await flooringNetworkForRender() : null;
    const { form: formValues, errors, digits, email } = freeAppSignup.readForm(req.body || {});
    if (errors.length) {
      return render(req, res, {
        formValues,
        errors,
        status: 400,
        offer,
        network: hostNetwork,
      });
    }
    const result = await freeAppSignup.signupFreeApp({
      form: formValues,
      digits,
      email,
      baseUrl: getReviewPublicBaseUrl(),
      ip: clientIp(req),
      offer,
      network: hostNetwork || undefined,
    });
    if (!result.ok) {
      return render(req, res, {
        formValues,
        errors: [result.error || 'Could not send your app link. Try again.'],
        status: result.code === 'rate_limit' ? 429 : 400,
        offer,
        network: hostNetwork || result.network || null,
      });
    }
    return render(req, res, {
      formValues: {},
      sent: true,
      offer,
      network: result.network || hostNetwork,
    });
  } catch (err) {
    return next(err);
  }
}

router.get('/app', async (req, res, next) => {
  try {
    return await render(req, res);
  } catch (err) {
    return next(err);
  }
});

router.post('/app', form, (req, res, next) => handleAppPost(req, res, next));

router.get('/app/flooring', async (req, res, next) => {
  try {
    const network = await flooringNetworkForRender();
    return await render(req, res, {
      offer: freeAppSignup.OFFER_FLOORING,
      network,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/app/flooring', form, (req, res, next) =>
  handleAppPost(req, res, next, { offer: freeAppSignup.OFFER_FLOORING }));

async function offerForJoinNetwork(network) {
  if (network && (await freeAppSignup.isFlooringHostNetwork(network))) {
    return freeAppSignup.OFFER_FLOORING;
  }
  return '';
}

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
    const offer = await offerForJoinNetwork(network);
    return render(req, res, { network, joinSlug, offer });
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
    const offer = await offerForJoinNetwork(network);
    const { form: formValues, errors, digits, email } = freeAppSignup.readForm(req.body || {});
    if (errors.length) {
      return render(req, res, { formValues, errors, status: 400, network, joinSlug, offer });
    }
    const result = await freeAppSignup.signupFreeApp({
      form: formValues,
      digits,
      email,
      baseUrl: getReviewPublicBaseUrl(),
      ip: clientIp(req),
      network,
      joinSlug,
      offer,
    });
    if (!result.ok) {
      return render(req, res, {
        formValues,
        errors: [result.error || 'Could not send your app link. Try again.'],
        status: result.code === 'rate_limit' ? 429 : 400,
        network,
        joinSlug,
        offer,
      });
    }
    return render(req, res, { formValues: {}, sent: true, network, joinSlug, offer });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
