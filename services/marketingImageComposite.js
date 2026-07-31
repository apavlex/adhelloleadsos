/**
 * Overlay brand logos onto generated marketing images without AI distortion.
 */

const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const dbService = require('./database');

const DEFAULT_MAX_LOGO_WIDTH_RATIO = 0.18;
const DEFAULT_PADDING = 24;

/** Lob 4×6 postcard with bleed at 300 DPI — 6.25″ × 4.25″ (landscape) */
const LOB_POSTCARD_WIDTH_PX = 1875;
const LOB_POSTCARD_HEIGHT_PX = 1275;
const LOB_POSTCARD_WIDTH_IN = 6.25;
const LOB_POSTCARD_HEIGHT_IN = 4.25;

/** Trim-safe content area — inset 0.25″ from bleed on all sides (≈0.125″ past trim). */
const LOB_BLEED_INSET_PX = 75;
const LOB_SAFE_WIDTH_PX = 1725;
const LOB_SAFE_HEIGHT_PX = 1125;

/** Ink-free address block on 4×6 postcard backs — do not place artwork here. */
const LOB_BACK_INK_FREE = {
  widthIn: 3.2835,
  heightIn: 2.375,
  rightIn: 0.275,
  bottomIn: 0.25,
};

function absoluteAssetUrl(req, relativePath) {
  const rel = String(relativePath || '').trim();
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  const envBase = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  const base = envBase || (req ? `${req.protocol}://${req.get('host')}` : '');
  if (!base) return rel;
  return rel.startsWith('/') ? `${base}${rel}` : `${base}/${rel}`;
}

function lobInkFreeRectPx() {
  const w = LOB_POSTCARD_WIDTH_PX;
  const h = LOB_POSTCARD_HEIGHT_PX;
  const zoneW = Math.round((LOB_BACK_INK_FREE.widthIn / LOB_POSTCARD_WIDTH_IN) * w);
  const zoneH = Math.round((LOB_BACK_INK_FREE.heightIn / LOB_POSTCARD_HEIGHT_IN) * h);
  const marginR = Math.round((LOB_BACK_INK_FREE.rightIn / LOB_POSTCARD_WIDTH_IN) * w);
  const marginB = Math.round((LOB_BACK_INK_FREE.bottomIn / LOB_POSTCARD_HEIGHT_IN) * h);
  return {
    left: Math.max(0, w - marginR - zoneW),
    top: Math.max(0, h - marginB - zoneH),
    width: zoneW,
    height: zoneH,
  };
}

async function applyLobBackInkFreeMask(buffer) {
  const rect = lobInkFreeRectPx();
  const white = await sharp({
    create: {
      width: rect.width,
      height: rect.height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  return sharp(buffer)
    .composite([{ input: white, left: rect.left, top: rect.top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function resizeBufferForLobPostcard(buffer, { side } = {}) {
  let out = await sharp(buffer)
    .resize(LOB_POSTCARD_WIDTH_PX, LOB_POSTCARD_HEIGHT_PX, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  if (side === 'back') out = await applyLobBackInkFreeMask(out);
  return out;
}

const FETCH_IMAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/*',
};

async function fetchImageBuffer(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid image URL is required.');
  }
  const res = await fetch(url, { redirect: 'follow', headers: FETCH_IMAGE_HEADERS });
  if (!res.ok) {
    throw new Error(`Could not fetch image (${res.status}).`);
  }
  const ab = await res.arrayBuffer();
  if (!ab || !ab.byteLength) throw new Error('Image download was empty.');
  return Buffer.from(ab);
}

async function prepareRemoteImageForLobPostcard(imageUrl, req, { side } = {}) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid image URL is required for Lob postcard sizing.');
  }
  const buf = await fetchImageBuffer(url);
  const out = await resizeBufferForLobPostcard(buf, { side });
  const rel = await saveCompositedImageBuffer(req, out, side === 'back' ? 'lob_postcard_back' : 'lob_postcard');
  return absoluteAssetUrl(req, rel);
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

async function prepareLogoBufferForOverlay(logoBuffer, mimeType) {
  let buf = logoBuffer;
  if (!buf || !buf.length) throw new Error('Logo buffer is empty.');
  if (/svg/i.test(String(mimeType || ''))) {
    buf = await sharp(buf).png().toBuffer();
  } else {
    try {
      buf = await sharp(buf).trim({ threshold: 12 }).png().toBuffer();
    } catch {
      buf = await sharp(buf).png().toBuffer();
    }
  }
  return buf;
}

const LOGO_BACKDROP_PAD = 10;
const LOGO_BACKDROP_RADIUS = 8;
const LOGO_BACKDROP_OPACITY = 0.72;

async function createLogoBackdropSvg(width, height, { radius = LOGO_BACKDROP_RADIUS, opacity = LOGO_BACKDROP_OPACITY } = {}) {
  const alpha = Math.min(1, Math.max(0, Number(opacity) || LOGO_BACKDROP_OPACITY));
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="rgba(255,255,255,${alpha})"/>
    </svg>`,
  );
}

async function compositeLogoOnImageBuffer(baseBuffer, logoBuffer, opts = {}) {
  const maxWidthRatio = Number(opts.maxWidthRatio) || DEFAULT_MAX_LOGO_WIDTH_RATIO;
  const padding = Number.isFinite(Number(opts.padding)) ? Number(opts.padding) : DEFAULT_PADDING;
  const position = opts.position || 'top-left';
  const pos = String(position || 'top-left').toLowerCase();

  const normalizedBase = await sharp(baseBuffer).rotate().toBuffer();
  const baseMeta = await sharp(normalizedBase).metadata();
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

  const layers = [];
  if (pos === 'top-right') {
    const backdropW = logoW + LOGO_BACKDROP_PAD * 2;
    const backdropH = logoH + LOGO_BACKDROP_PAD * 2;
    const backdropSvg = await createLogoBackdropSvg(backdropW, backdropH);
    layers.push({
      input: backdropSvg,
      left: Math.max(0, left - LOGO_BACKDROP_PAD),
      top: Math.max(0, top - LOGO_BACKDROP_PAD),
    });
  }
  layers.push({ input: logoPng, left, top });

  return sharp(normalizedBase)
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}

function getCreativeStorageDir() {
  return path.join(path.dirname(dbService.getDbPath()), 'creative');
}

function creativePublicPath(filename) {
  return `/direct-mail/api/creative/${filename}`;
}

async function saveCompositedImageBuffer(req, buffer, prefix) {
  const wid = String((req && req.workspaceId) || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const absDir = getCreativeStorageDir();
  await fs.mkdir(absDir, { recursive: true });
  const stem = String(prefix || 'composited').trim() || 'composited';
  const filename = `${wid}_${stem}_${Date.now()}.jpg`;
  const absPath = path.join(absDir, filename);
  await fs.writeFile(absPath, buffer);
  return creativePublicPath(filename);
}

async function applyLogoOverlayFromBuffers(
  req,
  { baseBuffer, logoBuffer, logoMimeType, position, maxWidthRatio, padding, prefix },
) {
  if (!baseBuffer || !baseBuffer.length) throw new Error('Base image buffer is empty.');
  if (!logoBuffer || !logoBuffer.length) throw new Error('Logo buffer is empty.');
  const logoBuf = await prepareLogoBufferForOverlay(logoBuffer, logoMimeType);
  const outBuf = await compositeLogoOnImageBuffer(baseBuffer, logoBuf, {
    position,
    maxWidthRatio,
    padding,
  });
  return saveCompositedImageBuffer(req, outBuf, prefix || 'logo_overlay');
}

async function applyLogoOverlayToRemoteImage(
  req,
  { baseImageUrl, baseBuffer, logoUrl, logoBuffer, logoMimeType, position, maxWidthRatio, padding, prefix },
) {
  const baseBuf = baseBuffer && baseBuffer.length ? baseBuffer : await fetchImageBuffer(baseImageUrl);
  let logoBuf = logoBuffer;
  if (!logoBuf) {
    if (!logoUrl) throw new Error('Logo URL or buffer is required.');
    logoBuf = await fetchImageBuffer(logoUrl);
  }
  return applyLogoOverlayFromBuffers(req, {
    baseBuffer: baseBuf,
    logoBuffer: logoBuf,
    logoMimeType,
    position,
    maxWidthRatio,
    padding,
    prefix,
  });
}

module.exports = {
  DEFAULT_MAX_LOGO_WIDTH_RATIO,
  DEFAULT_PADDING,
  FETCH_IMAGE_HEADERS,
  LOB_POSTCARD_WIDTH_PX,
  LOB_POSTCARD_HEIGHT_PX,
  LOB_BLEED_INSET_PX,
  LOB_SAFE_WIDTH_PX,
  LOB_SAFE_HEIGHT_PX,
  LOB_BACK_INK_FREE,
  lobInkFreeRectPx,
  compositePosition,
  getCreativeStorageDir,
  creativePublicPath,
  fetchImageBuffer,
  prepareLogoBufferForOverlay,
  compositeLogoOnImageBuffer,
  applyLobBackInkFreeMask,
  resizeBufferForLobPostcard,
  prepareRemoteImageForLobPostcard,
  applyLogoOverlayFromBuffers,
  applyLogoOverlayToRemoteImage,
};
