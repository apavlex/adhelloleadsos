/**
 * Get the app — workspace owner's Referral app (member PWA at /m/:token).
 * Partner / contractor apps for other businesses stay on Network → Members.
 */
const express = require('express');
const QRCode = require('qrcode');
const whiteLabel = require('../services/whiteLabel');
const { ensureOwnerReferralApp } = require('../services/ownerReferralApp');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const ws = req.workspace || {};
    const brand = whiteLabel.brandForWorkspace(ws);
    const app = await ensureOwnerReferralApp(req);
    res.render('get_app', {
      title: `Get Referral app | Agency OS`,
      activePage: 'get-app',
      navPrimary: 'get-app',
      appName: brand.appName,
      /** Absolute URL for Share + QR (installable member app). */
      openUrl: app.url,
      /** In-app path so Open stays in the browser/PWA session. */
      openPath: app.path,
      openHost: app.url.replace(/^https?:\/\//, ''),
      networkName: (app.network && app.network.name) || 'your network',
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
