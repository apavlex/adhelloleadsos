/**
 * Orchestrates optional Crawl4AI (self-host) before Firecrawl for Enhance / batch enrich.
 * Default: Firecrawl only (same as before). Opt-in via ENRICH_TRY_CRAWL4AI_FIRST=1.
 */

const firecrawl = require('./firecrawl');
const crawl4ai = require('./crawl4aiClient');
const mapsEnrichFallback = require('./mapsEnrichFallback');
const localPageExtract = require('./localPageExtract');
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

function skipFirecrawlOnLocalHtml() {
  return truthyEnv(process.env.ENRICH_SKIP_FIRECRAWL_ON_LOCAL_SCRAPE);
}

/**
 * ENRICH_PRIMARY:
 * - auto (default): keep existing env-flag behavior
 * - firecrawl_only: skip Crawl4AI pre-step
 * - crawl4ai_first: force Crawl4AI pre-step when configured
 */
function resolveEnrichPrimary(integrationEnv) {
  const ws = String((integrationEnv && integrationEnv.ENRICH_PRIMARY) || '').toLowerCase().trim();
  const env = String(process.env.ENRICH_PRIMARY || '').toLowerCase().trim();
  const v = ws || env;
  if (v === 'firecrawl_only' || v === 'crawl4ai_first') return v;
  return 'auto';
}

function mergeLocalContactsWithProvider(providerExtract, localExtract) {
  const local = {};
  for (const [k, v] of Object.entries(localExtract || {})) {
    if (v == null || v === '' || v === 'N/A') continue;
    local[k] = v;
  }
  return mapsEnrichFallback.mergeExtractPreferFirecrawl(providerExtract || {}, local);
}

/**
 * @param {string} url
 * @param {{ integrationEnv?: Record<string, string> }} [options] workspace-resolved env (Apify/Firecrawl/Outscraper/Crawl4AI)
 * @returns {Promise<object>} Same shape as firecrawl.enrichLead (schema-ish object)
 */
async function enrichLeadSmart(url, options = {}) {
  const integrationEnv = options.integrationEnv || null;
  const enrichPrimary = resolveEnrichPrimary(integrationEnv);
  let u = url;
  if (u && !String(u).startsWith('http')) {
    u = `https://${u}`;
  }

  let techMergeHtml = null;
  let localContactExtract = null;
  const shouldTryCrawl4First =
    (enrichPrimary === 'crawl4ai_first' || (enrichPrimary === 'auto' && tryCrawl4FirstEnabled())) &&
    crawl4ai.isConfigured(integrationEnv);
  if (shouldTryCrawl4First) {
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

  if (!techMergeHtml && localPageExtract.localScrapeEnrichEnabled(integrationEnv)) {
    try {
      const local = await localPageExtract.extractFromLocalScrape(u);
      if (local && local.html) {
        techMergeHtml = local.html;
        localContactExtract = local.extract || null;
        console.log(
          `[webEnrichment] Local scrape primed HTML (${techMergeHtml.length} chars, ${local.method}) for ${u}`
        );
        if (skipFirecrawlOnLocalHtml() && local.extract && mapsEnrichFallback.extractHasContactSignal(local.extract)) {
          const signals = detectTechSignalsFromHtml(techMergeHtml, u);
          return mergeHtmlTechIntoExtract(local.extract, signals);
        }
      }
    } catch (e) {
      console.warn('[webEnrichment] Local scrape pre-step failed:', e.message);
    }
  }

  if (skipFirecrawlOnCrawl4Html() && techMergeHtml) {
    const signals = detectTechSignalsFromHtml(techMergeHtml, u);
    console.warn(
      '[webEnrichment] ENRICH_SKIP_FIRECRAWL_ON_CRAWL4AI_HTML=1 — returning tech-merge only (no Firecrawl LLM extract).'
    );
    return mergeHtmlTechIntoExtract({}, signals);
  }

  let providerExtract;
  try {
    providerExtract = await firecrawl.enrichLead(u, { techMergeHtml, integrationEnv });
  } catch (e) {
    // Firecrawl missing/erroring must not discard contacts we already scraped ourselves.
    if (localContactExtract && Object.keys(localContactExtract).length) {
      console.warn(
        `[webEnrichment] Firecrawl failed (${e.message}); keeping local scrape contacts for ${u}`
      );
      const signals = detectTechSignalsFromHtml(techMergeHtml, u);
      return mergeHtmlTechIntoExtract(localContactExtract, signals);
    }
    throw e;
  }
  // The deterministic HTML parser often sees mailto/footer contact details that the
  // LLM omits. Preserve those fields while still preferring Firecrawl when both exist.
  return mergeLocalContactsWithProvider(providerExtract, localContactExtract);
}

/**
 * Firecrawl first; if it errors or returns no contact signals, merge in Maps (Outscraper/Apify).
 * @param {string|null|undefined} url
 * @param {{ title?: string, city?: string, state?: string }} leadProfile
 * @param {{ integrationEnv?: Record<string, string> }} [options]
 * @returns {Promise<{ merged: object, mapsUsed: boolean, websiteHint: string|null, mapsPlace: object|null }>}
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
  const missingCoreContact = mapsEnrichFallback.extractMissingCoreContact(fcData);
  let mapsExtract = null;
  let websiteHint = null;
  let mapsPlace = null;

  if (!options.skipMapsFallback && (fcFailed || !fcHadSignal || missingCoreContact)) {
    const pack = await mapsEnrichFallback.enrichFromMapsForLead(leadProfile || {}, integrationEnv);
    if (pack) {
      mapsExtract = pack.extract;
      websiteHint = pack.websiteHint || null;
      mapsPlace = pack.place || null;
    }
  }

  const merged = mapsEnrichFallback.mergeExtractPreferFirecrawl(fcData || {}, mapsExtract || {});
  const mapsUsed = Boolean(
    !options.skipMapsFallback &&
      (fcFailed || !fcHadSignal || missingCoreContact) &&
      ((mapsExtract && Object.keys(mapsExtract).length > 0) || Boolean(websiteHint))
  );

  return { merged, mapsUsed, websiteHint, mapsPlace };
}

module.exports = {
  enrichLeadSmart,
  enrichLeadSmartWithMapsFallback,
  tryCrawl4FirstEnabled,
  skipFirecrawlOnCrawl4Html,
  skipFirecrawlOnLocalHtml,
  resolveEnrichPrimary,
  mergeLocalContactsWithProvider,
};
