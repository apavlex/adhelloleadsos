/**
 * Encrypt / decrypt per-workspace integration payloads (API keys, base URLs).
 * Set WORKSPACE_INTEGRATIONS_SECRET (min 16 chars) on the server to enable saving keys from the UI.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KDF_SALT = 'adhello-workspace-integrations-v1';

function getDerivedKey() {
  const sec = process.env.WORKSPACE_INTEGRATIONS_SECRET;
  if (!sec || String(sec).length < 16) return null;
  return crypto.scryptSync(String(sec), KDF_SALT, 32);
}

function isEncryptionAvailable() {
  return Boolean(getDerivedKey());
}

/**
 * @param {Record<string, string>} plain — only non-sensitive keys expected
 * @returns {string} base64 blob
 */
function encryptIntegrations(plain) {
  const key = getDerivedKey();
  if (!key) {
    throw new Error('WORKSPACE_INTEGRATIONS_SECRET is not set or too short (need at least 16 characters).');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const json = JSON.stringify(plain || {});
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * @param {string|null|undefined} blob
 * @returns {Record<string, string>|null}
 */
function decryptIntegrations(blob) {
  if (!blob || typeof blob !== 'string') return null;
  const key = getDerivedKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  encryptIntegrations,
  decryptIntegrations,
  isEncryptionAvailable,
};
