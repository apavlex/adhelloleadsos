/**
 * Orchestrates optional Crawl4AI (self-host) before Firecrawl for Enhance / batch enrich.
 * Default: Firecrawl only (same as before). Opt-in via ENRICH_TRY_CRAWL4AI_FIRST=1.
 */

const firecrawl = require('./firecrawl');
const crawl4ai = require('./crawl4aiClient');
const { detectTechSignalsFromHtml, mergeHtmlTechIntoExtract } = require('./techSignals');

function truthyEnv(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function tryCrawl4FirstEnabled() {
  return truthyEnv(process.env.ENRICH_TRY_CRAWL4AI_FIRST);
}

/** Aggressive: no Firecrawl call when Crawl4AI returned HTML — tech signals only (no LLM extract). */
function skipFirecrawlOnCrawl4Html() {
  return truthyEnv(process.env.ENRICH_SKIP_FIRECRAWL_ON_CRAWL4AI_HTML);
}

/**
 * @param {string} url
 * @param {{ integrationEnv?: Record<string, string> }} [options] workspace-resolved env (Apify/Firecrawl/Outscraper/Crawl4AI)
 * @returns {Promise<object>} Same shape as firecrawl.enrichLead (schema-ish object)
 */
async function enrichLeadSmart(url, options = {}) {
  const integrationEnv = options.integrationEnv || null;
  let u = url;
  if (u && !String(u).startsWith('http')) {
    u = `https://${u}`;
  }

  let techMergeHtml = null;
  if (tryCrawl4FirstEnabled() && crawl4ai.isConfigured(integrationEnv)) {
    try {
      const raw = await crawl4ai.crawlUrls(u, integrationEnv);
      techMergeHtml = crawl4ai.extractFirstHtmlFromCrawlResult(raw);
      if (techMergeHtml) {
        console.log(
          `[webEnrichment] Crawl4AI primed HTML (${techMergeHtml.length} chars) for tech merge on ${u}`
        );
      }
    } catch (e) {
      console.warn('[webEnrichment] Crawl4AI pre-step failed, using Firecrawl path only:', e.message);
    }
  }

  if (skipFirecrawlOnCrawl4Html() && techMergeHtml) {
    const signals = detectTechSignalsFromHtml(techMergeHtml, u);
    console.warn(
      '[webEnrichment] ENRICH_SKIP_FIRECRAWL_ON_CRAWL4AI_HTML=1 — returning tech-merge only (no Firecrawl LLM extract).'
    );
    return mergeHtmlTechIntoExtract({}, signals);
  }

  return firecrawl.enrichLead(u, { techMergeHtml, integrationEnv });
}

module.exports = {
  enrichLeadSmart,
  tryCrawl4FirstEnabled,
  skipFirecrawlOnCrawl4Html,
};
