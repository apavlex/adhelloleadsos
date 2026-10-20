/**
 * Short public URLs for the member app (SMS / email).
 *   https://reviews.adhello.io/a/x7k2m9qp  →  /m/:signedToken
 *   https://reviews.adhello.io/a/x7k2m9qp/review?ask=1  → same with path
 *
 * Opaque codes are stored in KV and on the member row so texts stay short
 * while the signed /m/ token is minted on each redirect.
 */

const crypto = require('crypto');
const dbService = require('./database');
const store = require('./networkStore');

const CODE_RE = /^[a-z0-9]{8,12}$/;
const KEY_PREFIX = 'netappcode:';

function newCode() {
  // 8 chars, lowercase alphanumeric (no ambiguous padding from base64url).
  let out = '';
  while (out.length < 8) {
    out += crypto.randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  return out.slice(0, 8);
}

function cleanCode(value) {
  const c = String(value || '').trim().toLowerCase();
  return CODE_RE.test(c) ? c : '';
}

async function readCode(code) {
  const c = cleanCode(code);
  if (!c) return null;
  const raw = await dbService.peekStorageKey(`${KEY_PREFIX}${c}`);
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !parsed.networkId || !parsed.memberId) return null;
    return {
      code: c,
      networkId: String(parsed.networkId),
      memberId: String(parsed.memberId),
      createdAt: parsed.createdAt || '',
    };
  } catch {
    return null;
  }
}

async function writeCode(code, { networkId, memberId }) {
  const c = cleanCode(code);
  if (!c) throw new Error('writeCode: invalid code');
  const row = {
    networkId: String(networkId),
    memberId: String(memberId),
    createdAt: new Date().toISOString(),
  };
  await dbService.putStorageKey(`${KEY_PREFIX}${c}`, row);
  return { code: c, ...row };
}

/**
 * Stable short code for a member. Reuses member.portalCode when valid.
 * @returns {Promise<string>}
 */
async function ensurePortalCode(networkId, member) {
  const nid = String(networkId || '').trim();
  if (!nid || !member || !member.id) throw new Error('ensurePortalCode: networkId and member required');

  const existing = cleanCode(member.portalCode);
  if (existing) {
    const row = await readCode(existing);
    if (row && row.networkId === nid && row.memberId === member.id) return existing;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newCode();
    if (await readCode(code)) continue;
    await writeCode(code, { networkId: nid, memberId: member.id });
    await store.saveMember(nid, { ...member, portalCode: code });
    return code;
  }
  throw new Error('ensurePortalCode: could not allocate a short code');
}

/**
 * @param {string} baseUrl
 * @param {object} network
 * @param {object} member
 * @param {string} [pathAndQuery] e.g. "/review?ask=1"
 */
async function memberAppShortLink(baseUrl, network, member, pathAndQuery = '') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('memberAppShortLink: baseUrl required');
  const code = await ensurePortalCode(network.id, member);
  let suffix = String(pathAndQuery || '');
  if (suffix && !suffix.startsWith('/') && !suffix.startsWith('?')) suffix = `/${suffix}`;
  return `${base}/a/${encodeURIComponent(code)}${suffix}`;
}

module.exports = {
  CODE_RE,
  cleanCode,
  newCode,
  readCode,
  ensurePortalCode,
  memberAppShortLink,
};
