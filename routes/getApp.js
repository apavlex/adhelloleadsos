/**
 * Get the app — workspace Referral app only (PWA → /today).
 * Partner / contractor apps live on Network → Members.
 */
const express = require('express');
const QRCode = require('qrcode');
const whiteLabel = require('../services/whiteLabel');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const ws = req.workspace || {};
    const brand = whiteLabel.brandForWorkspace(ws);
    const openUrl = `${getPublicBaseUrl(req)}/today`;
    res.render('get_app', {
      title: `Get ${brand.appName} | Agency OS`,
      activePage: 'get-app',
      navPrimary: 'get-app',
      appName: brand.appName,
      openUrl,
      openHost: openUrl.replace(/^https?:\/\//, ''),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/qr.png', async (req, res) => {
  try {
    const png = await QRCode.toBuffer(`${getPublicBaseUrl(req)}/today`, {
      type: 'png',
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.end(png);
  } catch (err) {
    return res.status(500).end();
  }
});

module.exports = router;
