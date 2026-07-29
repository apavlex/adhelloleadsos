/**
 * Overlay brand logos onto generated marketing images without AI distortion.
 */

const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const DEFAULT_MAX_LOGO_WIDTH_RATIO = 0.18;
const DEFAULT_PADDING = 24;

async function fetchImageBuffer(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid image URL is required.');
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Could not fetch image (${res.status}).`);
  }
  const ab = await res.arrayBuffer();
  if (!ab || !ab.byteLength) throw new Error('Image download was empty.');
  return Buffer.from(ab);
}

function compositePosition(baseW, baseH, logoW, logoH, padding, position) {
  const pos = String(position || 'top-left').toLowerCase();
  if (pos === 'top-right') {
    return { left: Math.max(0, baseW - logoW - padding), top: padding };
  }
  if (pos === 'bottom-left') {
    return { left: padding, top: Math.max(0, baseH - logoH - padding) };
  }
  if (pos === 'bottom-right') {
    return {
      left: Math.max(0, baseW - logoW - padding),
      top: Math.max(0, baseH - logoH - padding),
    };
  }
  return { left: padding, top: padding };
}

async function compositeLogoOnImageBuffer(baseBuffer, logoBuffer, opts = {}) {
  const maxWidthRatio = Number(opts.maxWidthRatio) || DEFAULT_MAX_LOGO_WIDTH_RATIO;
  const padding = Number.isFinite(Number(opts.padding)) ? Number(opts.padding) : DEFAULT_PADDING;
  const position = opts.position || 'top-left';

  const base = sharp(baseBuffer);
  const baseMeta = await base.metadata();
  const baseW = baseMeta.width || 1024;
  const baseH = baseMeta.height || 1024;
  const maxLogoW = Math.max(32, Math.round(baseW * maxWidthRatio));

  const logoResized = sharp(logoBuffer).resize({
    width: maxLogoW,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const logoMeta = await logoResized.metadata();
  const logoW = logoMeta.width || maxLogoW;
  const logoH = logoMeta.height || maxLogoW;
  const logoPng = await logoResized.png().toBuffer();
  const { left, top } = compositePosition(baseW, baseH, logoW, logoH, padding, position);

  return base
    .composite([{ input: logoPng, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function saveCompositedImageBuffer(req, buffer) {
  const wid = String((req && req.workspaceId) || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const relDir = path.join('public', 'uploads', 'creative');
  const absDir = path.join(process.cwd(), relDir);
  await fs.mkdir(absDir, { recursive: true });
  const filename = `${wid}_composited_${Date.now()}.jpg`;
  const absPath = path.join(absDir, filename);
  await fs.writeFile(absPath, buffer);
  return `/uploads/creative/${filename}`;
}

async function applyLogoOverlayToRemoteImage(req, { baseImageUrl, logoUrl, position }) {
  const baseBuf = await fetchImageBuffer(baseImageUrl);
  const logoBuf = await fetchImageBuffer(logoUrl);
  const outBuf = await compositeLogoOnImageBuffer(baseBuf, logoBuf, { position });
  const publicUrl = await saveCompositedImageBuffer(req, outBuf);
  return publicUrl;
}

module.exports = {
  DEFAULT_MAX_LOGO_WIDTH_RATIO,
  DEFAULT_PADDING,
  fetchImageBuffer,
  compositeLogoOnImageBuffer,
  applyLogoOverlayToRemoteImage,
};
