/**
 * Open Graph / iMessage link-preview image for the Reviews app signup pages
 * (/app, /app/flooring, /join/:slug).
 *
 * Uses the stock “Your business” van hero with a reviews + referrals overlay so
 * shared links show a real photo, not a yellow text card.
 *
 * Fonts are vendored under assets/fonts and embedded as base64 — production
 * Docker (node:20-slim) has no Helvetica/Arial, which made overlay text tofu.
 */
const fs = require('fs');
const path = require('path');

const STOCK_HERO_PATH = path.join(__dirname, '..', 'public', 'images', 'member-hero-your-business.jpg');
const FONT_BOLD_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Bold.ttf');
const FONT_REGULAR_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf');
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/** Bump when the art changes so Apple/iMessage refetch the unfurl. */
const OG_VERSION = 'reviews-referrals-v3';

const cache = new Map();
let fontFaceCss = null;

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

function loadFontFaceCss() {
  if (fontFaceCss != null) return fontFaceCss;
  const parts = [];
  if (fs.existsSync(FONT_BOLD_PATH)) {
    const b64 = fs.readFileSync(FONT_BOLD_PATH).toString('base64');
    parts.push(`@font-face{font-family:'OgSans';font-weight:700;font-style:normal;src:url('data:font/ttf;base64,${b64}') format('truetype');}`);
  }
  if (fs.existsSync(FONT_REGULAR_PATH)) {
    const b64 = fs.readFileSync(FONT_REGULAR_PATH).toString('base64');
    parts.push(`@font-face{font-family:'OgSans';font-weight:400;font-style:normal;src:url('data:font/ttf;base64,${b64}') format('truetype');}`);
  }
  fontFaceCss = parts.join('');
  return fontFaceCss;
}

function copyForOffer(offer) {
  const flooring = String(offer || '').toLowerCase() === 'flooring';
  if (flooring) {
    return {
      badge: 'GET MORE',
      title: 'Get more reviews',
      titleLine2: '& referrals app',
      subtitle: 'Collect Google reviews. Share referrals. Quote materials on your phone.',
    };
  }
  return {
    badge: 'GET MORE',
    title: 'Get more reviews',
    titleLine2: '& referrals app',
    // ASCII hyphen — avoids missing-glyph tofu if a font subset lacks em dash.
    subtitle: 'Collect Google reviews. Grow through referrals - on your phone.',
  };
}

/**
 * @param {{ offer?: string }} [opts]
 * @returns {Promise<{ contentType: string, buffer: Buffer, version: string }>}
 */
async function renderFreeAppOgImage(opts = {}) {
  const offer = String(opts.offer || '').toLowerCase() === 'flooring' ? 'flooring' : '';
  const cacheKey = offer || 'default';
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const sharp = require('sharp');
  const { badge, title, titleLine2, subtitle } = copyForOffer(offer);
  let base;
  if (fs.existsSync(STOCK_HERO_PATH)) {
    base = await sharp(fs.readFileSync(STOCK_HERO_PATH))
      .rotate()
      .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 82, progressive: false, mozjpeg: false })
      .toBuffer();
  } else {
    base = await sharp({
      create: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        channels: 3,
        background: { r: 15, g: 23, b: 42 },
      },
    })
      .jpeg({ quality: 82, progressive: false, mozjpeg: false })
      .toBuffer();
  }

  const faces = loadFontFaceCss();
  const fontStack = faces ? "'OgSans', 'DejaVu Sans', 'Liberation Sans', sans-serif" : "'DejaVu Sans', 'Liberation Sans', sans-serif";

  const overlay = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(15,23,42,0.25)"/>
      <stop offset="45%" stop-color="rgba(15,23,42,0.55)"/>
      <stop offset="100%" stop-color="rgba(15,23,42,0.88)"/>
    </linearGradient>
    <style type="text/css"><![CDATA[
      ${faces}
      .og-text { font-family: ${fontStack}; }
    ]]></style>
  </defs>
  <rect width="100%" height="100%" fill="url(#scrim)"/>
  <rect x="64" y="72" width="180" height="44" rx="22" fill="#facc15"/>
  <text class="og-text" x="154" y="101" text-anchor="middle" font-size="20" font-weight="700" fill="#1f242e">${escapeXml(badge)}</text>
  <text class="og-text" x="64" y="250" font-size="64" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>
  <text class="og-text" x="64" y="330" font-size="64" font-weight="700" fill="#ffffff">${escapeXml(titleLine2)}</text>
  <text class="og-text" x="64" y="410" font-size="28" font-weight="400" fill="rgba(255,255,255,0.9)">${escapeXml(subtitle)}</text>
  <text class="og-text" x="64" y="560" font-size="26" font-weight="700" fill="#facc15">reviews.adhello.io</text>
</svg>`;

  const buffer = await sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 84, progressive: false, mozjpeg: false })
    .toBuffer();

  const pack = { contentType: 'image/jpeg', buffer, version: OG_VERSION };
  cache.set(cacheKey, pack);
  return pack;
}

function ogImagePath(offer) {
  const flooring = String(offer || '').toLowerCase() === 'flooring';
  return flooring ? `/app/flooring/og.jpg?v=${OG_VERSION}` : `/app/og.jpg?v=${OG_VERSION}`;
}

function ogImageAbsoluteUrl(baseUrl, offer) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  return `${root}${ogImagePath(offer)}`;
}

module.exports = {
  OG_WIDTH,
  OG_HEIGHT,
  OG_VERSION,
  FONT_BOLD_PATH,
  FONT_REGULAR_PATH,
  renderFreeAppOgImage,
  ogImagePath,
  ogImageAbsoluteUrl,
  copyForOffer,
  _resetCacheForTests() {
    cache.clear();
    fontFaceCss = null;
  },
};
