const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<{ name: string, mimeType: string, buffer: Buffer }>}
 */
async function downloadDriveFileAsCsvBuffer(accessToken, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('Missing file id.');

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok) {
    const msg = meta.error?.message || meta.message || `Drive metadata ${metaRes.status}`;
    throw new Error(msg);
  }
  const mimeType = String(meta.mimeType || '');
  const name = String(meta.name || 'drive-import.csv');

  let buf;
  if (mimeType === SPREADSHEET_MIME) {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('text/csv')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const ab = await exportRes.arrayBuffer();
    if (!exportRes.ok) {
      let errText = '';
      try {
        errText = new TextDecoder().decode(ab);
      } catch (_) {
        /* ignore */
      }
      throw new Error(errText || `Sheets export failed (${exportRes.status})`);
    }
    buf = Buffer.from(ab);
  } else {
    const allowed =
      mimeType === 'text/csv' ||
      mimeType === 'application/csv' ||
      mimeType === 'text/plain' ||
      mimeType === 'application/vnd.ms-excel';
    if (!allowed) {
      throw new Error(
        `Unsupported file type (${mimeType || 'unknown'}). Use a .csv file or a Google Sheet.`
      );
    }
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const ab = await mediaRes.arrayBuffer();
    if (!mediaRes.ok) {
      let errText = '';
      try {
        errText = new TextDecoder().decode(ab);
      } catch (_) {
        /* ignore */
      }
      throw new Error(errText || `Drive download failed (${mediaRes.status})`);
    }
    buf = Buffer.from(ab);
  }

  return { name, mimeType, buffer: buf };
}

module.exports = { downloadDriveFileAsCsvBuffer, SPREADSHEET_MIME };
