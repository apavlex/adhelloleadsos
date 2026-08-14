/**
 * Cheap contact extract from business sites before paid Firecrawl (Requests/Cheerio + optional Puppeteer).
 */

const { scrapePage } = require('./pageScraper');
const { detectTechSignalsFromHtml, mergeHtmlTechIntoExtract } = require('./techSignals');
const { isValidEmailForGhl } = require('./ghlClient');

/** Site-builder / analytics inboxes that leak into scraped HTML but never belong to the business. */
const VENDOR_EMAIL_DOMAINS = new Set([
  'bluehost.com',
  'canva.com',
  'cloudflare.com',
  'elementor.com',
  'godaddy.com',
  'hostgator.com',
  'hubspot.com',
  'sentry.io',
  'shopify.com',
  'squarespace.com',
  'weebly.com',
  'webflow.com',
  'webflow.io',
  'wix.com',
  'wixpress.com',
  'wordpress.com',
  'wordpress.org',
]);

const FREE_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'ymail.com',
]);

const ROLE_LOCAL_RE = /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|privacy|dmca|unsubscribe)\b/;

/** Contact-ish paths worth one extra fetch when the homepage hides the email behind a form. */
const CONTACT_PATH_RE = /(contact|contact-us|contactus|get-a-quote|get-in-touch|about|about-us|estimate|quote|support)/i;

function truthyEnv(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function localScrapeEnrichEnabled(integrationEnv) {
  const ws = integrationEnv && integrationEnv.ENRICH_TRY_LOCAL_SCRAPE;
  if (ws != null && String(ws).trim() !== '') return truthyEnv(ws);
  return truthyEnv(process.env.ENRICH_TRY_LOCAL_SCRAPE ?? '1');
}

function emailDomain(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at <= 0) return '';
  return s.slice(at + 1).replace(/^www\./, '');
}

function hostFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

function isContactableEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  if (!isValidEmailForGhl(s)) return false;
  const domain = emailDomain(s);
  if (!domain || VENDOR_EMAIL_DOMAINS.has(domain)) return false;
  if ([...VENDOR_EMAIL_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return false;
  const local = s.slice(0, s.lastIndexOf('@'));
  if (ROLE_LOCAL_RE.test(local)) return false;
  if (/^[0-9a-f]{24,}$/i.test(local)) return false;
  return true;
}

/**
 * Footer/mailto emails come in mixed with vendor noise; prefer the business domain,
 * then a real inbox on a free provider (very common for local contractors).
 * @param {string[]|string} candidates
 * @param {{ website?: string }} [opts]
 */
function pickBestEmail(candidates, opts = {}) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const siteHost = hostFromUrl(opts.website);
  const siteRoot = siteHost.split('.').slice(-2).join('.');
  let best = '';
  let bestScore = -1;

  for (const raw of list) {
    const email = String(raw || '').trim().toLowerCase();
    if (!isContactableEmail(email)) continue;
    const domain = emailDomain(email);
    let score = 1;
    if (siteRoot && (domain === siteHost || domain === siteRoot || domain.endsWith(`.${siteRoot}`))) {
      score = 3;
    } else if (FREE_EMAIL_DOMAINS.has(domain)) {
      score = 2;
    }
    if (score > bestScore) {
      best = email;
      bestScore = score;
    }
  }
  return best;
}

function contactsToExtract(contacts, opts = {}) {
  if (!contacts) return {};
  const emailCandidates = [
    ...(contacts.email ? [contacts.email] : []),
    ...(Array.isArray(contacts.emails) ? contacts.emails : []),
  ];
  const out = {
    email: pickBestEmail(emailCandidates, { website: opts.website || contacts.website }),
    phone: contacts.phone || contacts.phones?.[0] || '',
    address: contacts.address || '',
    business_name: contacts.businessName || '',
  };
  // Empty strings would otherwise shadow provider values during merges.
  for (const [k, v] of Object.entries(out)) {
    if (!String(v || '').trim()) delete out[k];
  }
  return out;
}

/**
 * Same-host contact/about links from raw HTML, ranked so /contact wins over /about.
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} [limit]
 */
function discoverContactPageUrls(html, baseUrl, limit = 2) {
  const base = String(baseUrl || '').trim();
  const host = hostFromUrl(base);
  if (!host) return [];
  const baseAbsolute = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  const hrefRe = /href\s*=\s*["']([^"'#]+)["']/gi;
  const scored = [];
  const seen = new Set();
  let m;

  while ((m = hrefRe.exec(String(html || ''))) !== null) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseAbsolute);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (hostFromUrl(abs.href) !== host) continue;
    const path = abs.pathname.toLowerCase();
    if (path === '/' || /\.(jpe?g|png|gif|svg|webp|pdf|css|js|zip)$/i.test(path)) continue;
    if (!CONTACT_PATH_RE.test(path)) continue;
    abs.hash = '';
    const clean = abs.href;
    if (seen.has(clean)) continue;
    seen.add(clean);
    scored.push({ url: clean, score: /contact|get-in-touch/i.test(path) ? 2 : 1 });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.url);
}

/**
 * @param {string} url
 * @returns {Promise<{ extract: object, html: string|null, method: string }|null>}
 */
async function extractFromLocalScrape(url) {
  const page = await scrapePage(url, { preferDynamic: false });
  if (!page.ok || !page.html) return null;

  const base = contactsToExtract(page.contacts, { website: page.url || url });
  const signals = detectTechSignalsFromHtml(page.html, page.url || url);
  const extract = mergeHtmlTechIntoExtract(base, signals);
  return {
    extract,
    html: page.html,
    method: page.method || 'static',
    contacts: page.contacts || null,
  };
}

/**
 * Server-side website email hunt: homepage first, then up to `maxContactPages`
 * contact/about pages. No Chrome extension and no user visit required.
 * @param {string} url
 * @param {{ maxContactPages?: number }} [opts]
 * @returns {Promise<{ email: string, phone: string, source: string, pagesTried: string[] }>}
 */
async function findWebsiteContactEmail(url, opts = {}) {
  const maxContactPages = Number.isFinite(opts.maxContactPages) ? opts.maxContactPages : 2;
  const pagesTried = [];
  const result = { email: '', phone: '', source: '', pagesTried };

  let home = null;
  try {
    home = await extractFromLocalScrape(url);
  } catch (e) {
    console.warn('[localPageExtract] homepage scrape failed:', e && e.message);
  }
  pagesTried.push(String(url || ''));
  if (home && home.extract) {
    if (home.extract.email) {
      result.email = home.extract.email;
      result.source = 'website_home';
    }
    if (home.extract.phone) result.phone = home.extract.phone;
  }
  if (result.email || !home || !home.html || maxContactPages <= 0) return result;

  for (const pageUrl of discoverContactPageUrls(home.html, url, maxContactPages)) {
    pagesTried.push(pageUrl);
    try {
      const page = await scrapePage(pageUrl, { preferDynamic: false });
      if (!page.ok || !page.contacts) continue;
      const extract = contactsToExtract(page.contacts, { website: url });
      if (extract.email) {
        result.email = extract.email;
        result.source = 'website_contact_page';
        if (!result.phone && extract.phone) result.phone = extract.phone;
        return result;
      }
      if (!result.phone && extract.phone) result.phone = extract.phone;
    } catch (e) {
      console.warn(`[localPageExtract] contact page scrape failed (${pageUrl}):`, e && e.message);
    }
  }

  return result;
}

module.exports = {
  extractFromLocalScrape,
  findWebsiteContactEmail,
  discoverContactPageUrls,
  isContactableEmail,
  localScrapeEnrichEnabled,
  pickBestEmail,
  contactsToExtract,
};
