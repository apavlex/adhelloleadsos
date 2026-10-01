/**
 * Per-workspace white label: app name + logo used for the sidebar, browser tab,
 * and the "Add to Home Screen" icon. Logos live in KV as base64 PNG.
 */
const dbService = require('./database');
const networkBrand = require('./networkBrand');

const DEFAULT_NAME = 'AdHello';
const DEFAULT_ICON = '/images/adhello-app-icon.png';
const ICON_SIZES = [180, 192, 512];

function logoKey(workspaceId) {
  return `wslogo:${workspaceId}`;
}

function cleanAppName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 30);
}

function settings(ws) {
  const raw = ws && ws.whiteLabel && typeof ws.whiteLabel === 'object' ? ws.whiteLabel : {};
  return {
    appName: cleanAppName(raw.appName),
    logoVersion: String(raw.logoVersion || ''),
  };
}

/** What templates need: name, logo URL, icon + manifest URLs. Falls back to AdHello. */
function brandForWorkspace(ws) {
  const id = ws && ws.id ? String(ws.id) : '';
  const s = settings(ws);
  const appName = s.appName || DEFAULT_NAME;
  const hasLogo = !!(id && s.logoVersion);
  const base = id ? `/brand/ws/${encodeURIComponent(id)}` : '';
  const v = encodeURIComponent(s.logoVersion || 'default');
  const custom = hasLogo || !!s.appName;
  return {
    appName,
    shortName: appName.length <= 15 ? appName : appName.split(/\s+/)[0].slice(0, 15),
    customName: s.appName,
    hasLogo,
    custom,
    logoUrl: hasLogo ? `${base}/logo.png?v=${v}` : DEFAULT_ICON,
    iconUrl: (size) => (hasLogo ? `${base}/icon-${size}.png?v=${v}` : `/images/adhello-app-icon-${size === 180 ? 192 : size}.png`),
    manifestUrl: custom ? `${base}/manifest.webmanifest?v=${v}` : '/manifest.webmanifest',
  };
}

async function getLogo(workspaceId) {
  const row = await dbService.peekStorageKey(logoKey(workspaceId));
  const data = row && (typeof row === 'string' ? JSON.parse(row) : row);
  if (!data || !data.data) return null;
  return { contentType: String(data.contentType || 'image/png'), buffer: Buffer.from(String(data.data), 'base64') };
}

async function saveLogo(workspaceId, buffer) {
  const prepared = await networkBrand.prepareImage('logo', buffer);
  await dbService.putStorageKey(logoKey(workspaceId), {
    contentType: prepared.contentType,
    data: prepared.buffer.toString('base64'),
    updatedAt: new Date().toISOString(),
  });
  return String(Date.now());
}

async function deleteLogo(workspaceId) {
  await dbService.deleteStorageKey(logoKey(workspaceId));
}

async function renderIcon(ws, size) {
  const px = ICON_SIZES.includes(size) ? size : 192;
  const logo = ws && ws.id ? await getLogo(ws.id) : null;
  const appName = brandForWorkspace(ws).appName;
  return networkBrand.renderIcon({
    brand: { accent: ws && ws.accentColor ? ws.accentColor : networkBrand.DEFAULT_ACCENT, initials: initials(appName) },
    logo,
    size: px,
  });
}

function initials(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : String(name || 'A').slice(0, 2)).toUpperCase();
}

function manifest(ws) {
  const brand = brandForWorkspace(ws);
  return {
    name: brand.appName,
    short_name: brand.shortName,
    description: `${brand.appName} — leads, pipeline and outreach`,
    id: '/today',
    start_url: '/today?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FAF7ED',
    theme_color: ws && ws.accentColor ? ws.accentColor : '#FFDB3A',
    icons: [
      { src: brand.iconUrl(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: brand.iconUrl(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: brand.iconUrl(512), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

module.exports = {
  DEFAULT_NAME,
  ICON_SIZES,
  cleanAppName,
  settings,
  brandForWorkspace,
  getLogo,
  saveLogo,
  deleteLogo,
  renderIcon,
  manifest,
};
