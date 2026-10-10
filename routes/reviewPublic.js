/**
 * Public review page for a network member (no login): /rv/:slug
 * Customers tap a star rating, then see review links; low ratings get a
 * private feedback form first (public links stay visible).
 */

const express = require('express');
const QRCode = require('qrcode');
const store = require('../services/networkStore');
const notify = require('../services/networkNotify');
const networkBrand = require('../services/networkBrand');
const reviewPage = require('../services/reviewPage');
const reviewShareImage = require('../services/reviewShareImage');
const { ICONS } = require('../services/memberAppIcons');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '16kb' });

const feedbackHits = new Map();
const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;
const FEEDBACK_MAX = 6;

function feedbackAllowed(ip) {
  const now = Date.now();
  const recent = (feedbackHits.get(ip) || []).filter((t) => now - t < FEEDBACK_WINDOW_MS);
  if (recent.length >= FEEDBACK_MAX) return false;
  recent.push(now);
  feedbackHits.set(ip, recent);
  if (feedbackHits.size > 5000) feedbackHits.clear();
  return true;
}

async function loadPage(slug) {
  const ref = await store.resolveReviewSlug(slug);
  if (!ref) return null;
  const network = await store.getNetwork(ref.networkId);
  if (!network) return null;
  const member = await store.getMember(network.id, ref.memberId);
  if (!member || member.reviewSlug !== ref.slug) return null;
  return { network, member, slug: ref.slug, brand: networkBrand.brandView(network) };
}

function notFound(res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(404).render('member_app/invalid', {
    message: 'This review page was not found.',
    brand: networkBrand.brandView(null),
    icons: ICONS,
  });
}

function renderPage(res, page, { rating, thanks, error, formValues, imageId }, status) {
  const shareId = reviewShareImage.isImageId(imageId) ? String(imageId).trim() : '';
  const ogUrl = notify.reviewPageLink(page.slug, shareId ? { imageId: shareId } : undefined);
  const ogImageUrl = reviewShareImage.shareImageAbsoluteUrl(page.slug, shareId || 'default');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(status || 200).render('review_public', {
    ...page,
    gate: reviewPage.reviewGate(rating),
    destinations: reviewPage.reviewDestinations(page.member.reviewLinks, page.slug),
    thanks: !!thanks,
    error: error || '',
    formValues: formValues || {},
    icons: ICONS,
    ogTitle: `Review ${page.member.companyName}`,
    ogDescription: `How was your experience with ${page.member.companyName}? Leave a quick review on AdHello.io.`,
    ogUrl,
    ogImageUrl,
    shareImageId: shareId,
  });
}

async function serveShareImage(req, res, imageId) {
  try {
    const page = await loadPage(req.params.slug);
    if (!page) return res.status(404).end();
    const img = await reviewShareImage.getShareImageBuffer(
      page.network.id,
      page.member.id,
      imageId,
      { companyName: page.member.companyName, brand: page.brand },
    );
    res.setHeader('Content-Type', img.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(img.buffer);
  } catch (err) {
    console.error('[review-page] og image failed:', err.message);
    return res.status(500).end();
  }
}

router.get('/rv/:slug/og.jpg', (req, res) => serveShareImage(req, res, 'default'));
router.get('/rv/:slug/og.png', (req, res) => serveShareImage(req, res, 'default'));
router.get('/rv/:slug/og/:imageId.jpg', (req, res) => serveShareImage(req, res, req.params.imageId));
router.get('/rv/:slug/og/:imageId.png', (req, res) => serveShareImage(req, res, req.params.imageId));

router.get('/rv/:slug/qr.png', async (req, res) => {
  try {
    const page = await loadPage(req.params.slug);
    if (!page) return res.status(404).end();
    const shareId = reviewShareImage.isImageId(req.query.i) ? String(req.query.i).trim() : '';
    const url = notify.reviewPageLink(page.slug, shareId ? { imageId: shareId } : undefined);
    const png = await QRCode.toBuffer(url, { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${page.slug}-review-qr.png"`);
    return res.end(png);
  } catch (err) {
    console.error('[review-page] qr failed:', err.message);
    return res.status(500).end();
  }
});

router.get('/rv/:slug/go/:platform/:index?', async (req, res) => {
  try {
    const page = await loadPage(req.params.slug);
    if (!page) return notFound(res);
    const platform = String(req.params.platform || '');
    const url = reviewPage.destinationFor(page.member.reviewLinks, platform, req.params.index);
    if (!url) return res.redirect(302, `/rv/${page.slug}`);
    await store.bumpReviewStats(page.network.id, page.member.id, { click: platform }).catch(() => {});
    return res.redirect(302, url);
  } catch (err) {
    console.error('[review-page] go failed:', err.message);
    return res.redirect(302, `/rv/${encodeURIComponent(req.params.slug)}`);
  }
});

router.get('/rv/:slug', async (req, res) => {
  try {
    const page = await loadPage(req.params.slug);
    if (!page) return notFound(res);
    const rating = reviewPage.parseRating(req.query.r);
    const imageId = String(req.query.i || '').trim();
    await store.bumpReviewStats(page.network.id, page.member.id, rating ? { star: rating } : { view: true }).catch(() => {});
    return renderPage(res, page, { rating, imageId });
  } catch (err) {
    console.error('[review-page] view failed:', err.message);
    return notFound(res);
  }
});

router.post('/rv/:slug/feedback', form, async (req, res) => {
  try {
    const page = await loadPage(req.params.slug);
    if (!page) return notFound(res);
    const body = req.body || {};
    const rating = reviewPage.parseRating(body.rating);
    if (String(body.website || '').trim()) return renderPage(res, page, { rating, thanks: true });
    const message = String(body.message || '').trim();
    if (!message) {
      return renderPage(res, page, { rating, error: 'Tell us what happened so we can make it right.', formValues: body }, 400);
    }
    if (!feedbackAllowed(String(req.ip || req.socket.remoteAddress || 'unknown'))) {
      return renderPage(res, page, { rating, error: 'Too many messages from this device. Please try again later.', formValues: body }, 429);
    }
    const feedback = await store.saveFeedback(page.network.id, {
      memberId: page.member.id,
      rating,
      name: body.name,
      phone: body.phone,
      email: body.email,
      message,
    });
    await notify.notifyFeedback({ network: page.network, member: page.member, feedback }).catch((err) => {
      console.warn('[review-page] feedback notify failed:', err.message);
    });
    return renderPage(res, page, { rating, thanks: true });
  } catch (err) {
    console.error('[review-page] feedback failed:', err.message);
    return notFound(res);
  }
});

module.exports = router;
