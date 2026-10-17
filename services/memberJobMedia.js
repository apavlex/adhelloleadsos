/**
 * Job-site photos for the member app.
 *
 *   netjobphoto:<networkId>:<memberId>:<jobId>:<photoId>
 */

const dbService = require('./database');
const networkBrand = require('./networkBrand');

const PREFIX = 'netjobphoto:';
/** Match memberWork — allow staff_* workspace seats (underscore). */
const SCOPE_ID = /^[a-z0-9_]{1,64}$/i;
const RECORD_ID = /^[a-z0-9]{6,40}$/;

function photoKey(networkId, memberId, jobId, photoId) {
  if (!SCOPE_ID.test(String(networkId || '')) || !SCOPE_ID.test(String(memberId || ''))) {
    throw new Error('memberJobMedia: invalid scope');
  }
  if (!RECORD_ID.test(String(jobId || '')) || !RECORD_ID.test(String(photoId || ''))) {
    throw new Error('memberJobMedia: invalid id');
  }
  return `${PREFIX}${networkId}:${memberId}:${jobId}:${photoId}`;
}

async function readJson(key) {
  const raw = await dbService.peekStorageKey(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Resize an upload for job documentation (wide JPEG, same as brand hero). */
async function prepareJobPhoto(buffer) {
  return networkBrand.prepareImage('hero', buffer);
}

async function saveJobPhoto(networkId, memberId, jobId, photoId, { contentType, buffer }) {
  const updatedAt = new Date().toISOString();
  await dbService.putStorageKey(photoKey(networkId, memberId, jobId, photoId), {
    contentType: contentType || 'image/jpeg',
    data: Buffer.from(buffer).toString('base64'),
    updatedAt,
  });
  return updatedAt;
}

async function getJobPhoto(networkId, memberId, jobId, photoId) {
  if (!RECORD_ID.test(String(photoId || ''))) return null;
  const row = await readJson(photoKey(networkId, memberId, jobId, photoId));
  if (!row || !row.data) return null;
  return {
    contentType: String(row.contentType || 'image/jpeg'),
    buffer: Buffer.from(String(row.data), 'base64'),
    updatedAt: row.updatedAt || '',
  };
}

async function deleteJobPhoto(networkId, memberId, jobId, photoId) {
  if (!RECORD_ID.test(String(photoId || ''))) return;
  await dbService.deleteStorageKey(photoKey(networkId, memberId, jobId, photoId));
}

async function deleteAllJobPhotos(networkId, memberId, jobId) {
  if (!RECORD_ID.test(String(jobId || ''))) return 0;
  const prefix = `${PREFIX}${networkId}:${memberId}:${jobId}:`;
  const keys = await dbService.listStorageKeysWithPrefix(prefix);
  for (const key of keys) await dbService.deleteStorageKey(key);
  return keys.length;
}

module.exports = {
  prepareJobPhoto,
  saveJobPhoto,
  getJobPhoto,
  deleteJobPhoto,
  deleteAllJobPhotos,
};
