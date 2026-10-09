/**
 * Public contractor portal — /p/:token
 * Appointments tracker, website form leads, request/purchase more packages.
 */
const express = require('express');
const contractorPortal = require('../services/contractorPortal');
const appointmentPackages = require('../services/appointmentPackages');
const push = require('../services/pushNotifications');

const router = express.Router();
const form = express.urlencoded({ extended: true, limit: '64kb' });
const json = express.json({ limit: '32kb' });

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function renderInvalid(res, status, message) {
  noStore(res);
  return res.status(status || 404).render('contractor_portal/invalid', {
    message: message || 'This portal link has expired or was replaced.',
    brand: { appName: 'AdHello', logoUrl: '/images/adhello-app-icon.png' },
  });
}

function withPortal(handler) {
  return async (req, res) => {
    try {
      const ctx = await contractorPortal.loadPortalContext(req.params.token);
      if (!ctx) return renderInvalid(res);
      return await handler(req, res, ctx);
    } catch (err) {
      console.error('[contractor-portal]', req.method, req.path, err && err.message);
      return renderInvalid(res, 500, 'Something went wrong. Try again in a moment.');
    }
  };
}

function flashFromQuery(req) {
  const ok = String(req.query.ok || '');
  const err = String(req.query.err || '');
  if (ok === 'request') return { ok: 'Request sent. Your agency will follow up shortly.' };
  if (ok === 'purchase') return { ok: 'Purchase request sent. You will get more credits once approved.' };
  if (ok === 'closed') return { ok: 'Lead marked closed.' };
  if (err === 'quantity') return { error: 'Enter a quantity of at least 1.' };
  if (err) return { error: 'Could not submit that request. Try again.' };
  return null;
}

router.get(
  '/p/:token',
  withPortal(async (req, res, ctx) => {
    const home = contractorPortal.buildPortalHome(ctx.package);
    noStore(res);
    return res.render('contractor_portal/home', {
      ...ctx,
      ...home,
      active: 'home',
      flash: flashFromQuery(req),
      title: `${ctx.package.businessName} · Portal`,
    });
  }),
);

router.get(
  '/p/:token/leads',
  withPortal(async (req, res, ctx) => {
    const home = contractorPortal.buildPortalHome(ctx.package);
    noStore(res);
    return res.render('contractor_portal/leads', {
      ...ctx,
      ...home,
      active: 'leads',
      flash: flashFromQuery(req),
      title: `Leads · ${ctx.package.businessName}`,
    });
  }),
);

router.get(
  '/p/:token/packages',
  withPortal(async (req, res, ctx) => {
    const home = contractorPortal.buildPortalHome(ctx.package);
    noStore(res);
    return res.render('contractor_portal/packages', {
      ...ctx,
      ...home,
      active: 'packages',
      flash: flashFromQuery(req),
      title: `Packages · ${ctx.package.businessName}`,
    });
  }),
);

router.post(
  '/p/:token/request',
  form,
  withPortal(async (req, res, ctx) => {
    const quantity = Math.round(Number(req.body && req.body.quantity) || 0);
    const type = String((req.body && req.body.type) || 'leads').toLowerCase() === 'appointments'
      ? 'appointments'
      : 'leads';
    const note = String((req.body && req.body.note) || '').trim();
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.redirect(`${ctx.base}/packages?err=quantity`);
    }
    await contractorPortal.submitRequest(ctx.workspaceId, ctx.packageId, {
      type,
      quantity,
      note: note || null,
    });
    const ok = type === 'leads' && String((req.body && req.body.intent) || '') === 'purchase'
      ? 'purchase'
      : 'request';
    return res.redirect(`${ctx.base}/packages?ok=${ok}`);
  }),
);

router.post(
  '/p/:token/leads/:leadId/close',
  form,
  withPortal(async (req, res, ctx) => {
    const leadId = String(req.params.leadId || '').trim();
    const pkg = ctx.package;
    const formLeads = (pkg.formLeads || []).map((f) =>
      f.id === leadId ? { ...f, status: 'closed' } : f,
    );
    await appointmentPackages.updatePackage(ctx.workspaceId, ctx.packageId, { formLeads });
    return res.redirect(`${ctx.base}/leads?ok=closed`);
  }),
);

/** Same Web Push stack as agency alerts — scoped to this contractor package. */
router.get(
  '/p/:token/push/key',
  withPortal(async (req, res) => {
    noStore(res);
    return res.json({ success: true, publicKey: push.publicKey() });
  }),
);

router.post(
  '/p/:token/push/subscribe',
  json,
  withPortal(async (req, res, ctx) => {
    noStore(res);
    const result = push.savePortalSubscription({
      subscription: req.body && req.body.subscription,
      workspaceId: ctx.workspaceId,
      packageId: ctx.packageId,
      userAgent: req.get('user-agent'),
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    return res.json({ success: true });
  }),
);

router.post(
  '/p/:token/push/unsubscribe',
  json,
  withPortal(async (req, res, ctx) => {
    noStore(res);
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) push.removePortalSubscription(endpoint, ctx.packageId);
    return res.json({ success: true });
  }),
);

router.post(
  '/p/:token/push/test',
  json,
  withPortal(async (req, res, ctx) => {
    noStore(res);
    const { sent } = await push.sendPortalPush(
      { packageId: ctx.packageId, workspaceId: ctx.workspaceId },
      {
        title: 'Alerts are on',
        body: `You’ll get new leads for ${ctx.package.businessName} here on this phone or computer, even when the portal is closed.`,
        url: `${ctx.base}/leads`,
        tag: 'portal-push-test',
      },
    );
    return res.json({ success: true, sent });
  }),
);

module.exports = router;
