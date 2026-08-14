/**
 * Validate and normalize social profile URLs/handles before save and render.
 * Rejects garbage like ",", "Portland, OR", or comma-separated multi-URL blobs.
 */

const PLATFORM_HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'fb.me', 'm.facebook.com'],
  instagram: ['instagram.com', 'instagr.am'],
  twitter: ['twitter.com', 'x.com'],
  linkedin: ['linkedin.com'],
  tiktok: ['tiktok.com'],
};

const PLATFORM_BASE = {
  facebook: (handle) => `https://www.facebook.com/${handle}`,
  instagram: (handle) => `https://www.instagram.com/${handle.replace(/^@/, '')}/`,
  twitter: (handle) => `https://x.com/${handle.replace(/^@/, '')}`,
  linkedin: (handle) => {
    const h = handle.replace(/^@/, '').replace(/\/$/, '');
    if (/^company\//i.test(h) || /^in\//i.test(h)) {
      return `https://www.linkedin.com/${h}`;
    }
    return `https://www.linkedin.com/company/${h}`;
  },
  tiktok: (handle) => `https://www.tiktok.com/@${handle.replace(/^@/, '')}`,
};

const SOCIAL_NOISE_SEGMENTS = new Set([
  'about',
  'accounts',
  'business',
  'company',
  'developers',
  'directory',
  'explore',
  'home',
  'login',
  'pages',
  'search',
  'share',
  'sharer',
  'signup',
]);

const HOSTING_VENDOR_TOKENS = new Set([
  'bluehost',
  'canva',
  'cloudflare',
  'elementor',
  'godaddy',
  'hostgator',
  'hubspot',
  'shopify',
  'squarespace',
  'weebly',
  'webflow',
  'wix',
  'wixstudio',
  'wordpress',
]);

const BUSINESS_STOP_WORDS = new Set([
  'and',
  'company',
  'construction',
  'contracting',
  'contractor',
  'corp',
  'corporation',
  'group',
  'home',
  'homes',
  'inc',
  'llc',
  'services',
  'solutions',
  'the',
]);

function isPlaceholder(v) {
  const s = String(v == null ? '' : v).trim();
  return !s || s === 'N/A' || s === 'undefined' || s === 'null' || s === '—' || s === '-';
}

function looksLikeLocationNotUrl(s) {
  if (/^https?:\/\//i.test(s)) return false;
  if (/[@]|\.(com|org|net|io|co)\b|facebook|instagram|twitter|linkedin|tiktok/i.test(s)) {
    return false;
  }
  if (/^[,.\s\-_]+$/.test(s)) return true;
  if (/^,?\s*[A-Za-z]{2,3}\s*$/.test(s)) return true;
  if (/^[A-Za-z\s.'-]+,\s*[A-Za-z]{2,}(\s+\d{5})?$/.test(s)) return true;
  return false;
}

function hostMatchesPlatform(host, platform) {
  const allowed = PLATFORM_HOSTS[platform];
  if (!allowed) return true;
  const h = String(host || '')
    .replace(/^www\./, '')
    .toLowerCase();
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

function isUsableHostname(host) {
  const h = String(host || '').trim();
  if (!h || h === ',' || h === '.' || h.length < 3) return false;
  if (!h.includes('.')) return false;
  if (!/^[a-z0-9.-]+$/i.test(h)) return false;
  return true;
}

function finalizeSocialUrl(url, platform) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!isUsableHostname(host)) return '';
    if (platform && !hostMatchesPlatform(host, platform)) return '';
    return u.href;
  } catch {
    return '';
  }
}

function socialPathIdentity(url, platform) {
  try {
    const u = new URL(url);
    let parts = u.pathname
      .split('/')
      .map((part) => decodeURIComponent(part).trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);
    if (platform === 'linkedin' && ['company', 'in'].includes(parts[0])) {
      parts = parts.slice(1);
    }
    return parts[0] || '';
  } catch {
    return '';
  }
}

function identityTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|corp|corporation|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !BUSINESS_STOP_WORDS.has(token));
}

function websiteIdentityTokens(lead) {
  const raw = String((lead && (lead.website || lead.url)) || '').trim();
  if (!raw) return [];
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname.replace(/^www\./i, '')
      .split('.')[0];
    return identityTokens(host);
  } catch {
    return [];
  }
}

function isLikelyBusinessSocialUrl(url, platform, lead) {
  const normalized = normalizeSocialUrl(url, platform);
  if (!normalized) return false;
  const identity = socialPathIdentity(normalized, platform);
  if (!identity || SOCIAL_NOISE_SEGMENTS.has(identity)) return false;

  const identityParts = identityTokens(identity);
  if (!identityParts.length) return false;
  if (identityParts.some((token) => HOSTING_VENDOR_TOKENS.has(token))) return false;

  const businessTokens = [
    ...identityTokens(lead && (lead.title || lead.company || lead.name)),
    ...websiteIdentityTokens(lead),
  ];
  if (!businessTokens.length) return true;

  const compactIdentity = identityParts.join('');
  return businessTokens.some(
    (token) => compactIdentity.includes(token) || token.includes(compactIdentity),
  );
}

function sanitizeExtractSocialsForLead(extract, lead) {
  const out = sanitizeExtractSocials(extract);
  for (const platform of ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok']) {
    if (!out[platform]) continue;
    if (!isLikelyBusinessSocialUrl(out[platform], platform, lead)) {
      delete out[platform];
    }
  }
  return out;
}

function buildRejectedSocialCleanupPatch(lead) {
  const patch = {};
  for (const platform of ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok']) {
    const value = String((lead && lead[platform]) || '').trim();
    if (!value || value === 'N/A') continue;
    if (!isLikelyBusinessSocialUrl(value, platform, lead)) {
      patch[platform] = '';
    }
  }
  return patch;
}

function normalizePlainHandle(handle, platform) {
  const h = String(handle || '')
    .trim()
    .replace(/^@/, '')
    .replace(/\/$/, '');
  if (!h || !/^[\w.-]+$/.test(h) || h.length < 3) return '';
  const build = PLATFORM_BASE[platform];
  if (!build) return '';
  return finalizeSocialUrl(build(h), platform);
}

/**
 * @param {string} raw
 * @param {'facebook'|'instagram'|'twitter'|'linkedin'|'tiktok'} [platform]
 * @returns {string} Normalized URL or '' if invalid
 */
function normalizeSocialUrl(raw, platform) {
  if (isPlaceholder(raw)) return '';
  let s = String(raw).trim();

  if (looksLikeLocationNotUrl(s)) return '';

  if (s.includes(',') && !/^https?:\/\/[^,?#]+/i.test(s)) {
    const parts = s
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      const normalized = normalizeSocialUrl(part, platform);
      if (normalized) return normalized;
    }
    return '';
  }

  if (/^@[\w.-]+$/.test(s)) {
    return normalizePlainHandle(s, platform);
  }

  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w.-]+\.[a-z]{2,}/i.test(s) || s.includes('/')) {
      s = `https://${s.replace(/^\/\//, '')}`;
    } else if (/^[\w.-]+$/.test(s)) {
      return normalizePlainHandle(s, platform);
    } else {
      return '';
    }
  }

  return finalizeSocialUrl(s, platform);
}

/**
 * Sanitize snake_case extract fields from enrichment providers.
 * @param {object} extract
 * @returns {object}
 */
function sanitizeExtractSocials(extract) {
  if (!extract || typeof extract !== 'object') return extract || {};
  const out = { ...extract };
  const pairs = [
    ['facebook', 'facebook'],
    ['instagram', 'instagram'],
    ['twitter', 'twitter'],
    ['linkedin', 'linkedin'],
    ['tiktok', 'tiktok'],
  ];
  for (const [key, platform] of pairs) {
    if (out[key] === undefined) continue;
    const normalized = normalizeSocialUrl(out[key], platform);
    if (normalized) out[key] = normalized;
    else delete out[key];
  }
  return out;
}

/**
 * Sanitize camelCase lead patch fields before persist.
 * @param {object} patch
 * @returns {object}
 */
function sanitizeLeadSocialPatch(patch) {
  if (!patch || typeof patch !== 'object') return patch || {};
  const out = { ...patch };
  const pairs = [
    ['facebook', 'facebook'],
    ['instagram', 'instagram'],
    ['twitter', 'twitter'],
    ['linkedin', 'linkedin'],
    ['tiktok', 'tiktok'],
  ];
  for (const [key, platform] of pairs) {
    if (out[key] === undefined) continue;
    const normalized = normalizeSocialUrl(out[key], platform);
    if (normalized) out[key] = normalized;
    else delete out[key];
  }
  return out;
}

module.exports = {
  PLATFORM_HOSTS,
  isPlaceholder,
  normalizeSocialUrl,
  isLikelyBusinessSocialUrl,
  sanitizeExtractSocials,
  sanitizeExtractSocialsForLead,
  buildRejectedSocialCleanupPatch,
  sanitizeLeadSocialPatch,
};
