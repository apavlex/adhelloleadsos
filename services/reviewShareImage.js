/**
 * Open Graph / link-preview images for public review pages (/rv/:slug).
 * Members can set a default share photo, or upload a one-off image per request.
 * If none is uploaded, we reuse the Home banner (personal hero → network hero →
 * stock van) so SMS / iMessage previews match what members see in the app.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./networkStore');
const networkBrand = require('./networkBrand');
const { getReviewPublicBaseUrl } = require('../lib/publicBaseUrl');

const STOCK_HERO_PATH = path.join(__dirname, '..', 'public', 'images', 'member-hero-your-business.jpg');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const IMAGE_ID_RE = /^[a-z0-9]{8,24}$/i;

function newImageId() {
  return crypto.randomBytes(8).toString('hex');
}

function isImageId(value) {
  return IMAGE_ID_RE.test(String(value || '').trim());
}

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/** Resize an upload to OG-friendly 1200×630 JPEG. */
async function prepareShareImage(buffer) {
  if (!buffer || !buffer.length) throw new Error('Image is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Image is too large (max 6 MB).');
  const sharp = require('sharp');
  // Baseline (non-progressive) JPEG — iMessage Link Presentation often skips progressive/mozjpeg.
  const out = await sharp(buffer)
    .rotate()
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 82, progressive: false, mozjpeg: false })
    .toBuffer();
  return { contentType: 'image/jpeg', buffer: out };
}

/** Branded fallback when the member has not uploaded a share photo. */
async function renderDefaultShareImage({ companyName, brand }) {
  const sharp = require('sharp');
  const accent = (brand && brand.accent) || networkBrand.DEFAULT_ACCENT;
  const onAccent = networkBrand.onAccentColor(accent);
  const company = String(companyName || 'Leave a review').trim().slice(0, 48) || 'Leave a review';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(accent)}"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="1080" cy="90" r="180" fill="rgba(255,255,255,0.08)"/>
  <circle cx="80" cy="560" r="220" fill="rgba(255,255,255,0.06)"/>
  <text x="80" y="250" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="rgba(255,255,255,0.75)">Leave a review</text>
  <text x="80" y="340" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="${escapeXml(onAccent)}">${escapeXml(company)}</text>
  <text x="80" y="540" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="rgba(255,255,255,0.85)">AdHello.io</text>
</svg>`;
  const out = await sharp(Buffer.from(svg)).jpeg({ quality: 85, progressive: false, mozjpeg: false }).toBuffer();
  return { contentType: 'image/jpeg', buffer: out };
}

async function saveDefaultShareImage(networkId, memberId, prepared) {
  await store.saveReviewShareImage(networkId, memberId, 'default', prepared);
  return 'default';
}

async function saveRequestShareImage(networkId, memberId, prepared) {
  const id = newImageId();
  await store.saveReviewShareImage(networkId, memberId, id, prepared);
  return id;
}

async function deleteDefaultShareImage(networkId, memberId) {
  await store.deleteReviewShareImage(networkId, memberId, 'default');
}

/**
 * Prefer real photos over the synthetic gradient so SMS link previews show the
 * same van / personal banner as Home.
 */
async function heroShareImageFallback(networkId, memberId) {
  const tryPrepare = async (buffer) => {
    if (!buffer || !buffer.length) return null;
    try {
      return await prepareShareImage(buffer);
    } catch (_) {
      return null;
    }
  };

  const memberHero = await store.getMemberHero(networkId, memberId).catch(() => null);
  const fromMember = await tryPrepare(memberHero && memberHero.buffer);
  if (fromMember) return fromMember;

  const brandHero = await store.getBrandImage(networkId, 'hero').catch(() => null);
  const fromBrand = await tryPrepare(brandHero && brandHero.buffer);
  if (fromBrand) return fromBrand;

  try {
    if (fs.existsSync(STOCK_HERO_PATH)) {
      const fromStock = await tryPrepare(fs.readFileSync(STOCK_HERO_PATH));
      if (fromStock) return fromStock;
    }
  } catch (_) { /* fall through to gradient */ }
  return null;
}

async function getShareImageBuffer(networkId, memberId, imageId, { companyName, brand } = {}) {
  const id = String(imageId || 'default').trim() || 'default';
  if (id !== 'default' && !isImageId(id)) {
    return (await heroShareImageFallback(networkId, memberId))
      || renderDefaultShareImage({ companyName, brand });
  }
  const stored = await store.getReviewShareImage(networkId, memberId, id);
  if (stored && stored.buffer) return stored;
  if (id !== 'default') {
    const fallback = await store.getReviewShareImage(networkId, memberId, 'default');
    if (fallback && fallback.buffer) return fallback;
  }
  const fromHero = await heroShareImageFallback(networkId, memberId);
  if (fromHero) return fromHero;
  return renderDefaultShareImage({ companyName, brand });
}

function shareImagePath(slug, imageId) {
  const s = encodeURIComponent(String(slug || '').trim());
  const id = String(imageId || '').trim();
  if (id && id !== 'default' && isImageId(id)) return `/rv/${s}/og/${encodeURIComponent(id)}.jpg`;
  return `/rv/${s}/og.jpg`;
}

/** Cache-bust so iMessage refreshes when the Home banner or share photo changes. */
function shareImageVersion(member, brand) {
  const stamps = [
    'og-baseline-v1', // bump when OG encoding changes so Apple/iMessage refetch
    member && member.reviewShareImageUpdatedAt,
    member && member.heroUpdatedAt,
    brand && brand.heroUrl,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (!stamps.length) return '';
  return crypto.createHash('sha1').update(stamps.join('|')).digest('hex').slice(0, 12);
}

function shareImageAbsoluteUrl(slug, imageId, version) {
  const base = `${getReviewPublicBaseUrl()}${shareImagePath(slug, imageId)}`;
  const v = String(version || '').trim();
  return v ? `${base}?v=${encodeURIComponent(v)}` : base;
}

function hasCustomDefault(member) {
  return !!(member && member.reviewShareImageUpdatedAt);
}

/** Square logo for the public /rv request page (PNG, max 512px). */
async function prepareReviewLogo(buffer) {
  if (!buffer || !buffer.length) throw new Error('Image is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Image is too large (max 6 MB).');
  return networkBrand.prepareImage('logo', buffer);
}

async function saveReviewLogo(networkId, memberId, prepared) {
  return store.saveReviewLogo(networkId, memberId, prepared);
}

async function deleteReviewLogo(networkId, memberId) {
  await store.deleteReviewLogo(networkId, memberId);
}

async function getReviewLogoBuffer(networkId, memberId) {
  return store.getReviewLogo(networkId, memberId);
}

function reviewLogoPath(slug, updatedAt) {
  const s = encodeURIComponent(String(slug || '').trim());
  const v = encodeURIComponent(String(updatedAt || '').trim() || '1');
  return `/rv/${s}/logo.png?v=${v}`;
}

function profileAvatarPath(slug, updatedAt) {
  const s = encodeURIComponent(String(slug || '').trim());
  const v = encodeURIComponent(String(updatedAt || '').trim() || '1');
  return `/rv/${s}/avatar.png?v=${v}`;
}

function hasCustomLogo(member) {
  return !!(member && member.reviewLogoUpdatedAt);
}

function hasProfilePhoto(member) {
  return !!(member && member.profilePhotoUpdatedAt);
}

/**
 * Same photo as the member-app top bar / Profile when set.
 * Fallback: custom request-page logo → network brand logo → empty (initials).
 */
function requestPageLogoUrl(member, brand) {
  if (hasProfilePhoto(member) && member.reviewSlug) {
    return profileAvatarPath(member.reviewSlug, member.profilePhotoUpdatedAt);
  }
  if (hasCustomLogo(member) && member.reviewSlug) {
    return reviewLogoPath(member.reviewSlug, member.reviewLogoUpdatedAt);
  }
  return (brand && brand.logoUrl) || '';
}

module.exports = {
  OG_WIDTH,
  OG_HEIGHT,
  MAX_UPLOAD_BYTES,
  newImageId,
  isImageId,
  prepareShareImage,
  renderDefaultShareImage,
  heroShareImageFallback,
  saveDefaultShareImage,
  saveRequestShareImage,
  deleteDefaultShareImage,
  getShareImageBuffer,
  shareImagePath,
  shareImageVersion,
  shareImageAbsoluteUrl,
  hasCustomDefault,
  prepareReviewLogo,
  saveReviewLogo,
  deleteReviewLogo,
  getReviewLogoBuffer,
  reviewLogoPath,
  profileAvatarPath,
  hasCustomLogo,
  hasProfilePhoto,
  requestPageLogoUrl,
};
