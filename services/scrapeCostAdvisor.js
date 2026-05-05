/**
 * Cost-oriented guidance: which data source to try first — additive to Apify + Firecrawl.
 * Nothing here removes or bypasses existing integrations by default.
 */

const crawl4ai = require('./crawl4aiClient');
const outscraper = require('./outscraperClient');

/** @param {Record<string, string>|null|undefined} [resolvedEnv] workspace-resolved env */
function apifyConfigured(resolvedEnv) {
  const t = (resolvedEnv && resolvedEnv.APIFY_API_TOKEN) || process.env.APIFY_API_TOKEN;
  return Boolean(String(t || '').trim());
}

function firecrawlConfigured(resolvedEnv) {
  const t = (resolvedEnv && resolvedEnv.FIRECRAWL_API_KEY) || process.env.FIRECRAWL_API_KEY;
  return Boolean(String(t || '').trim());
}

/**
 * Env-only flags (fast) plus optional live pings passed in from the route.
 * @param {{ crawl4ai?: object, outscraper?: object }} live
 */
function buildSourceCards(live = {}, resolvedEnv) {
  const apify = apifyConfigured(resolvedEnv);
  const fc = firecrawlConfigured(resolvedEnv);
  const c4 = crawl4ai.isConfigured(resolvedEnv);
  const os = outscraper.isConfigured(resolvedEnv);

  return [
    {
      id: 'apify',
      name: 'Apify (Google Maps)',
      role: 'Find Leads — already wired in this app.',
      cost: 'Paid per Apify usage (actor run time + results).',
      configured: apify,
      live: null,
      tip: apify
        ? 'Find Leads uses Outscraper first when OUTSCRAPER_API_KEY is set; Apify runs if Outscraper errors or returns no rows. Set SEARCH_MAPS_PRIMARY=apify to skip Outscraper.'
        : 'Set APIFY_API_TOKEN (and optionally OUTSCRAPER_API_KEY) to run lead searches from Find Leads.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      role: 'Lead Enhance / deep extract — already wired.',
      cost: 'Hosted credits (free tier then paid).',
      configured: fc,
      live: null,
      tip: fc
        ? 'Best default when you want LLM-structured extract with minimal ops. Optional: set ENRICH_TRY_CRAWL4AI_FIRST=1 + CRAWL4AI_BASE_URL to pull HTML from self-hosted Crawl4AI before Firecrawl (tech merge reuses that HTML).'
        : 'Set FIRECRAWL_API_KEY for Enhance on pipeline leads.',
    },
    {
      id: 'crawl4ai',
      name: 'Crawl4AI (self-host)',
      role: 'Optional parallel path: cheap raw crawl / markdown when you run Docker yourself.',
      cost: 'Software is free; you pay compute + proxies + any LLM you attach.',
      configured: c4,
      live: live.crawl4ai || null,
      tip: c4
        ? 'Use for high-volume raw capture or experiments; keep Firecrawl for “it just works” hosted extract.'
        : 'Set CRAWL4AI_BASE_URL (e.g. http://localhost:11235) when your Crawl4AI container is up.',
    },
    {
      id: 'outscraper',
      name: 'Outscraper',
      role: 'Optional parallel Maps / reviews APIs — compare $/lead vs Apify.',
      cost: 'Paid per Outscraper pricing (often competitive for bulk Maps).',
      configured: os,
      live: live.outscraper || null,
      tip: os
        ? 'With the key set, Find Leads step 1 calls Outscraper Google Maps search first (async + poll); Apify is the fallback.'
        : 'Set OUTSCRAPER_API_KEY to use Outscraper as the first Maps search step (Apify remains fallback).',
    },
    {
      id: 'leadsgorilla',
      name: 'LeadsGorilla',
      href: 'https://app.leadsgorilla.io/',
      external: true,
      role: 'Bulk Google Business Profile lists — export, then import here.',
      cost: 'Separate product (LeadsGorilla subscription). No API key in AdHello.',
      configured: false,
      live: null,
      tip: 'Build lists in LeadsGorilla, download CSV, then use Prospecting → import. AdHello maps columns like Rating, Total Review, GBP Link, Claim status, and Optimization score.',
    },
  ];
}

/** Task rows for the Today dashboard — additive guidance only. */
function buildTaskRows() {
  return [
    {
      task: 'Build a territory list from Google Maps',
      startCheap:
        'Compare Outscraper vs Apify unit price for the same query size; keep both keys and run small test batches.',
      keepPaid:
        'If you need the least ops friction, Apify (already integrated on Find Leads) stays the fastest path.',
      inApp: 'Find Leads: Outscraper first when configured (workspace keys or env); Apify fallback. Workspace → API integrations applies the same keys to all members.',
    },
    {
      task: 'Deep website audit + structured fields on a lead',
      startCheap:
        'Crawl4AI self-host for markdown/HTML + your own rules; pair with existing regex tech signals (no API $).',
      keepPaid:
        'Firecrawl when you want hosted LLM extract and minimal maintenance.',
      inApp: 'Pipeline Enhance still uses Firecrawl. Crawl4AI is additive (configure base URL).',
    },
    {
      task: 'Heavy anti-bot / login / infinite scroll',
      startCheap:
        'Crawl4AI with proxies + hooks (self-managed). Higher engineering cost.',
      keepPaid:
        'Firecrawl or managed vendors when time-to-value beats engineering time.',
      inApp: 'Still use Firecrawl for default Enhance; escalate to Crawl4AI only when justified.',
    },
  ];
}

function getDashboardPayload(live = {}, resolvedEnv) {
  return {
    sources: buildSourceCards(live, resolvedEnv),
    tasks: buildTaskRows(),
    principle:
      'Cheaper lanes stack on top of what you already have: Maps search can try Outscraper first, then Apify; Enhance can try Crawl4AI HTML before Firecrawl. Keep paid tools when they save time or unblock quality.',
  };
}

module.exports = {
  getDashboardPayload,
  apifyConfigured,
  firecrawlConfigured,
};
