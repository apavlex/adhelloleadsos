/**
 * RapidAPI website contacts & socials scraper (second RapidAPI product — separate from Maps search).
 * Configure host + endpoint from your API's RapidAPI page under Workspace → Integrations.
 */
const { normalizeSocialUrl } = require('./socialUrlNormalize');
const { firecrawlExtractToLeadUpdates } = require('./enrichmentNormalize');

const DEFAULT_URL_PARAM = 'url';

function hostFromEndpointUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    return new URL(urlStr.trim()).hostname || '';
  } catch {
    return '';
  }
}

function mapsApiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_KEY || '').trim();
}

function apiKey(integrationEnv) {
  const dedicated = integrationEnv && integrationEnv.RAPIDAPI_WEBSITE_KEY;
  if (typeof dedicated === 'string' && dedicated.trim()) return dedicated.trim();
  return mapsApiKey(integrationEnv);
}

function endpoint(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_WEBSITE_ENDPOINT;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.RAPIDAPI_WEBSITE_ENDPOINT || '').trim();
}

function apiHost(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_WEBSITE_HOST;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  const fromEnv = process.env.RAPIDAPI_WEBSITE_HOST;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const fromEndpoint = hostFromEndpointUrl(endpoint(integrationEnv));
  if (fromEndpoint) return fromEndpoint;
  return '';
}

function urlParam(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.RAPIDAPI_WEBSITE_URL_PARAM;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  const fromEnv = process.env.RAPIDAPI_WEBSITE_URL_PARAM;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_URL_PARAM;
}

function httpMethod(integrationEnv) {
  const raw = String(
    (integrationEnv && integrationEnv.RAPIDAPI_WEBSITE_METHOD) ||
      process.env.RAPIDAPI_WEBSITE_METHOD ||
      'GET',
  )
    .trim()
    .toUpperCase();
  return raw === 'POST' ? 'POST' : 'GET';
}

function isConfigured(integrationEnv) {
  return Boolean(apiKey(integrationEnv) && endpoint(integrationEnv) && apiHost(integrationEnv));
}

function hasValue(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' && s !== '—';
}

function normalizeWebsiteUrl(raw) {
  const s = String(raw || '').trim();
  if (!hasValue(s)) return '';
  try {
    const u = s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`;
    return new URL(u).href;
  } catch {
    return '';
  }
}

function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(v || '').trim());
}

function looksLikePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function pickSocialUrl(value, network) {
  if (!hasValue(value)) return '';
  const s = String(value).trim();
  if (/^https?:\/\//i.test(s)) return normalizeSocialUrl(s, network) || s;
  if (s.startsWith('@')) return '';
  return normalizeSocialUrl(s, network) || '';
}

function socialNetworkFromKey(key) {
  const k = String(key || '').toLowerCase();
  if (k.includes('facebook') || k === 'fb') return 'facebook';
  if (k.includes('instagram') || k === 'ig') return 'instagram';
  if (k.includes('linkedin')) return 'linkedin';
  if (k.includes('twitter') || k === 'x' || k.includes('x.com')) return 'twitter';
  if (k.includes('tiktok')) return 'tiktok';
  if (k.includes('youtube')) return 'youtube';
  if (k.includes('yelp')) return 'yelp';
  return '';
}

function collectFromNode(node, acc, depth) {
  if (depth > 8 || node == null) return;
  if (typeof node === 'string') {
    const s = node.trim();
    if (looksLikeEmail(s)) acc.emails.add(s);
    else if (looksLikePhone(s)) acc.phones.add(s);
    else if (/^https?:\/\//i.test(s) && /facebook|instagram|linkedin|twitter|x\.com|tiktok|youtube|yelp/i.test(s)) {
      acc.urls.add(s);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectFromNode(item, acc, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    const lk = String(key).toLowerCase();
    const network = socialNetworkFromKey(lk);

    if (network && hasValue(value)) {
      const url = pickSocialUrl(value, network);
      if (url) acc.socials[network] = url;
    }

    if (lk.includes('email') && hasValue(value)) {
      if (Array.isArray(value)) value.forEach((v) => collectFromNode(v, acc, depth + 1));
      else if (looksLikeEmail(value)) acc.emails.add(String(value).trim());
      else collectFromNode(value, acc, depth + 1);
      continue;
    }

    if (
      (lk.includes('phone') || lk.includes('mobile') || lk.includes('tel')) &&
      hasValue(value)
    ) {
      if (Array.isArray(value)) value.forEach((v) => collectFromNode(v, acc, depth + 1));
      else if (looksLikePhone(value)) acc.phones.add(String(value).trim());
      else collectFromNode(value, acc, depth + 1);
      continue;
    }

    if (
      lk.includes('social') ||
      lk.includes('contact') ||
      lk.includes('link') ||
      lk === 'data' ||
      lk === 'result' ||
      lk === 'results'
    ) {
      collectFromNode(value, acc, depth + 1);
      continue;
    }

    collectFromNode(value, acc, depth + 1);
  }
}

function parsePayloadToExtract(payload) {
  const acc = { emails: new Set(), phones: new Set(), socials: {}, urls: new Set() };
  collectFromNode(payload, acc, 0);

  for (const url of acc.urls) {
    const network = socialNetworkFromKey(url);
    if (network && !acc.socials[network]) {
      const normalized = pickSocialUrl(url, network);
      if (normalized) acc.socials[network] = normalized;
    }
  }

  const extract = {};
  const email = [...acc.emails][0];
  const phone = [...acc.phones][0];
  if (email) extract.email = email;
  if (phone) extract.phone = phone;
  for (const [network, url] of Object.entries(acc.socials)) {
    extract[network] = url;
  }
  return extract;
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.msg)) ||
      text.slice(0, 200) ||
      `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

/**
 * @param {string} websiteUrl
 * @param {Record<string, string>|null|undefined} integrationEnv
 */
async function scrapeWebsite(websiteUrl, integrationEnv) {
  if (!isConfigured(integrationEnv)) {
    throw new Error(
      'RapidAPI website enrich is not configured. Set endpoint + host under Workspace → Integrations → RapidAPI Website.',
    );
  }
  const target = normalizeWebsiteUrl(websiteUrl);
  if (!target) throw new Error('Lead needs a valid website URL to enrich.');

  const baseEndpoint = endpoint(integrationEnv);
  const host = apiHost(integrationEnv);
  const key = apiKey(integrationEnv);
  const param = urlParam(integrationEnv);
  const method = httpMethod(integrationEnv);

  const headers = {
    'x-rapidapi-key': key,
    'x-rapidapi-host': host,
    accept: 'application/json',
  };

  const paramAttempts =
    param === DEFAULT_URL_PARAM ? [DEFAULT_URL_PARAM, 'domain', 'website', 'site'] : [param];

  let lastError = null;
  for (const qp of paramAttempts) {
    try {
      let payload;
      if (method === 'POST') {
        const u = new URL(baseEndpoint);
        payload = await requestJson(u.toString(), {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ [qp]: target }),
        });
      } else {
        const u = new URL(baseEndpoint);
        u.searchParams.set(qp, target);
        payload = await requestJson(u.toString(), { method: 'GET', headers });
      }
      const extract = parsePayloadToExtract(payload);
      if (Object.keys(extract).length) {
        return { extract, payload, urlParamUsed: qp };
      }
      lastError = new Error('API returned no contacts or social links.');
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('RapidAPI website enrich returned no data.');
}

function buildLeadPatch(lead, extract) {
  const patch = {};
  const base = firecrawlExtractToLeadUpdates(extract);
  if (!hasValue(lead.email) && (extract.email || base.email)) patch.email = extract.email || base.email;
  if (!hasValue(lead.phone) && (extract.phone || base.phone)) patch.phone = extract.phone || base.phone;
  if (!hasValue(lead.facebook) && (extract.facebook || base.facebook)) {
    patch.facebook = extract.facebook || base.facebook;
  }
  if (!hasValue(lead.instagram) && (extract.instagram || base.instagram)) {
    patch.instagram = extract.instagram || base.instagram;
  }
  if (!hasValue(lead.twitter) && (extract.twitter || base.twitter)) patch.twitter = extract.twitter || base.twitter;
  if (!hasValue(lead.linkedin) && (extract.linkedin || base.linkedin)) {
    patch.linkedin = extract.linkedin || base.linkedin;
  }
  if (!hasValue(lead.tiktok) && (extract.tiktok || base.tiktok)) patch.tiktok = extract.tiktok || base.tiktok;
  return patch;
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 */
async function enrichLeadFromWebsite(lead, integrationEnv) {
  const website = normalizeWebsiteUrl(lead && (lead.website || lead.url));
  if (!website) {
    return { used: false, patch: {}, extract: {}, error: 'no_website', filled: [] };
  }
  if (!isConfigured(integrationEnv)) {
    return { used: false, patch: {}, extract: {}, error: 'not_configured', filled: [] };
  }

  const { extract } = await scrapeWebsite(website, integrationEnv);
  const patch = buildLeadPatch(lead || {}, extract);
  const filled = Object.keys(patch);
  return {
    used: filled.length > 0,
    patch,
    extract,
    filled,
    website,
    error: filled.length ? null : 'no_new_fields',
  };
}

function leadCanEnrichFromWebsite(lead) {
  return !!normalizeWebsiteUrl(lead && (lead.website || lead.url));
}

module.exports = {
  isConfigured,
  scrapeWebsite,
  enrichLeadFromWebsite,
  leadCanEnrichFromWebsite,
  parsePayloadToExtract,
  normalizeWebsiteUrl,
  apiKey,
  apiHost,
  endpoint,
};
