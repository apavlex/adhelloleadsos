/**
 * Public free member-app signup — pasteable AdHello.io link.
 *   GET/POST /app  → create free network member + text/email install link
 * Mounted before ensureAuthenticated (no Google / workspace required).
 */
const express = require('express');
const freeAppSignup = require('../services/freeAppSignup');
const networkBrand = require('../services/networkBrand');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '16kb' });

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
    .split(',')[0]
    .trim() || 'unknown';
}

async function brandForPage() {
  try {
    const network = await freeAppSignup.resolveFreeAppNetwork();
    return networkBrand.brandView(network);
  } catch (_) {
    return networkBrand.brandView({
      name: 'AdHello',
      brand: { appName: 'AdHello', accent: '#FFDB3A', tagline: 'Reviews, customers & referrals — free.' },
    });
  }
}

async function render(req, res, { formValues = {}, errors = [], sent = false, status = 200 } = {}) {
  const brand = await brandForPage();
  return res.status(status).render('free_app', {
    brand,
    form: formValues,
    errors,
    sent,
    trialSignupHref: '/signup',
    loginHref: '/m/login',
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
      baseUrl: getPublicBaseUrl(req),
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

module.exports = router;
