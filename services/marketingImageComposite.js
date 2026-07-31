/**
 * Overlay brand logos onto generated marketing images without AI distortion.
 */

const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');
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

function fetchImageBufferNode(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: 'GET',
        headers: FETCH_IMAGE_HEADERS,
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location && redirectCount < 5) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchImageBufferNode(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`Could not fetch image (${code}).`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (!buf.length) reject(new Error('Image download was empty.'));
          else resolve(buf);
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchImageBuffer(imageUrl, { retries = 3, timeoutMs = 90000 } = {}) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('A valid image URL is required.');
  }
  const headers = {
    ...FETCH_IMAGE_HEADERS,
    Referer: 'https://kie.ai/',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { redirect: 'follow', headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`Could not fetch image (${res.status}).`);
      }
      const ab = await res.arrayBuffer();
      if (!ab || !ab.byteLength) throw new Error('Image download was empty.');
      return Buffer.from(ab);
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }
  try {
    return await fetchImageBufferNode(url);
  } catch (nodeErr) {
    throw lastErr || nodeErr || new Error('Could not fetch image.');
  }
}

async function normalizeBaseForOverlay(baseBuffer) {
  const rotated = await sharp(baseBuffer).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const maxDim = 2560;
  if (w <= maxDim && h <= maxDim) return rotated;
  return sharp(rotated)
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
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
      const trimmed = await sharp(buf).trim({ threshold: 12 }).png().toBuffer();
      const meta = await sharp(trimmed).metadata();
      if ((meta.width || 0) >= 8 && (meta.height || 0) >= 8) {
        buf = trimmed;
      } else {
        buf = await sharp(logoBuffer).png().toBuffer();
      }
    } catch {
      buf = await sharp(buf).png().toBuffer();
    }
  }
  const finalMeta = await sharp(buf).metadata();
  if ((finalMeta.width || 0) < 4 || (finalMeta.height || 0) < 4) {
    throw new Error('Logo image is too small to overlay.');
  }
  return buf;
}

const LOGO_BACKDROP_PAD = 10;
const LOGO_BACKDROP_RADIUS = 8;
const LOGO_BACKDROP_OPACITY = 0.72;

async function createLogoBackdropPng(width, height, { radius = LOGO_BACKDROP_RADIUS, opacity = LOGO_BACKDROP_OPACITY } = {}) {
  const alpha = Math.min(1, Math.max(0, Number(opacity) || LOGO_BACKDROP_OPACITY));
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="rgba(255,255,255,${alpha})"/>
    </svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function compositeLogoOnImageBuffer(baseBuffer, logoBuffer, opts = {}) {
  const maxWidthRatio = Number(opts.maxWidthRatio) || DEFAULT_MAX_LOGO_WIDTH_RATIO;
  const padding = Number.isFinite(Number(opts.padding)) ? Number(opts.padding) : DEFAULT_PADDING;
  const position = opts.position || 'top-left';
  const pos = String(position || 'top-left').toLowerCase();
  const skipBackdrop = opts.skipBackdrop === true;

  const normalizedBase = await normalizeBaseForOverlay(baseBuffer);
  const baseMeta = await sharp(normalizedBase).metadata();
  const baseW = baseMeta.width || 1024;
  const baseH = baseMeta.height || 1024;
  const maxLogoW = Math.max(32, Math.round(baseW * maxWidthRatio));

  const logoPng = await sharp(logoBuffer)
    .resize({
      width: maxLogoW,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logoPng).metadata();
  const logoW = logoMeta.width || maxLogoW;
  const logoH = logoMeta.height || maxLogoW;
  const { left, top } = compositePosition(baseW, baseH, logoW, logoH, padding, position);

  const layers = [];
  if (pos === 'top-right' && !skipBackdrop) {
    try {
      const backdropW = logoW + LOGO_BACKDROP_PAD * 2;
      const backdropH = logoH + LOGO_BACKDROP_PAD * 2;
      const backdropPng = await createLogoBackdropPng(backdropW, backdropH);
      layers.push({
        input: backdropPng,
        left: Math.max(0, left - LOGO_BACKDROP_PAD),
        top: Math.max(0, top - LOGO_BACKDROP_PAD),
      });
    } catch {
      /* backdrop optional */
    }
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
  const stem = String(prefix || 'composited').trim() || 'composited';
  const filename = `${wid}_${stem}_${Date.now()}.jpg`;

  const dirs = [
    getCreativeStorageDir(),
    path.join(process.cwd(), 'public', 'uploads', 'creative'),
  ];
  let lastErr = null;
  for (const absDir of dirs) {
    try {
      await fs.mkdir(absDir, { recursive: true });
      const absPath = path.join(absDir, filename);
      await fs.writeFile(absPath, buffer);
      if (absDir === dirs[1]) {
        return `/uploads/creative/${filename}`;
      }
      return creativePublicPath(filename);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not save composited image.');
}

async function applyLogoOverlayFromBuffers(
  req,
  { baseBuffer, logoBuffer, logoMimeType, position, maxWidthRatio, padding, prefix },
) {
  if (!baseBuffer || !baseBuffer.length) throw new Error('Base image buffer is empty.');
  if (!logoBuffer || !logoBuffer.length) throw new Error('Logo buffer is empty.');
  const logoBuf = await prepareLogoBufferForOverlay(logoBuffer, logoMimeType);
  const opts = { position, maxWidthRatio, padding };
  try {
    const outBuf = await compositeLogoOnImageBuffer(baseBuffer, logoBuf, opts);
    return saveCompositedImageBuffer(req, outBuf, prefix || 'logo_overlay');
  } catch (firstErr) {
    const outBuf = await compositeLogoOnImageBuffer(baseBuffer, logoBuf, { ...opts, skipBackdrop: true });
    return saveCompositedImageBuffer(req, outBuf, prefix || 'logo_overlay');
  }
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
  normalizeBaseForOverlay,
  fetchImageBuffer,
  prepareLogoBufferForOverlay,
  compositeLogoOnImageBuffer,
  applyLobBackInkFreeMask,
  resizeBufferForLobPostcard,
  prepareRemoteImageForLobPostcard,
  applyLogoOverlayFromBuffers,
  applyLogoOverlayToRemoteImage,
};
