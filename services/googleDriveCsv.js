const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_XLS_MIME = 'application/vnd.ms-excel';

const DRIVE_SHARED_PARAMS = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/octet-stream',
]);

function parseDriveApiError(body, fallback) {
  if (!body) return fallback;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const msg = parsed?.error?.message || parsed?.message;
    if (msg && typeof msg === 'string') return msg;
  } catch (_) {
    /* not JSON */
  }
  const text = String(body).trim();
  return text.length > 0 && text.length < 500 ? text : fallback;
}

function isCsvFileName(name) {
  const n = String(name || '').toLowerCase();
  return n.endsWith('.csv') || n.endsWith('.tsv') || n.endsWith('.txt');
}

function isXlsxFileName(name) {
  const n = String(name || '').toLowerCase();
  return n.endsWith('.xlsx') || n.endsWith('.xls');
}

/**
 * @param {string} mimeType
 * @param {string} name
 * @returns {'sheet'|'csv'|'xlsx'|null}
 */
function classifyDriveFile(mimeType, name) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === SPREADSHEET_MIME) return 'sheet';
  if (isXlsxFileName(name) || mime === XLSX_MIME) return 'xlsx';
  if (mime === LEGACY_XLS_MIME && isXlsxFileName(name)) return 'xlsx';
  if (CSV_MIME_TYPES.has(mime)) return 'csv';
  if (isCsvFileName(name)) return 'csv';
  return null;
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<{ name: string, mimeType: string, id: string }>}
 */
async function fetchDriveFileMeta(accessToken, fileId) {
  const id = String(fileId || '').trim();
  const fields = encodeURIComponent(
    'name,mimeType,shortcutDetails(targetId,targetMimeType)'
  );
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}` +
    `?fields=${fields}&${DRIVE_SHARED_PARAMS}`;
  const metaRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok) {
    const msg = meta.error?.message || meta.message || `Drive metadata ${metaRes.status}`;
    throw new Error(msg);
  }

  const mimeType = String(meta.mimeType || '');
  const name = String(meta.name || 'drive-import.csv');

  if (mimeType === 'application/vnd.google-apps.shortcut' && meta.shortcutDetails?.targetId) {
    return fetchDriveFileMeta(accessToken, meta.shortcutDetails.targetId);
  }

  return { id, name, mimeType };
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
async function exportSpreadsheetAsCsv(accessToken, fileId) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
    `?mimeType=${encodeURIComponent('text/csv')}&${DRIVE_SHARED_PARAMS}`;
  const exportRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ab = await exportRes.arrayBuffer();
  if (!exportRes.ok) {
    throw new Error(
      parseDriveApiError(
        new TextDecoder().decode(ab),
        `Google Sheet export failed (${exportRes.status})`
      )
    );
  }
  return Buffer.from(ab);
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
async function downloadDriveMedia(accessToken, fileId) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&${DRIVE_SHARED_PARAMS}`;
  const mediaRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ab = await mediaRes.arrayBuffer();
  if (!mediaRes.ok) {
    throw new Error(
      parseDriveApiError(
        new TextDecoder().decode(ab),
        `Drive download failed (${mediaRes.status})`
      )
    );
  }
  return Buffer.from(ab);
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<{ name: string, mimeType: string, buffer: Buffer }>}
 */
async function downloadDriveFileAsCsvBuffer(accessToken, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('Missing file id.');

  const meta = await fetchDriveFileMeta(accessToken, id);
  const kind = classifyDriveFile(meta.mimeType, meta.name);

  if (!kind) {
    throw new Error(
      `Unsupported file type (${meta.mimeType || 'unknown'}). Use a .csv, .xlsx, or Google Sheet.`
    );
  }

  const buf =
    kind === 'sheet'
      ? await exportSpreadsheetAsCsv(accessToken, meta.id)
      : await downloadDriveMedia(accessToken, meta.id);

  return { name: meta.name, mimeType: meta.mimeType, buffer: buf };
}

module.exports = {
  downloadDriveFileAsCsvBuffer,
  fetchDriveFileMeta,
  downloadDriveMedia,
  SPREADSHEET_MIME,
  classifyDriveFile,
  parseDriveApiError,
  DRIVE_SHARED_PARAMS,
};
