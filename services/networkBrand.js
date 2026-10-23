/**
 * White-label brand for a referral network's member app: name, tagline,
 * accent color, logo / hero images and the headline stat on Home.
 */

/** AdHello brand yellow — default member-app accent (not orange). */
const DEFAULT_ACCENT = '#FFDB3A';
/** Product name for the free Reviews App (never “Adhello Agency network”). */
const FREE_APP_NAME = 'AdHello Reviews App';
/** Default Home banner until the business uploads their own van/photo. */
const FREE_APP_HERO_URL = '/images/member-hero-your-business.jpg';
const DEFAULT_HERO_URL = FREE_APP_HERO_URL;
/** Home greeting subtitle under “Hi, …”. */
const DEFAULT_TAGLINE = 'The quick and easy reviews & referrals engine';
/** Older defaults we quietly retire so live networks pick up the new Home line. */
const LEGACY_TAGLINES = new Set([
  'Trusted local pros who send each other work',
  'The quick and easy review and referrals engine for your business',
]);
const IMAGE_KINDS = new Set(['logo', 'hero']);

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeHex(value) {
  const raw = String(value == null ? '' : value).trim();
  const m = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

/** Site-relative paths or https URLs only, so a brand field can't inject script URLs. */
function normalizeImageUrl(value) {
  const raw = String(value == null ? '' : value).trim().slice(0, 600);
  if (!raw) return '';
  if (/^\/(?!\/)[^\s"'<>]*$/.test(raw)) return raw;
  if (/^https:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  return '';
}

function normalizeStatValue(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : '';
}

function normalizeBrand(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    appName: cleanText(b.appName, 60),
    tagline: cleanText(b.tagline, 120),
    accent: normalizeHex(b.accent) || DEFAULT_ACCENT,
    logoUrl: normalizeImageUrl(b.logoUrl),
    heroUrl: normalizeImageUrl(b.heroUrl),
    statValue: normalizeStatValue(b.statValue),
    statLabel: cleanText(b.statLabel, 40),
    statSuffix: cleanText(b.statSuffix, 30),
    subtitle: cleanText(b.subtitle, 80),
  };
}

function relativeLuminance(hex) {
  const h = normalizeHex(hex) || DEFAULT_ACCENT;
  const channel = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Text color on the accent: white whenever it reaches 2.9:1 (accent text is
 * always bold, and brand oranges/reds look wrong with dark text), otherwise dark.
 */
function onAccentColor(hex) {
  const lum = relativeLuminance(hex);
  return 1.05 / (lum + 0.05) >= 2.9 ? '#ffffff' : '#0f172a';
}

function initials(name) {
  const words = cleanText(name, 80).split(/\s+/).filter(Boolean);
  if (!words.length) return 'R';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

function formatStat(value) {
  if (value === '' || value == null) return '';
  return Number(value).toLocaleString('en-US');
}

/**
 * Everything a member-facing template needs, with sensible fallbacks.
 * Free-app members (`plan: app_free`) get AdHello yellow, their signup company
 * name (else “AdHello Reviews App”), and a “Your business image” hero until
 * they upload their own — never the host agency network name.
 *
 * @param {object} network
 * @param {object} [member]
 * @param {{ heroUrl?: string, freeApp?: boolean }} [opts]
 *   heroUrl — member-scoped hero path; freeApp — force free-app product brand
 *   (signup / login) without a member row.
 */
function brandView(network, member, opts = {}) {
  const net = network && typeof network === 'object' ? network : {};
  const brand = normalizeBrand(net.brand);
  const plan = member ? String(member.plan || '') : '';
  const free = !!(opts.freeApp || plan === 'app_free' || plan === 'app_flooring');
  const companyName = free && member ? cleanText(member.companyName, 60) : '';
  // Free app never inherits the host agency network name — product is Reviews App.
  // Signup company stays on the hero subtitle so members still see their business.
  const appName = free
    ? FREE_APP_NAME
    : (brand.appName || cleanText(net.name, 60) || 'Partner network');
  // Home hero prefers the signup company; chrome / install use Reviews App.
  const heroName = free ? (companyName || FREE_APP_NAME) : appName;
  const accent = free ? DEFAULT_ACCENT : brand.accent;
  // Always show a photo banner — never a bare gradient — until they upload their own.
  let heroUrl = free
    ? normalizeImageUrl(opts.heroUrl) || DEFAULT_HERO_URL
    : normalizeImageUrl(brand.heroUrl) || normalizeImageUrl(opts.heroUrl) || DEFAULT_HERO_URL;
  const freeSubtitle = companyName
    ? `${companyName} · Reviews, customers & network`
    : 'Reviews, customers & network';
  return {
    appName,
    /** Home hero card title. */
    heroName: heroName || appName,
    companyName,
    shortName: appName.length <= 12 ? appName : appName.split(/\s+/)[0].slice(0, 12),
    tagline: (!brand.tagline || LEGACY_TAGLINES.has(brand.tagline))
      ? DEFAULT_TAGLINE
      : brand.tagline,
    subtitle: free ? freeSubtitle : (brand.subtitle || 'Reviews, customers & network'),
    accent,
    onAccent: onAccentColor(accent),
    logoUrl: free ? '' : brand.logoUrl,
    heroUrl,
    statValue: free ? '' : brand.statValue,
    statValueLabel: free ? '' : formatStat(brand.statValue),
    statLabel: free ? '' : brand.statLabel,
    statSuffix: free ? '' : brand.statSuffix,
    initials: initials(heroName || appName),
    isFreeApp: !!free,
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/**
 * True when a logo is too wide or too tall to fill a square icon without
 * letterboxing — those get the accent tile. Near-square marks go edge-to-edge.
 * @param {number} width
 * @param {number} height
 */
function logoNeedsAccentTile(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0 && h > 0)) return true;
  const ratio = w / h;
  // ~±20% of square. Wider wordmarks / tall marks sit on the accent bg.
  return ratio > 1.2 || ratio < 1 / 1.2;
}

/**
 * Square app / Home Screen icon.
 * - photo mode: cover-crop the image to fill the icon (profile photos)
 * - logo mode: edge-to-edge for near-square marks; accent tile only when
 *   the logo is too wide or tall to fill the square cleanly
 * - fallback: initials on the accent color
 */
async function renderIcon({ brand, logo, size, mode }) {
  const sharp = require('sharp');
  const px = Math.max(48, Math.min(1024, parseInt(size, 10) || 192));
  const accent = normalizeHex(brand.accent) || DEFAULT_ACCENT;
  if (logo && logo.buffer) {
    if (mode === 'photo') {
      return sharp(logo.buffer)
        .rotate()
        .resize(px, px, { fit: 'cover', position: 'attention' })
        .png()
        .toBuffer();
    }
    const meta = await sharp(logo.buffer).rotate().metadata();
    if (!logoNeedsAccentTile(meta.width, meta.height)) {
      // Square-ish logo: fill the icon edge to edge (no accent gutter).
      return sharp(logo.buffer)
        .rotate()
        .resize(px, px, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
    }
    // Wide or tall: contain on the accent tile so pale marks stay readable.
    const inner = Math.round(px * 0.82);
    const fitted = await sharp(logo.buffer)
      .rotate()
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return sharp({ create: { width: px, height: px, channels: 4, background: accent } })
      .composite([{ input: fitted, gravity: 'center' }])
      .png()
      .toBuffer();
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">`
    + `<rect width="100" height="100" fill="${escapeXml(accent)}"/>`
    + `<text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="40" fill="${escapeXml(onAccentColor(accent))}">${escapeXml(brand.initials || 'R')}</text>`
    + '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Resize an upload for storage: logos up to 512px PNG, hero photos 1400px-wide JPEG. */
async function prepareImage(kind, buffer) {
  if (!IMAGE_KINDS.has(kind)) throw new Error('Unknown image kind.');
  const sharp = require('sharp');
  if (kind === 'logo') {
    const out = await sharp(buffer).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { contentType: 'image/png', buffer: out };
  }
  const out = await sharp(buffer).rotate().resize(1400, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  return { contentType: 'image/jpeg', buffer: out };
}

module.exports = {
  DEFAULT_ACCENT,
  DEFAULT_TAGLINE,
  FREE_APP_NAME,
  FREE_APP_HERO_URL,
  DEFAULT_HERO_URL,
  IMAGE_KINDS,
  normalizeBrand,
  normalizeHex,
  normalizeImageUrl,
  onAccentColor,
  brandView,
  logoNeedsAccentTile,
  renderIcon,
  prepareImage,
  initials,
};
