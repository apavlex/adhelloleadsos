const { parseDriveApiError } = require('./googleDriveCsv');

const DRIVE_SHARED_PARAMS = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const DEFAULT_FOLDER_NAME = 'AdHello Leads';
const DEFAULT_MARKETING_FOLDER_NAME = 'AdHello Marketing';

function safeDriveFileName(name) {
  const base = String(name || 'AdHello_Leads.csv')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim();
  if (!base) return 'AdHello_Leads.csv';
  return base.toLowerCase().endsWith('.csv') ? base : `${base}.csv`;
}

function safeImageFileName(name) {
  const base = String(name || 'AdHello_Design.jpg')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim();
  if (!base) return 'AdHello_Design.jpg';
  return /\.(jpe?g|png|webp)$/i.test(base) ? base : `${base}.jpg`;
}

/**
 * @param {string} accessToken
 * @param {string} folderName
 * @returns {Promise<string|null>} folder id
 */
async function findOrCreateFolder(accessToken, folderName) {
  const esc = String(folderName || DEFAULT_FOLDER_NAME).replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${esc}' and trashed=false`
  );
  const listUrl =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id)&pageSize=1&${DRIVE_SHARED_PARAMS}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listJson = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    const msg = listJson.error?.message || `Drive folder lookup failed (${listRes.status})`;
    throw new Error(msg);
  }
  const existing = listJson.files && listJson.files[0];
  if (existing && existing.id) return String(existing.id);

  const createRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${DRIVE_SHARED_PARAMS}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName || DEFAULT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.id) {
    const msg = created.error?.message || `Drive folder create failed (${createRes.status})`;
    throw new Error(msg);
  }
  return String(created.id);
}

/**
 * @param {string} accessToken
 * @param {{ name: string, content: string|Buffer, folderId?: string, useDefaultFolder?: boolean }} opts
 * @returns {Promise<{ id: string, name: string, webViewLink?: string }>}
 */
async function uploadCsvToDrive(accessToken, opts) {
  const name = safeDriveFileName(opts.name);
  const content = Buffer.isBuffer(opts.content)
    ? opts.content
    : Buffer.from(String(opts.content || ''), 'utf8');
  if (!content.length) throw new Error('CSV is empty.');

  let parents;
  if (opts.folderId) {
    parents = [String(opts.folderId)];
  } else if (opts.useDefaultFolder !== false) {
    const folderId = await findOrCreateFolder(accessToken, DEFAULT_FOLDER_NAME);
    if (folderId) parents = [folderId];
  }

  const metadata = { name, mimeType: 'text/csv' };
  if (parents && parents.length) metadata.parents = parents;

  const boundary = `adhello_${Date.now().toString(36)}`;
  const metaPart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    '',
  ].join('\r\n');
  const filePart = [
    `--${boundary}`,
    'Content-Type: text/csv',
    '',
    '',
  ].join('\r\n');
  const close = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    Buffer.from(filePart, 'utf8'),
    content,
    Buffer.from(close, 'utf8'),
  ]);

  const url =
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` +
    `&fields=id,name,webViewLink&${DRIVE_SHARED_PARAMS}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const ab = await res.arrayBuffer();
  const json = JSON.parse(new TextDecoder().decode(ab) || '{}');
  if (!res.ok) {
    const msg = parseDriveApiError(json, `Drive upload failed (${res.status})`);
    const err = new Error(msg);
    if (res.status === 403) err.code = 'DRIVE_SCOPE';
    throw err;
  }
  return {
    id: String(json.id || ''),
    name: String(json.name || name),
    webViewLink: json.webViewLink ? String(json.webViewLink) : undefined,
  };
}

/**
 * @param {string} accessToken
 * @param {{ name: string, content: Buffer, mimeType?: string, folderId?: string, folderName?: string, useDefaultFolder?: boolean }} opts
 * @returns {Promise<{ id: string, name: string, webViewLink?: string }>}
 */
async function uploadBinaryToDrive(accessToken, opts) {
  const name = safeImageFileName(opts.name);
  const content = Buffer.isBuffer(opts.content)
    ? opts.content
    : Buffer.from(String(opts.content || ''));
  if (!content.length) throw new Error('File is empty.');

  const mimeType = String(opts.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';

  let parents;
  if (opts.folderId) {
    parents = [String(opts.folderId)];
  } else if (opts.folderName) {
    const folderId = await findOrCreateFolder(accessToken, opts.folderName);
    if (folderId) parents = [folderId];
  } else if (opts.useDefaultFolder !== false) {
    const folderId = await findOrCreateFolder(accessToken, DEFAULT_FOLDER_NAME);
    if (folderId) parents = [folderId];
  }

  const metadata = { name, mimeType };
  if (parents && parents.length) metadata.parents = parents;

  const boundary = `adhello_${Date.now().toString(36)}`;
  const metaPart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    '',
  ].join('\r\n');
  const filePart = [`--${boundary}`, `Content-Type: ${mimeType}`, '', ''].join('\r\n');
  const close = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    Buffer.from(filePart, 'utf8'),
    content,
    Buffer.from(close, 'utf8'),
  ]);

  const url =
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` +
    `&fields=id,name,webViewLink&${DRIVE_SHARED_PARAMS}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const ab = await res.arrayBuffer();
  const json = JSON.parse(new TextDecoder().decode(ab) || '{}');
  if (!res.ok) {
    const msg = parseDriveApiError(json, `Drive upload failed (${res.status})`);
    const err = new Error(msg);
    if (res.status === 403) err.code = 'DRIVE_SCOPE';
    throw err;
  }
  return {
    id: String(json.id || ''),
    name: String(json.name || name),
    webViewLink: json.webViewLink ? String(json.webViewLink) : undefined,
  };
}

module.exports = {
  uploadCsvToDrive,
  uploadBinaryToDrive,
  findOrCreateFolder,
  safeDriveFileName,
  safeImageFileName,
  DEFAULT_FOLDER_NAME,
  DEFAULT_MARKETING_FOLDER_NAME,
};
