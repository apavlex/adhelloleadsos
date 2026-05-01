/** Bump when `computeHealth100` / gap rules change so re-audits stay comparable. */
const AUDIT_RUBRIC_VERSION = 'rubric_v1.2';

const SIGNAL_PHRASES = [
  'book online',
  'free quote',
  'request appointment',
  'schedule consultation',
];

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'N/A') return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.toString();
  } catch {
    return '';
  }
}

function extractEmails(text) {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(m.map((x) => x.toLowerCase())));
}

/** Drop Wix/Sentry noise, noreply, and hex-only local parts often scraped from runtime bundles. */
function filterContactEmails(list) {
  const raw = Array.isArray(list) ? list : [];
  return raw
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => {
      if (!e || !e.includes('@')) return false;
      const [local, host] = e.split('@');
      if (!host) return false;
      const h = host.replace(/^www\./, '');
      if (h.includes('sentry') && (h.includes('wix') || h.endsWith('wixpress.com'))) return false;
      if (h === 'sentry.io' || h.endsWith('.sentry.io')) return false;
      if (/^noreply|no-reply|donotreply|mailer-daemon/.test(local)) return false;
      if (/^[0-9a-f]{24,}$/i.test(local)) return false;
      return true;
    });
}

function extractPhones(text) {
  const m = String(text || '').match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) || [];
  const normalized = m
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function firstMatch(re, text) {
  const m = re.exec(text);
  return m && m[1] ? String(m[1]).trim() : '';
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSignals(text) {
  const t = String(text || '').toLowerCase();
  return SIGNAL_PHRASES.filter((p) => t.includes(p));
}

async function fetchWithTiming(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'AdHelloBot/1.0 (+website analysis)' },
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      html: body,
      loadSeconds: (Date.now() - started) / 1000,
      error: '',
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      html: '',
      loadSeconds: (Date.now() - started) / 1000,
      error: e && e.message ? String(e.message) : 'Fetch failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPreferredLinks(rootUrl, html) {
  const out = [];
  const root = new URL(rootUrl);
  const preferredPaths = ['/', '/contact', '/about', '/team', '/services'];
  preferredPaths.forEach((p) => out.push(new URL(p, root).toString()));
  const hrefs = String(html || '').match(/href\s*=\s*["']([^"']+)["']/gi) || [];
  for (const frag of hrefs) {
    const raw = frag.replace(/^href\s*=\s*["']?/i, '').replace(/["']$/g, '');
    try {
      const u = new URL(raw, root);
      if (u.hostname !== root.hostname) continue;
      const path = (u.pathname || '/').toLowerCase();
      if (preferredPaths.some((p) => path.startsWith(p))) out.push(u.toString());
    } catch {}
  }
  return Array.from(new Set(out)).slice(0, 5);
}

/** 100 = healthy / complete; lower = more gaps (internal only). */
function computeHealth100(a) {
  let score = 100;
  if (a.flags && a.flags.noSsl) score -= 30;
  if (a.flags && a.flags.slowLoad) score -= 20;
  if (a.flags && a.flags.returned404) score -= 35;
  if (!a.mobileResponsive) score -= 10;
  const meta = String(a.metaDescription || '').trim();
  if (!meta) score -= 22;
  const title = String(a.pageTitle || '').trim();
  if (!title || title.length < 2) score -= 12;
  if (!a.emails || a.emails.length === 0) score -= 5;
  if (!a.phones || a.phones.length === 0) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 0–10 audit gap for pipeline badges (higher = more to fix). */
function computeWebsiteGapScore10(a) {
  const h = computeHealth100(a);
  return Math.min(10, Math.max(0, Math.round((100 - h) / 10)));
}

/**
 * Ordered rubric gap labels for client summaries (not the full weighted breakdown).
 * @param {number} maxLabels
 */
function computeTopGapLabels(a, maxLabels) {
  const cap = Math.min(10, Math.max(1, Number(maxLabels) || 3));
  const out = [];
  const flags = (a && a.flags) || {};
  const meta = String((a && a.metaDescription) || '').trim();
  const title = String((a && a.pageTitle) || '').trim();
  const emails = (a && a.emails) || [];
  const phones = (a && a.phones) || [];
  const signals = (a && a.signals) || [];
  const copyYear = Number(String((a && a.copyrightYear) || '').trim());
  const nowYear = new Date().getFullYear();

  const push = (label) => {
    if (out.length >= cap) return;
    if (label && !out.includes(label)) out.push(label);
  };

  if (flags.returned404) push('Homepage availability (404)');
  if (flags.noSsl) push('HTTPS / SSL');
  if (!meta) push('Meta description');
  if (flags.slowLoad) push('Homepage load speed');
  if (!a.mobileResponsive) push('Mobile viewport / responsiveness');
  if (Number.isFinite(copyYear) && copyYear < nowYear - 1) push('Copyright / freshness signal');
  if (!signals.length) push('Above-the-fold call to action');
  if (!title || title.length < 2) push('Page title strength');
  if ((!emails || !emails.length) && (!phones || !phones.length)) push('Visible contact info');

  if (!out.length) push('No major crawl gaps flagged');
  return out.slice(0, cap);
}

function finalizeAuditRecord(base) {
  const b = base || {};
  b.siteHealth100 = computeHealth100(b);
  b.analysisScore = computeWebsiteGapScore10(b);
  b.rubricVersion = AUDIT_RUBRIC_VERSION;
  b.auditedAt = new Date().toISOString();
  b.topGapLabels = computeTopGapLabels(b, 5);
  return b;
}

/** Attach prior snapshot when re-running an audit (retainer / progress story). */
function mergePriorAuditSnapshot(next, prior) {
  if (!prior || typeof prior !== 'object' || !next || typeof next !== 'object') return next;
  const ts = prior.auditedAt || prior.audited_at;
  if (!ts) return next;
  const prevH = Number(prior.siteHealth100);
  if (!Number.isFinite(prevH)) return next;
  next.priorAuditSnapshot = {
    siteHealth100: Math.min(100, Math.max(0, Math.round(prevH))),
    auditedAt: String(ts),
    rubricVersion: prior.rubricVersion || prior.rubric_version || null,
  };
  return next;
}

function buildOwnerSignal(lead, analysis) {
  const a = analysis || {};
  const l = lead || {};
  const website = String(l.website || '').trim();
  const category = String(l.categoryName || '').toLowerCase();
  const reviews = Number(l.reviewsCount || 0);
  const load = Number(a.pageLoadSeconds || 0);
  const hasMeta = Boolean(String(a.metaDescription || '').trim());
  const hasSignals = Array.isArray(a.signals) && a.signals.length > 0;
  const copyYear = Number(String(a.copyrightYear || '').trim());
  const nowYear = new Date().getFullYear();

  if (!website || website === 'N/A') {
    return 'No website is attached to your Google profile, so search traffic has nowhere to convert.';
  }
  if (a.flags && a.flags.returned404) {
    return 'Your website is returning a 404 right now, which makes the business look closed to new customers.';
  }
  if (a.flags && a.flags.noSsl) {
    return 'Your site is not using HTTPS, so browsers can mark it as not secure before people even call.';
  }
  if (load > 5) {
    return `Your site is loading in about ${load.toFixed(1)} seconds, which is likely costing mobile conversions.`;
  }
  if (!hasMeta) {
    return 'You are losing click-throughs to competitors: your homepage has no meta description, so Google is guessing how to pitch your business instead of showing a line you control.';
  }
  if (copyYear && copyYear < nowYear - 1) {
    return `Your footer still says ${copyYear}, which can make the business feel inactive or out of date.`;
  }
  if ((category.includes('contractor') || category.includes('service') || category.includes('repair')) && !hasSignals) {
    return 'You are likely losing booked jobs: there is no clear "book online" or "request appointment" action above the fold, so ready buyers bounce to the next listing.';
  }
  if (reviews > 0 && reviews < 20) {
    return `You only have ${reviews} Google reviews, which makes trust harder compared to stronger local competitors.`;
  }
  if ((a.emails || []).length === 0 && (a.phones || []).length === 0) {
    return 'Your website does not clearly expose contact info, which creates friction for people trying to reach you.';
  }
  return 'Your online presence is decent, but your offer and call-to-action are not obvious enough to convert cold traffic fast.';
}

async function analyzeWebsite(rawWebsite) {
  const websiteUrl = normalizeUrl(rawWebsite);
  const base = {
    websiteUrl,
    crawledPages: [],
    pageTitle: '',
    metaDescription: '',
    hasHttps: false,
    pageLoadSeconds: 0,
    mobileResponsive: false,
    copyrightYear: '',
    emails: [],
    phones: [],
    signals: [],
    flags: { returned404: false, slowLoad: false, noSsl: false },
    analysisScore: 0, // 0–10 website audit gap (not “health 100”)
    error: '',
  };
  if (!websiteUrl) {
    base.error = 'No valid website URL';
    base.siteHealth100 = 0;
    base.analysisScore = 10;
    base.rubricVersion = AUDIT_RUBRIC_VERSION;
    base.auditedAt = new Date().toISOString();
    base.topGapLabels = ['Valid public website URL'];
    return base;
  }

  const home = await fetchWithTiming(websiteUrl);
  base.crawledPages.push(home.url);
  base.pageLoadSeconds = Number(home.loadSeconds.toFixed(2));
  base.hasHttps = /^https:\/\//i.test(home.url || websiteUrl);
  base.flags.noSsl = !base.hasHttps;
  base.flags.returned404 = home.status === 404;
  base.flags.slowLoad = base.pageLoadSeconds > 5;
  if (!home.ok && !home.html) {
    base.error = home.error || `HTTP ${home.status}`;
    return finalizeAuditRecord(base);
  }

  const links = buildPreferredLinks(home.url || websiteUrl, home.html);
  const pages = [];
  for (const link of links.slice(0, 5)) {
    const r = link === home.url || link === websiteUrl ? home : await fetchWithTiming(link);
    pages.push(r);
    if (!base.crawledPages.includes(r.url)) base.crawledPages.push(r.url);
  }

  const mergedHtml = pages.map((p) => p.html || '').join('\n');
  const mergedText = stripTags(mergedHtml);
  base.emails = filterContactEmails(extractEmails(mergedHtml));
  base.phones = extractPhones(mergedText);
  base.pageTitle = firstMatch(/<title[^>]*>([^<]+)<\/title>/i, home.html);
  base.metaDescription = firstMatch(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    home.html
  );
  if (!base.metaDescription) {
    base.metaDescription = firstMatch(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      home.html
    );
  }
  base.mobileResponsive = /<meta[^>]+name=["']viewport["']/i.test(home.html);
  base.signals = parseSignals(mergedText);
  base.copyrightYear = firstMatch(/copyright[^0-9]*(20\d{2}|19\d{2})/i, mergedText);
  if (!base.copyrightYear) base.copyrightYear = firstMatch(/\b(20\d{2}|19\d{2})\b/i, mergedText);
  return finalizeAuditRecord(base);
}

/** Best single address for client-facing lines (after noise filter). */
function pickPrimaryEmail(emails) {
  const list = filterContactEmails(emails || []);
  if (!list.length) return '';
  const preferLocal = (prefix) => list.find((e) => e.startsWith(prefix + '@'));
  for (const p of ['info', 'contact', 'hello', 'sales', 'office', 'support', 'team']) {
    const hit = preferLocal(p);
    if (hit) return hit;
  }
  return [...list].sort((a, b) => a.length - b.length)[0];
}

module.exports = {
  AUDIT_RUBRIC_VERSION,
  analyzeWebsite,
  buildOwnerSignal,
  filterContactEmails,
  pickPrimaryEmail,
  mergePriorAuditSnapshot,
  computeTopGapLabels,
};

