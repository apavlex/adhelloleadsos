/**
 * Open Graph / iMessage link-preview image for the Reviews app signup pages
 * (/app, /app/flooring, /join/:slug).
 *
 * Uses a clean crop of the stock service-van hero (no “Your business image.”
 * placeholder, no text overlay). Link title/description come from page meta.
 */
const fs = require('fs');
const path = require('path');

const STOCK_HERO_PATH = path.join(__dirname, '..', 'public', 'images', 'member-hero-your-business.jpg');
const FONT_BOLD_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Bold.ttf');
const FONT_REGULAR_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'LiberationSans-Regular.ttf');
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/** Bump when the art changes so Apple/iMessage refetch the unfurl. */
const OG_VERSION = 'reviews-referrals-v4';

/**
 * Source crop of member-hero-your-business.jpg that keeps the cab / ladders
 * and excludes the yellow “Your business image.” decal on the side panel.
 * Coordinates are relative to the 1400×900 stock file.
 */
const CLEAN_HERO_EXTRACT = { left: 0, top: 80, width: 700, height: 700 };

const cache = new Map();

/**
 * Sales-style naming for signup meta / tests (not drawn on the image).
 * @param {string} [offer]
 */
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
  let buffer;
  if (fs.existsSync(STOCK_HERO_PATH)) {
    buffer = await sharp(fs.readFileSync(STOCK_HERO_PATH))
      .rotate()
      .extract(CLEAN_HERO_EXTRACT)
      .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 84, progressive: false, mozjpeg: false })
      .toBuffer();
  } else {
    buffer = await sharp({
      create: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        channels: 3,
        background: { r: 15, g: 23, b: 42 },
      },
    })
      .jpeg({ quality: 84, progressive: false, mozjpeg: false })
      .toBuffer();
  }

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
  CLEAN_HERO_EXTRACT,
  STOCK_HERO_PATH,
  renderFreeAppOgImage,
  ogImagePath,
  ogImageAbsoluteUrl,
  copyForOffer,
  _resetCacheForTests() {
    cache.clear();
  },
};
