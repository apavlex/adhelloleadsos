/**
 * Canonical public origin for OAuth redirects, webhooks, and share links.
 * Prefer the incoming request host when present (so custom domains stick),
 * then BASE_URL / PUBLIC_BASE_URL, then RENDER_EXTERNAL_URL.
 */

function stripTrailingSlash(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Historical typo: leads used .ai; canonical app host is leads.adhello.io. */
function normalizePublicOrigin(url) {
  let s = stripTrailingSlash(url);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/^(https?:\/\/)leads\.adhello\.ai(?=\/|$)/i, '$1leads.adhello.io');
  return s;
}

function fromEnv() {
  const candidates = [
    process.env.BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.RENDER_EXTERNAL_URL,
  ];
  for (const raw of candidates) {
    const v = normalizePublicOrigin(raw);
    if (v) return v;
  }
  return '';
}

function hostnameOf(hostOrUrl) {
  const raw = String(hostOrUrl || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    /* fall through */
  }
  return raw.split('/')[0].split(':')[0];
}

function isAllowedPublicHost(host) {
  const h = hostnameOf(host);
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (h.endsWith('.onrender.com')) return true;
  if (h === 'leads.adhello.io' || h === 'leads.adhello.ai') return true;
  if (h === 'adhello.io' || h.endsWith('.adhello.io')) return true;
  if (h === 'adhello.ai' || h.endsWith('.adhello.ai')) return true;
  return false;
}

/**
 * Origin from the live HTTP request (Render custom domain, local, etc.).
 * @param {import('express').Request} [req]
 * @returns {string}
 */
function getRequestOrigin(req) {
  if (!req || typeof req.get !== 'function') return '';
  const xfHost = String(req.get('x-forwarded-host') || '')
    .split(',')[0]
    .trim();
  const host = xfHost || String(req.get('host') || '').trim();
  if (!host || !isAllowedPublicHost(host)) return '';
  const xfProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = xfProto === 'http' || xfProto === 'https' ? xfProto : req.protocol || 'https';
  return normalizePublicOrigin(`${proto}://${host}`);
}

/**
 * @param {import('express').Request} [req]
 * @returns {string}
 */
function getPublicBaseUrl(req) {
  const fromReq = getRequestOrigin(req);
  if (fromReq) return fromReq;
  const envBase = fromEnv();
  if (envBase) return envBase;
  return 'http://localhost:3000';
}

function googleOAuthRedirectUris(base) {
  const b = normalizePublicOrigin(base) || 'http://localhost:3000';
  return {
    signIn: `${b}/auth/google/callback`,
    drive: `${b}/auth/google/drive/callback`,
  };
}

module.exports = {
  getPublicBaseUrl,
  getRequestOrigin,
  googleOAuthRedirectUris,
  stripTrailingSlash,
  normalizePublicOrigin,
  isAllowedPublicHost,
};
