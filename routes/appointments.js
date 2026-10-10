/**
 * Appointment tracker — sell packages, sync GHL calendars, send leads to contractors.
 * Lives under Referrals in the sidebar (/appointments).
 */
const express = require('express');
const router = express.Router();
const appointmentPackages = require('../services/appointmentPackages');
const contractorPortal = require('../services/contractorPortal');
const memberAppointmentLink = require('../services/memberAppointmentLink');
const networkNotify = require('../services/networkNotify');

router.get('/', async (req, res, next) => {
  try {
    const appointmentTracker = await appointmentPackages.loadTodayView(req.workspaceId);
    res.render('appointments', {
      title: 'Appointments | Agency OS',
      activePage: 'appointments',
      appointmentTracker,
    });
  } catch (e) {
    next(e);
  }
});

/** List GHL calendars for appointment package linking. */
router.get('/appointment-packages/calendars', async (req, res, next) => {
  try {
    const result = await appointmentPackages.listGhlCalendars(req.workspaceId);
    return res.json({ success: !result.error || !!result.calendars.length, ...result });
  } catch (e) {
    next(e);
  }
});

/** Create a sold appointment package for a business. */
router.post('/appointment-packages', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!String(body.businessName || '').trim()) {
      return res.status(400).json({ success: false, error: 'Business name is required.' });
    }
    const purchased = Number(body.purchased);
    if (!Number.isFinite(purchased) || purchased < 1) {
      return res.status(400).json({ success: false, error: 'Purchased appointment count must be at least 1.' });
    }
    const pkg = await appointmentPackages.createPackage(req.workspaceId, body);
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({ success: true, package: pkg, appointmentTracker: view });
  } catch (e) {
    next(e);
  }
});

/** Sync one or all packages from GHL calendars. */
router.post('/appointment-packages/sync', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await appointmentPackages.syncFromGhl(req.workspaceId, {
      packageId: body.packageId || null,
    });
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({
      success: !!result.ok,
      ...result,
      appointmentTracker: view,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Send one lead to many contractors: pick package ids and/or a trade
 * (e.g. all Electricians, all Flooring stores). Each gets a copy + push.
 */
router.post('/appointment-packages/deliver-lead-bulk', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!String(body.name || body.title || '').trim()) {
      return res.status(400).json({ success: false, error: 'Lead name is required.' });
    }
    const packageIds = Array.isArray(body.packageIds)
      ? body.packageIds
      : (body.packageId ? [body.packageId] : []);
    const trade = String(body.trade || '').trim() || null;
    if (!packageIds.length && !trade) {
      return res.status(400).json({
        success: false,
        error: 'Pick at least one contractor or a trade (e.g. Electrician, Flooring).',
      });
    }
    const result = await appointmentPackages.deliverLeadBulk(req.workspaceId, {
      packageIds,
      trade,
      leadInput: {
        name: body.name || body.title,
        phone: body.phone || null,
        email: body.email || null,
        preview: body.preview || body.note || null,
        leadKey: body.leadKey || null,
        formName: body.formName || 'Sent by agency',
        source: 'agency',
      },
    });
    if (!result.ok) {
      return res.status(404).json({ success: false, error: result.error || 'No matching contractors.', delivered: [], skipped: [] });
    }
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({
      success: true,
      count: result.count,
      delivered: result.delivered,
      skipped: result.skipped,
      appointmentTracker: view,
    });
  } catch (e) {
    next(e);
  }
});

/** Update a package (calendar link, purchased count, notes). */
router.patch('/appointment-packages/:id', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pkg = await appointmentPackages.updatePackage(req.workspaceId, req.params.id, body);
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found.' });
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({ success: true, package: pkg, appointmentTracker: view });
  } catch (e) {
    next(e);
  }
});

/** Delete a package. */
router.delete('/appointment-packages/:id', async (req, res, next) => {
  try {
    const ok = await appointmentPackages.deletePackage(req.workspaceId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Package not found.' });
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({ success: true, appointmentTracker: view });
  } catch (e) {
    next(e);
  }
});

/** Create / return the public contractor portal URL for a package. */
router.post('/appointment-packages/:id/portal-link', express.json(), async (req, res, next) => {
  try {
    const pkg = await appointmentPackages.getPackage(req.workspaceId, req.params.id);
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found.' });
    const token = await contractorPortal.ensurePortalToken(req.workspaceId, pkg.id);
    const url = contractorPortal.portalUrl(req, token);
    return res.json({ success: true, url, token, packageId: pkg.id });
  } catch (e) {
    next(e);
  }
});

/** Text or email the contractor app link to the business (phone/email on the package). */
router.post('/appointment-packages/:id/send-portal-link', express.json(), async (req, res, next) => {
  try {
    const result = await contractorPortal.sendPortalLinkToBusiness(req.workspaceId, req.params.id, { req });
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error, url: result.url || null });
    }
    return res.json({
      success: true,
      channel: result.channel,
      url: result.url,
      businessName: result.businessName,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Partner review app (/m) for a package — request reviews, not only referrals.
 * Resolves the linked network member from the appointment package.
 */
router.get('/appointment-packages/:id/review-app-link', async (req, res, next) => {
  try {
    const pkg = await appointmentPackages.getPackage(req.workspaceId, req.params.id);
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found.' });
    const linked = await memberAppointmentLink.findMemberForPackage(req.workspaceId, pkg);
    if (!linked) {
      return res.status(404).json({
        success: false,
        error: 'No network partner matched this package. Add them on Get the app or Network → Members, then try again.',
      });
    }
    const baseUrl = networkNotify.baseUrlFromReq(req);
    const url = networkNotify.memberPortalLink(baseUrl, linked.network, linked.member);
    return res.json({
      success: true,
      url,
      reviewUrl: `${url}/review?ask=1`,
      memberId: linked.member.id,
      companyName: linked.member.companyName,
      packageId: pkg.id,
    });
  } catch (e) {
    next(e);
  }
});

/** Text/email the partner review app (member app) for this package. */
router.post('/appointment-packages/:id/send-review-app-link', express.json(), async (req, res, next) => {
  try {
    const pkg = await appointmentPackages.getPackage(req.workspaceId, req.params.id);
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found.' });
    const linked = await memberAppointmentLink.findMemberForPackage(req.workspaceId, pkg);
    if (!linked) {
      return res.status(404).json({
        success: false,
        error: 'No network partner matched this package. Add them on Get the app or Network → Members first.',
      });
    }
    const sent = await networkNotify.sendMemberPortalLink({
      network: linked.network,
      member: linked.member,
      baseUrl: networkNotify.baseUrlFromReq(req),
    });
    if (!sent.ok) {
      return res.status(400).json({ success: false, error: sent.error || 'Could not send the review app link.' });
    }
    return res.json({
      success: true,
      channel: sent.channel,
      companyName: linked.member.companyName,
      packageId: pkg.id,
    });
  } catch (e) {
    next(e);
  }
});

/** Deliver a lead into a contractor package (consumes a credit + pushes to their devices). */
router.post('/appointment-packages/:id/deliver-lead', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!String(body.name || body.title || '').trim()) {
      return res.status(400).json({ success: false, error: 'Lead name is required.' });
    }
    const result = await appointmentPackages.deliverLeadToPackage(req.workspaceId, req.params.id, {
      name: body.name || body.title,
      phone: body.phone || null,
      email: body.email || null,
      preview: body.preview || body.note || null,
      leadKey: body.leadKey || null,
      formName: body.formName || 'Added by agency',
      source: 'agency',
    });
    if (!result || !result.matched) {
      return res.status(404).json({ success: false, error: 'Package not found.' });
    }
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({ success: true, ...result, appointmentTracker: view });
  } catch (e) {
    next(e);
  }
});

/** Fulfill or decline a contractor portal package request. */
router.post('/appointment-packages/:id/requests/:requestId/resolve', express.json(), async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const status = body.status === 'declined' ? 'declined' : 'fulfilled';
    const result = await appointmentPackages.resolvePortalRequest(
      req.workspaceId,
      req.params.id,
      req.params.requestId,
      { status, fulfill: status === 'fulfilled' },
    );
    if (!result) return res.status(404).json({ success: false, error: 'Request not found.' });
    const view = await appointmentPackages.loadTodayView(req.workspaceId);
    return res.json({ success: true, ...result, appointmentTracker: view });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
