const {
  fetchDriveFileMeta,
  downloadDriveMedia,
  parseDriveApiError,
  DRIVE_SHARED_PARAMS,
} = require('./googleDriveCsv');

const DRAWING_MIME = 'application/vnd.google-apps.drawing';

const IMAGE_MIME_PREFIX = 'image/';

function isImageFileName(name) {
  return /\.(jpe?g|png|gif|webp|svg|bmp|tiff?)$/i.test(String(name || ''));
}

/**
 * @param {string} mimeType
 * @param {string} name
 * @returns {'drawing'|'image'|null}
 */
function classifyDriveImage(mimeType, name) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === DRAWING_MIME) return 'drawing';
  if (mime.startsWith(IMAGE_MIME_PREFIX)) return 'image';
  if (isImageFileName(name)) return 'image';
  return null;
}

async function exportDriveFileAsPng(accessToken, fileId) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
    `?mimeType=${encodeURIComponent('image/png')}&${DRIVE_SHARED_PARAMS}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ab = await res.arrayBuffer();
  if (!res.ok) {
    throw new Error(
      parseDriveApiError(
        new TextDecoder().decode(ab),
        `Drive image export failed (${res.status})`,
      ),
    );
  }
  return Buffer.from(ab);
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<{ name: string, mimeType: string, buffer: Buffer }>}
 */
async function downloadDriveFileAsImageBuffer(accessToken, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('Missing file id.');

  const meta = await fetchDriveFileMeta(accessToken, id);
  const kind = classifyDriveImage(meta.mimeType, meta.name);
  if (!kind) {
    throw new Error(
      `Unsupported file type (${meta.mimeType || 'unknown'}). Choose a JPG, PNG, GIF, WebP, or SVG image.`,
    );
  }

  if (kind === 'drawing') {
    const buffer = await exportDriveFileAsPng(accessToken, meta.id);
    return { name: meta.name, mimeType: 'image/png', buffer };
  }

  const buffer = await downloadDriveMedia(accessToken, meta.id);
  let mimeType = String(meta.mimeType || '').toLowerCase();
  if (!mimeType.startsWith(IMAGE_MIME_PREFIX)) {
    if (/\.png$/i.test(meta.name)) mimeType = 'image/png';
    else if (/\.gif$/i.test(meta.name)) mimeType = 'image/gif';
    else if (/\.webp$/i.test(meta.name)) mimeType = 'image/webp';
    else if (/\.svg$/i.test(meta.name)) mimeType = 'image/svg+xml';
    else mimeType = 'image/jpeg';
  }
  return { name: meta.name, mimeType, buffer };
}

module.exports = {
  classifyDriveImage,
  downloadDriveFileAsImageBuffer,
};
