/**
 * Canonical public origin for OAuth redirects, webhooks, and share links.
 * Prefer the incoming request host when present (so custom domains stick),
 * then BASE_URL / PUBLIC_BASE_URL, then RENDER_EXTERNAL_URL.
 *
 * Customer-facing reviews-app links (/app signup, /m portal, /rv/:slug in
 * SMS/email/QR) always use the AdHello reviews host via
 * getReviewPublicBaseUrl() so texts never ship localhost, onrender.com, or
 * the CRM host (leads.adhello.io).
 */

/** Default branded origin for the reviews app and customer review pages. */
const ADHELLO_REVIEW_PUBLIC_BASE = 'https://reviews.adhello.io';

function stripTrailingSlash(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Historical typo: leads used .ai; canonical CRM host is leads.adhello.io. */
function normalizePublicOrigin(url) {
  let s = stripTrailingSlash(url);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/^(https?:\/\/)leads\.adhello\.ai(?=\/|$)/i, '$1leads.adhello.io');
  s = s.replace(/^(https?:\/\/)reviews\.adhello\.ai(?=\/|$)/i, '$1reviews.adhello.io');
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
  if (h === 'reviews.adhello.io' || h === 'reviews.adhello.ai') return true;
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

/**
 * Origin for the reviews app + customer-facing review links (SMS, email, QR).
 * Always AdHello-branded: REVIEW_PUBLIC_BASE_URL → reviews.adhello.io
 * (never localhost, onrender.com, or the CRM host).
 * @returns {string}
 */
function getReviewPublicBaseUrl() {
  const override = normalizePublicOrigin(process.env.REVIEW_PUBLIC_BASE_URL);
  if (override) {
    const host = hostnameOf(override);
    // Allow only AdHello hosts for branded customer links (plus explicit override testing).
    if (isAllowedPublicHost(host) && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.onrender.com')) {
      return override;
    }
  }
  return ADHELLO_REVIEW_PUBLIC_BASE;
}

/** Public signup URL for the reviews app (https://reviews.adhello.io/app). */
function getReviewsAppSignupUrl() {
  return `${getReviewPublicBaseUrl()}/app`;
}

/** Flooring partners signup (https://reviews.adhello.io/app/flooring) → TPR network. */
function getFlooringAppSignupUrl() {
  return `${getReviewPublicBaseUrl()}/app/flooring`;
}

/**
 * Per-network public partner signup URL:
 * https://reviews.adhello.io/join/{workspaceSlug}
 */
function getNetworkJoinUrl(joinSlug) {
  const s = String(joinSlug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!s) return '';
  return `${getReviewPublicBaseUrl()}/join/${encodeURIComponent(s)}`;
}

/**
 * Absolute public review page URL: https://reviews.adhello.io/rv/{slug}
 * Optional imageId attaches ?i= so link previews use a per-request share photo.
 * Optional askId attaches ?a= for per-customer open/click tracking + reminders.
 */
function getReviewPageUrl(slug, opts) {
  const s = String(slug || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  const base = `${getReviewPublicBaseUrl()}/rv/${encodeURIComponent(s)}`;
  const params = new URLSearchParams();
  const imageId = opts && opts.imageId ? String(opts.imageId).trim() : '';
  if (imageId && imageId !== 'default') params.set('i', imageId);
  const askId = opts && opts.askId ? String(opts.askId).trim() : '';
  if (askId) params.set('a', askId);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
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
  getReviewPublicBaseUrl,
  getReviewsAppSignupUrl,
  getFlooringAppSignupUrl,
  getNetworkJoinUrl,
  getReviewPageUrl,
  getRequestOrigin,
  googleOAuthRedirectUris,
  stripTrailingSlash,
  normalizePublicOrigin,
  isAllowedPublicHost,
  ADHELLO_REVIEW_PUBLIC_BASE,
};
