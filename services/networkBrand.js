/**
 * White-label brand for a referral network's member app: name, tagline,
 * accent color, logo / hero images and the headline stat on Home.
 */

const DEFAULT_ACCENT = '#F26B1D';
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

/** Everything a member-facing template needs, with sensible fallbacks. */
function brandView(network) {
  const net = network && typeof network === 'object' ? network : {};
  const brand = normalizeBrand(net.brand);
  const appName = brand.appName || cleanText(net.name, 60) || 'Partner network';
  return {
    appName,
    shortName: appName.length <= 12 ? appName : appName.split(/\s+/)[0].slice(0, 12),
    tagline: brand.tagline || 'Every review builds your reputation.',
    subtitle: brand.subtitle || 'Reviews, customers & network',
    accent: brand.accent,
    onAccent: onAccentColor(brand.accent),
    logoUrl: brand.logoUrl,
    heroUrl: brand.heroUrl,
    statValue: brand.statValue,
    statValueLabel: formatStat(brand.statValue),
    statLabel: brand.statLabel,
    statSuffix: brand.statSuffix,
    initials: initials(appName),
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Square app icon: the uploaded logo on the accent color, or initials when there is no logo. */
async function renderIcon({ brand, logo, size }) {
  const sharp = require('sharp');
  const px = Math.max(48, Math.min(1024, parseInt(size, 10) || 192));
  const accent = brand.accent || DEFAULT_ACCENT;
  if (logo && logo.buffer) {
    const inner = Math.round(px * 0.72);
    const fitted = await sharp(logo.buffer)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return sharp({ create: { width: px, height: px, channels: 4, background: '#ffffff' } })
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
  IMAGE_KINDS,
  normalizeBrand,
  normalizeHex,
  normalizeImageUrl,
  onAccentColor,
  brandView,
  renderIcon,
  prepareImage,
  initials,
};
