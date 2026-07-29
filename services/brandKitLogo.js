/**
 * Persist Marketing Studio brand logos in workspace storage (survives Render redeploys).
 */

const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const BRAND_KIT_LOGO_PATH = '/direct-mail/api/brand-kit/logo';

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

function normalizeStoredLogo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base64 = String(raw.base64 || '').trim();
  if (!base64) return null;
  return {
    mimeType: String(raw.mimeType || 'image/png').trim() || 'image/png',
    base64,
    updatedAt: String(raw.updatedAt || '').trim(),
  };
}

function hasStoredLogo(ws) {
  return Boolean(normalizeStoredLogo(ws && ws.brandKitLogo));
}

function logoDisplayUrl(updatedAt) {
  const ts = updatedAt ? encodeURIComponent(String(updatedAt)) : String(Date.now());
  return `${BRAND_KIT_LOGO_PATH}?v=${ts}`;
}

function isLegacyDiskLogoUrl(logoUrl) {
  return String(logoUrl || '').trim().startsWith('/uploads/brand-kit/');
}

async function readLegacyLogoFile(logoUrl) {
  const url = String(logoUrl || '').trim();
  if (!isLegacyDiskLogoUrl(url)) return null;
  try {
    const absPath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    const buffer = await fs.readFile(absPath);
    return { buffer, mimeType: mimeFromExt(path.extname(url)) };
  } catch {
    return null;
  }
}

/**
 * @param {object|null|undefined} ws
 * @returns {Promise<{ buffer: Buffer, mimeType: string }|null>}
 */
async function loadLogoBuffer(ws) {
  const stored = normalizeStoredLogo(ws && ws.brandKitLogo);
  if (stored) {
    return {
      buffer: Buffer.from(stored.base64, 'base64'),
      mimeType: stored.mimeType,
    };
  }
  return readLegacyLogoFile(ws && ws.brandKit && ws.brandKit.logoUrl);
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {{ brandKitLogo: object, brandKitPatch: object }}
 */
function buildLogoWorkspacePatch(existingBrandKit, { buffer, mimeType }) {
  if (!buffer || !buffer.length) throw new Error('Logo buffer is empty.');
  const updatedAt = new Date().toISOString();
  const brandKitLogo = {
    mimeType: String(mimeType || 'image/png').trim() || 'image/png',
    base64: buffer.toString('base64'),
    updatedAt,
  };
  const prev = existingBrandKit && typeof existingBrandKit === 'object' ? existingBrandKit : {};
  const brandKitPatch = {
    ...prev,
    logoUrl: logoDisplayUrl(updatedAt),
    updatedAt,
  };
  return { brandKitLogo, brandKitPatch };
}

/**
 * Migrate legacy on-disk logo into workspace when file still exists.
 * @returns {Promise<object>} workspace (possibly mutated)
 */
async function migrateLegacyLogoIfNeeded(ws) {
  if (!ws || hasStoredLogo(ws)) return ws;
  const legacy = await readLegacyLogoFile(ws.brandKit && ws.brandKit.logoUrl);
  if (!legacy) return ws;
  const { brandKitLogo, brandKitPatch } = buildLogoWorkspacePatch(ws.brandKit, legacy);
  return {
    ...ws,
    brandKitLogo,
    brandKit: brandKitPatch,
  };
}

/**
 * Write workspace logo to a publicly fetchable path for external image APIs (e.g. KIE).
 * @returns {Promise<{ relativePath: string, buffer: Buffer, mimeType: string }|null>}
 */
async function publishLogoPublicFile(req, ws) {
  const logoData = await loadLogoBuffer(ws);
  if (!logoData || !logoData.buffer || !logoData.buffer.length) return null;

  let buffer = logoData.buffer;
  let ext = '.png';
  let mimeType = 'image/png';
  if (/svg/i.test(String(logoData.mimeType || ''))) {
    buffer = await sharp(buffer).png().toBuffer();
  } else if (/jpe?g/i.test(String(logoData.mimeType || ''))) {
    ext = '.jpg';
    mimeType = 'image/jpeg';
    buffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
  } else {
    buffer = await sharp(buffer).png().toBuffer();
  }

  const wid = String((req && req.workspaceId) || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const relDir = path.join('public', 'uploads', 'brand-kit');
  const absDir = path.join(process.cwd(), relDir);
  await fs.mkdir(absDir, { recursive: true });
  const filename = `${wid}_logo_ref_${Date.now()}${ext}`;
  const absPath = path.join(absDir, filename);
  await fs.writeFile(absPath, buffer);
  return { relativePath: `/uploads/brand-kit/${filename}`, buffer, mimeType };
}

module.exports = {
  BRAND_KIT_LOGO_PATH,
  mimeFromExt,
  normalizeStoredLogo,
  hasStoredLogo,
  logoDisplayUrl,
  isLegacyDiskLogoUrl,
  readLegacyLogoFile,
  loadLogoBuffer,
  buildLogoWorkspacePatch,
  migrateLegacyLogoIfNeeded,
  publishLogoPublicFile,
};
