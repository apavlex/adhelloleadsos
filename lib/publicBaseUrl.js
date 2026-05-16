/**
 * Canonical public origin for OAuth redirects, webhooks, and share links.
 * Prefer explicit BASE_URL; on Render use RENDER_EXTERNAL_URL when BASE_URL is unset.
 */

function stripTrailingSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function fromEnv() {
  const candidates = [
    process.env.BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.RENDER_EXTERNAL_URL,
  ];
  for (const raw of candidates) {
    const v = stripTrailingSlash(raw);
    if (v) return v;
  }
  return '';
}

/**
 * @param {import('express').Request} [req]
 * @returns {string}
 */
function getPublicBaseUrl(req) {
  const envBase = fromEnv();
  if (envBase) return envBase;
  if (req && typeof req.get === 'function') {
    const host = req.get('host');
    if (host) {
      const proto = req.protocol || 'https';
      return `${proto}://${host}`;
    }
  }
  return 'http://localhost:3000';
}

function googleOAuthRedirectUris(base) {
  const b = stripTrailingSlash(base) || 'http://localhost:3000';
  return {
    signIn: `${b}/auth/google/callback`,
    drive: `${b}/auth/google/drive/callback`,
  };
}

module.exports = {
  getPublicBaseUrl,
  googleOAuthRedirectUris,
  stripTrailingSlash,
};
