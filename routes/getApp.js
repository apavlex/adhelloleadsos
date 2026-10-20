/**
 * Get the app — workspace owner's Review app (member PWA at /m/:token).
 * Partner / contractor apps for other businesses stay on Network → Members.
 */
const express = require('express');
const QRCode = require('qrcode');
const whiteLabel = require('../services/whiteLabel');
const { ensureOwnerReferralApp } = require('../services/ownerReferralApp');
const demoWorkspace = require('../services/demoWorkspace');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const ws = req.workspace || {};
    const brand = whiteLabel.brandForWorkspace(ws);
    if (ws.isDemo && req.workspaceId) {
      const email = String(
        (req.user && req.user.emails && req.user.emails[0] && req.user.emails[0].value) || '',
      )
        .trim()
        .toLowerCase();
      await demoWorkspace.ensureDemoOwnerReviewApp(req.workspaceId, { email }).catch(() => {});
    }
    const app = await ensureOwnerReferralApp(req);
    const businessName =
      (brand.customName && String(brand.customName).trim()) ||
      (ws.name && String(ws.name).trim()) ||
      (app.member && app.member.companyName) ||
      (app.network && app.network.name) ||
      'your business';
    const staffName = String((app.member && app.member.contactName) || '').trim();
    res.render('get_app', {
      title: `Get Review app | Agency OS`,
      activePage: 'get-app',
      navPrimary: 'get-app',
      appName: brand.appName,
      /** Absolute short URL on reviews.adhello.io for Share + QR + Open. */
      openUrl: app.url,
      /** Signed /m path (fallback only). Prefer openUrl so Open leaves the CRM host. */
      openPath: app.path,
      openHost: String(app.url || '').replace(/^https?:\/\//, '').split('?')[0],
      networkName: businessName,
      businessName,
      staffName,
      isStaffApp: Boolean(app.isStaff),
      isDemo: Boolean(ws.isDemo),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/qr.png', async (req, res) => {
  try {
    const app = await ensureOwnerReferralApp(req);
    const png = await QRCode.toBuffer(app.url, {
      type: 'png',
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.end(png);
  } catch (err) {
    return res.status(500).end();
  }
});

module.exports = router;
