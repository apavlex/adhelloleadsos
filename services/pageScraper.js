const { fetchStaticHtml, normalizeUrl } = require('./staticHtmlFetch');
const { scrapeDynamicHtml } = require('./browserScraper');
const { parsePageContacts, parseDirectoryListings } = require('./cheerioParser');

const DIRECTORY_HOSTS = /(?:yelp\.com|yellowpages\.com|bbb\.org|manta\.com|superpages\.com|citysearch\.com)/i;
const BOT_WALL_RE = /cf-browser-verification|challenge-platform|access denied|please enable javascript|datadome|perimeterx/i;

function truthyEnv(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function looksLikeBotWall(html) {
  if (!html || html.length < 400) return true;
  return BOT_WALL_RE.test(html);
}

function shouldUseDynamicFirst(url) {
  if (truthyEnv(process.env.SCRAPE_FORCE_DYNAMIC)) return true;
  try {
    const host = new URL(normalizeUrl(url)).hostname;
    return DIRECTORY_HOSTS.test(host);
  } catch {
    return false;
  }
}

/**
 * Fetch page HTML: static fetch first unless directory/dynamic; fall back to browser.
 */
async function scrapePage(url, opts = {}) {
  const absolute = normalizeUrl(url);
  if (!absolute) {
    return { ok: false, url: '', html: '', method: 'none', contacts: null, listings: [], error: 'Invalid URL' };
  }

  const preferDynamic = opts.preferDynamic === true || shouldUseDynamicFirst(absolute);
  let result;

  if (!preferDynamic) {
    result = await fetchStaticHtml(absolute, opts);
    if (result.ok && result.html && !looksLikeBotWall(result.html)) {
      const contacts = parsePageContacts(result.html, result.url);
      const listings = parseDirectoryListings(result.html, opts.sourceId || 'page');
      return { ...result, contacts, listings };
    }
  }

  result = await scrapeDynamicHtml(absolute, opts);
  if (!result.ok || !result.html) {
    if (!preferDynamic) {
      const fallback = await fetchStaticHtml(absolute, opts);
      if (fallback.ok && fallback.html) {
        result = fallback;
      }
    }
    if (!result.html) {
      return {
        ok: false,
        url: absolute,
        html: '',
        method: result.method || 'dynamic',
        contacts: null,
        listings: [],
        error: result.error || 'No HTML',
        fetchMs: result.fetchMs,
      };
    }
  }

  const contacts = parsePageContacts(result.html, result.url || absolute);
  const listings = parseDirectoryListings(result.html, opts.sourceId || 'page');
  return { ...result, contacts, listings };
}

module.exports = {
  scrapePage,
  shouldUseDynamicFirst,
  looksLikeBotWall,
  DIRECTORY_HOSTS,
};
