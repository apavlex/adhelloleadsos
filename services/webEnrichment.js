/**
 * Orchestrates optional Crawl4AI (self-host) before Firecrawl for Enhance / batch enrich.
 * Default: Firecrawl only (same as before). Opt-in via ENRICH_TRY_CRAWL4AI_FIRST=1.
 */

const firecrawl = require('./firecrawl');
const crawl4ai = require('./crawl4aiClient');
const mapsEnrichFallback = require('./mapsEnrichFallback');
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

/**
 * Firecrawl first; if it errors or returns no contact signals, merge in Maps (Outscraper/Apify).
 * @param {string|null|undefined} url
 * @param {{ title?: string, city?: string, state?: string }} leadProfile
 * @param {{ integrationEnv?: Record<string, string> }} [options]
 * @returns {Promise<{ merged: object, mapsUsed: boolean, websiteHint: string|null }>}
 */
async function enrichLeadSmartWithMapsFallback(url, leadProfile, options = {}) {
  const integrationEnv = options.integrationEnv || null;
  let fcData = null;
  let fcFailed = false;

  try {
    if (url && String(url).trim() && String(url).trim() !== 'N/A') {
      fcData = await enrichLeadSmart(url, { integrationEnv });
    }
  } catch (e) {
    fcFailed = true;
    console.warn('[webEnrichment] Firecrawl enrich failed; trying Maps fallback:', e.message);
  }

  const fcHadSignal = mapsEnrichFallback.extractHasContactSignal(fcData);
  let mapsExtract = null;
  let websiteHint = null;

  if (fcFailed || !fcHadSignal) {
    const pack = await mapsEnrichFallback.enrichFromMapsForLead(leadProfile || {}, integrationEnv);
    if (pack) {
      mapsExtract = pack.extract;
      websiteHint = pack.websiteHint || null;
    }
  }

  const merged = mapsEnrichFallback.mergeExtractPreferFirecrawl(fcData || {}, mapsExtract || {});
  const mapsUsed = Boolean(
    (fcFailed || !fcHadSignal) &&
      ((mapsExtract && Object.keys(mapsExtract).length > 0) || Boolean(websiteHint))
  );

  return { merged, mapsUsed, websiteHint };
}

module.exports = {
  enrichLeadSmart,
  enrichLeadSmartWithMapsFallback,
  tryCrawl4FirstEnabled,
  skipFirecrawlOnCrawl4Html,
};
