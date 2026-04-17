/**
 * Lightweight homepage HTML signals (complements Firecrawl extract — good for Wix/Webflow/Shopify + widget detection).
 * Not a replacement for BuiltWith/Wappalyzer APIs; pair with FIRECRAWL_API_KEY + optional paid tech APIs later.
 */

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 450000;

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!u.startsWith('http')) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * @returns {{ cms_platform: string|null, tech_stack_tags: string[], html_chat_widget_detected: boolean|null }}
 */
function detectTechSignalsFromHtml(html, _url) {
  if (!html || typeof html !== 'string') {
    return { cms_platform: null, tech_stack_tags: [], html_chat_widget_detected: null };
  }

  const lower = html.toLowerCase();
  const tags = new Set();

  const tests = [
    ['wix', /wix\.com|wixstatic|wix-code|x-wix|wix\.site/i],
    ['squarespace', /squarespace\.com|static1\.squarespace/i],
    ['shopify', /cdn\.shopify\.com|shopify\.com\/s\/files|Shopify\.theme/i],
    ['webflow', /webflow\.com|website-files\.com\/.*webflow/i],
    ['wordpress', /wp-content\/|wp-includes\/|xmlrpc\.php|generator[^\n]*wordpress/i],
    ['ghost', /ghost\.org\/|ghost\.io\//i],
    ['framer', /framerusercontent|framer\.com\/m\//i],
    ['nextjs', /__NEXT_DATA__|next\/font/i],
    ['react', /react-dom|data-reactroot/i],
  ];

  for (const [name, re] of tests) {
    if (re.test(html) || re.test(lower)) tags.add(name);
  }

  const cmsPriority = ['shopify', 'wix', 'squarespace', 'webflow', 'wordpress', 'ghost', 'framer'];
  let cms_platform = null;
  for (const id of cmsPriority) {
    if (tags.has(id)) {
      cms_platform = id;
      break;
    }
  }

  const chatRes = [
    [/intercom\.io|widget\.intercom/i, 'intercom'],
    [/drift\.com|driftt\.com/i, 'drift'],
    [/tidio/i, 'tidio'],
    [/zendesk\.com\/widget|zdassets/i, 'zendesk'],
    [/hubspot.*chat|hs-scripts/i, 'hubspot_chat'],
    [/crisp\.chat/i, 'crisp'],
    [/olark\.com/i, 'olark'],
    [/livechatinc/i, 'livechat'],
    [/tawk\.to/i, 'tawk'],
    [/genesys|purecloud/i, 'genesys'],
  ];

  let html_chat_widget_detected = null;
  for (const [re, vendor] of chatRes) {
    if (re.test(html)) {
      html_chat_widget_detected = true;
      tags.add(`chat:${vendor}`);
      break;
    }
  }

  const analytics = [
    [/googletagmanager\.com|gtag\(|GTM-/i, 'google_tag_manager'],
    [/facebook\.net\/.*fbevents|fbq\(/i, 'meta_pixel'],
    [/linkedin\.com\/px/i, 'linkedin_pixel'],
    [/hotjar/i, 'hotjar'],
    [/segment\.com|analytics\.js/i, 'segment'],
  ];
  for (const [re, tag] of analytics) {
    if (re.test(html)) tags.add(tag);
  }

  return {
    cms_platform,
    tech_stack_tags: [...tags],
    html_chat_widget_detected,
  };
}

async function fetchHomepageHtml(url) {
  const absolute = normalizeUrl(url);
  if (!absolute) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(absolute, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AdHelloLeadBot/1.0; +https://adhello.ai) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Merges regex-based tech signals into Firecrawl extract without overwriting LLM booleans when already set.
 */
function mergeHtmlTechIntoExtract(extract, htmlSignals) {
  const out = { ...(extract || {}) };

  if (htmlSignals.cms_platform && !out.cms_platform) {
    out.cms_platform = htmlSignals.cms_platform;
  }

  const rawTags = out.tech_stack_tags;
  const existingTags = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const merged = new Set([
    ...existingTags.map(String),
    ...(htmlSignals.tech_stack_tags || []).map(String),
  ]);
  out.tech_stack_tags = [...merged];

  // Only affirm chat from HTML patterns — many widgets load async; absence is not proof.
  if (
    htmlSignals.html_chat_widget_detected === true &&
    out.has_chatbot !== true &&
    out.has_chatbot !== false
  ) {
    out.has_chatbot = true;
  }

  return out;
}

module.exports = {
  detectTechSignalsFromHtml,
  fetchHomepageHtml,
  mergeHtmlTechIntoExtract,
  normalizeUrl,
};
