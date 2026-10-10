/**
 * Get the app — Add to Home Screen for the workspace team, plus partner/contractor
 * review-request app links (so access is not buried under Referrals → Network).
 */
const express = require('express');
const QRCode = require('qrcode');
const whiteLabel = require('../services/whiteLabel');
const { getPublicBaseUrl } = require('../lib/publicBaseUrl');
const memberAppointmentLink = require('../services/memberAppointmentLink');
const networkNotify = require('../services/networkNotify');
const networkStore = require('../services/networkStore');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const ws = req.workspace || {};
    const brand = whiteLabel.brandForWorkspace(ws);
    const openUrl = `${getPublicBaseUrl(req)}/today`;
    const { network, partners } = await memberAppointmentLink.listPartnerAppsForWorkspace(req.workspaceId);
    res.render('get_app', {
      title: `Get ${brand.appName} | Agency OS`,
      activePage: 'get-app',
      appName: brand.appName,
      openUrl,
      openHost: openUrl.replace(/^https?:\/\//, ''),
      partnerNetwork: network
        ? { id: network.id, name: network.name || 'Referral network' }
        : null,
      partners,
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

/** JSON: partner review-app URL (member app with Request a review). */
router.get('/partners/:memberId/link', async (req, res) => {
  try {
    const network = await networkStore.getNetworkForWorkspace(req.workspaceId);
    if (!network) return res.status(404).json({ success: false, error: 'No network for this workspace yet.' });
    const member = await networkStore.getMember(network.id, req.params.memberId);
    if (!member || member.status === 'paused') {
      return res.status(404).json({ success: false, error: 'Partner not found.' });
    }
    const baseUrl = networkNotify.baseUrlFromReq(req);
    const url = networkNotify.memberPortalLink(baseUrl, network, member);
    const reviewUrl = `${url}/review?ask=1`;
    return res.json({
      success: true,
      url,
      reviewUrl,
      memberId: member.id,
      companyName: member.companyName,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not build that link.' });
  }
});

/** Text/email the partner their review + referral app link. */
router.post('/partners/:memberId/send', express.json(), async (req, res) => {
  try {
    const network = await networkStore.getNetworkForWorkspace(req.workspaceId);
    if (!network) return res.status(404).json({ success: false, error: 'No network for this workspace yet.' });
    const member = await networkStore.getMember(network.id, req.params.memberId);
    if (!member || member.status === 'paused') {
      return res.status(404).json({ success: false, error: 'Partner not found.' });
    }
    const sent = await networkNotify.sendMemberPortalLink({
      network,
      member,
      baseUrl: networkNotify.baseUrlFromReq(req),
    });
    if (!sent.ok) {
      return res.status(400).json({ success: false, error: sent.error || 'Could not send the app link.' });
    }
    return res.json({
      success: true,
      channel: sent.channel,
      companyName: member.companyName,
    });
  } catch (err) {
    console.error('[get-app] partner send failed:', err && err.message);
    return res.status(500).json({ success: false, error: 'Could not send the app link.' });
  }
});

module.exports = router;
