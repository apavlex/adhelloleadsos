/**
 * Human-readable name for a website / Lead Connector form lead.
 * GHL often stamps contact.source as "Direct", "AI Studio", etc. — those are
 * attribution crumbs, not form names. Prefer a real form title, else the
 * business website host ("tprflooring.com Form"), else "Website form".
 */

const ATTRIBUTION_JUNK = new Set([
  'direct',
  'organic',
  'referral',
  'ai_studio',
  'ai studio',
  'aistudio',
  'leadconnector',
  'lead connector',
  'api',
  'manual',
  'import',
  'csv',
  'chat',
  'sms',
  'call',
  'phone',
  'email',
  'unknown',
  'null',
  'undefined',
  'other',
  'none',
  'n/a',
  'na',
  '-',
  'facebook',
  'instagram',
  'google',
  'meta',
  'ads',
  'ad',
  'paid',
  'cpc',
  'ppc',
]);

function clean(value, max = 140) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function primarySegment(value) {
  return clean(String(value || '').split('·')[0].split('|')[0]);
}

function looksLikeRealFormName(name) {
  const n = clean(name);
  if (!n || n.length < 2) return false;
  if (ATTRIBUTION_JUNK.has(n.toLowerCase())) return false;
  // Bare GHL sessionSource / source tokens.
  if (/^(direct|organic|ai[_\s-]?studio)$/i.test(n)) return false;
  return true;
}

/** Hostname from a URL or bare domain (no protocol). Preserves brand casing when present. */
function hostFromWebsite(urlOrHost) {
  const raw = clean(urlOrHost, 500);
  if (!raw) return '';
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, '');
    if (!host || !host.includes('.')) return '';
    // Prefer casing from the original string when it wasn't all-lowercase.
    const lower = host.toLowerCase();
    const fromRaw = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
    if (fromRaw && fromRaw.toLowerCase() === lower && /[A-Z]/.test(fromRaw)) return fromRaw;
    return lower;
  } catch (_) {
    const bare = raw.replace(/^www\./i, '').split('/')[0];
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(bare)) return bare;
    return '';
  }
}

/**
 * @param {{
 *   formName?: string,
 *   label?: string,
 *   websiteUrl?: string,
 *   businessName?: string,
 *   companyName?: string,
 * }} [opts]
 * @returns {string}
 */
function websiteFormLabel(opts = {}) {
  const candidates = [opts.formName, opts.label]
    .map((v) => primarySegment(v))
    .filter(Boolean);
  for (const c of candidates) {
    if (looksLikeRealFormName(c)) return c;
  }

  const host = hostFromWebsite(opts.websiteUrl);
  if (host) {
    const pretty = /[A-Z]/.test(host) ? host : host.replace(/^(.)/, (ch) => ch.toUpperCase());
    return `${pretty} Form`;
  }

  const biz = clean(opts.businessName || opts.companyName, 80);
  if (biz) return `${biz} website form`;
  return 'Website form';
}

module.exports = {
  websiteFormLabel,
  looksLikeRealFormName,
  hostFromWebsite,
  ATTRIBUTION_JUNK,
};
