/**
 * Cheap contact extract from business sites before paid Firecrawl (Requests/Cheerio + optional Puppeteer).
 */

const { scrapePage } = require('./pageScraper');
const { detectTechSignalsFromHtml, mergeHtmlTechIntoExtract } = require('./techSignals');

function truthyEnv(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function localScrapeEnrichEnabled(integrationEnv) {
  const ws = integrationEnv && integrationEnv.ENRICH_TRY_LOCAL_SCRAPE;
  if (ws != null && String(ws).trim() !== '') return truthyEnv(ws);
  return truthyEnv(process.env.ENRICH_TRY_LOCAL_SCRAPE ?? '1');
}

function contactsToExtract(contacts) {
  if (!contacts) return {};
  return {
    email: contacts.email || contacts.emails?.[0] || '',
    phone: contacts.phone || contacts.phones?.[0] || '',
    address: contacts.address || '',
    business_name: contacts.businessName || '',
  };
}

/**
 * @param {string} url
 * @returns {Promise<{ extract: object, html: string|null, method: string }|null>}
 */
async function extractFromLocalScrape(url) {
  const page = await scrapePage(url, { preferDynamic: false });
  if (!page.ok || !page.html) return null;

  const base = contactsToExtract(page.contacts);
  const signals = detectTechSignalsFromHtml(page.html, page.url || url);
  const extract = mergeHtmlTechIntoExtract(base, signals);
  return {
    extract,
    html: page.html,
    method: page.method || 'static',
  };
}

module.exports = {
  extractFromLocalScrape,
  localScrapeEnrichEnabled,
  contactsToExtract,
};
