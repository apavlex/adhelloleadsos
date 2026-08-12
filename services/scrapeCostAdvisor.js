/**
 * Cost-oriented guidance: which data source to try first — additive to Apify + Firecrawl.
 * Nothing here removes or bypasses existing integrations by default.
 */

const crawl4ai = require('./crawl4aiClient');
const outscraper = require('./outscraperClient');
const searchapiGoogleLocal = require('./searchapiGoogleLocal');
const serpapiGoogleLocal = require('./serpapiGoogleLocal');
const rapidapiLocalBusiness = require('./rapidapiLocalBusiness');
const betterContact = require('./betterContactClient');
const ghlClient = require('./ghlClient');
const lobClient = require('./lobClient');
const {
  isOpenRouterConfigured,
  describeOpenRouterModelStack,
  OPENROUTER_PAID_FALLBACK_MODEL,
} = require('./llmClient');

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
  const searchapi = searchapiGoogleLocal.isConfigured(resolvedEnv);
  const serpapi = serpapiGoogleLocal.isConfigured(resolvedEnv);
  const rapidapi = rapidapiLocalBusiness.isConfigured(resolvedEnv);
  const bc = betterContact.isConfigured(resolvedEnv);
  const ghl = ghlClient.isConfigured(resolvedEnv);
  const lob = lobClient.isConfigured(resolvedEnv);
  const openrouter = isOpenRouterConfigured(resolvedEnv);
  const orStack = describeOpenRouterModelStack(resolvedEnv);

  return [
    {
      id: 'openrouter',
      name: 'OpenRouter (AI)',
      connectAnchor: 'openrouter-integration',
      role: 'AI — flow coach, GHL prompt optimizer, outreach copy, flip scoring, audits.',
      cost: 'Free tier: openrouter/free or :free models ($0). Paid fallback: DeepSeek V4 Flash.',
      configured: openrouter,
      live: null,
      tip: openrouter
        ? `Active chain: ${orStack.summary}. Pin a model on the OpenRouter card below, or leave blank for free auto-router. Paid tier when enabled: ${OPENROUTER_PAID_FALLBACK_MODEL}.`
        : 'Set OPENROUTER_API_KEY under AI — OpenRouter. Default uses openrouter/free (cheapest free model that day).',
    },
    {
      id: 'bettercontact',
      name: 'BetterContact',
      connectAnchor: 'integration-bettercontact',
      role: 'Hunt contacts & reviews — verified email and mobile.',
      cost: 'Per BetterContact credits / plan.',
      configured: bc,
      live: null,
      tip: bc
        ? 'Runs in parallel during Hunt contacts & reviews on each lead.'
        : 'Set BETTERCONTACT_API_KEY under Enrich & contact data to unlock contact waterfall on Hunt.',
    },
    {
      id: 'outscraper',
      name: 'Outscraper',
      connectAnchor: 'integration-outscraper',
      role: 'Hunt contacts & reviews — Google rating, review quotes, and Maps fallback.',
      cost: 'Paid per Outscraper pricing (often competitive for bulk Maps + reviews).',
      configured: os,
      live: live.outscraper || null,
      tip: os
        ? 'Powers Google review scrape (highest/lowest quotes) during Hunt. Also runs in Find Leads Auto mode after RapidAPI, SearchAPI.io, and SerpAPI.'
        : 'Set OUTSCRAPER_API_KEY for review quotes on Hunt and as another Maps list provider.',
    },
    {
      id: 'rapidapi',
      name: 'RapidAPI (Local Business Data)',
      connectAnchor: 'integration-rapidapi',
      role: 'Find Leads — Google Maps via RapidAPI (first in Auto mode).',
      cost: 'Per your RapidAPI plan and per-request credits on the API you subscribe to.',
      configured: rapidapi,
      live: null,
      tip: rapidapi
        ? 'Runs first in Auto when SEARCH_MAPS_PRIMARY is auto (default). Falls through to SearchAPI.io, SerpAPI, Outscraper, then Apify if this returns zero rows or errors. Force only RapidAPI with SEARCH_MAPS_PRIMARY=rapidapi.'
        : 'Subscribe to a Local Business / Google Maps API on rapidapi.com, then set RAPIDAPI_KEY in Workspace → API integrations (or server env). Optional: RAPIDAPI_HOST and endpoint URL if you use a different marketplace API.',
    },
    {
      id: 'apify',
      name: 'Apify (Google Maps)',
      connectAnchor: 'integration-apify',
      role: 'Find Leads — last fallback in Auto mode.',
      cost: 'Paid per Apify usage (actor run time + results).',
      configured: apify,
      live: null,
      tip: apify
        ? 'Used after RapidAPI, SearchAPI.io, SerpAPI, and Outscraper when earlier providers return nothing or fail. Override chain with SEARCH_MAPS_PRIMARY.'
        : 'Set APIFY_API_TOKEN (and optionally other Maps keys) to run lead searches from Find Leads.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      connectAnchor: 'integration-firecrawl',
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
      connectAnchor: 'integration-crawl4ai',
      role: 'Optional parallel path: cheap raw crawl / markdown when you run Docker yourself.',
      cost: 'Software is free; you pay compute + proxies + any LLM you attach.',
      configured: c4,
      live: live.crawl4ai || null,
      tip: c4
        ? 'Use for high-volume raw capture or experiments; keep Firecrawl for “it just works” hosted extract.'
        : 'Set CRAWL4AI_BASE_URL (e.g. http://localhost:11235) when your Crawl4AI container is up.',
    },
    {
      id: 'searchapi',
      name: 'SearchAPI.io (Google Local)',
      connectAnchor: 'integration-searchapi',
      role: 'Find Leads — Google Local / local pack listings.',
      cost: 'Per SearchAPI.io plan and credits.',
      configured: searchapi,
      live: null,
      tip: searchapi
        ? 'Runs after RapidAPI in Auto mode when SEARCHAPI_API_KEY is set. Force with SEARCH_MAPS_PRIMARY=searchapi.'
        : 'Set SEARCHAPI_API_KEY from SearchAPI.io to enable Google Local as a Maps list source.',
    },
    {
      id: 'serpapi',
      name: 'SerpAPI (Google Local)',
      connectAnchor: 'integration-serpapi',
      role: 'Find Leads — Google Local via SerpAPI.',
      cost: 'Per SerpAPI searches/month.',
      configured: serpapi,
      live: null,
      tip: serpapi
        ? 'Runs after SearchAPI.io in Auto mode when SERPAPI_API_KEY is set. Force with SEARCH_MAPS_PRIMARY=serpapi.'
        : 'Set SERPAPI_API_KEY from serpapi.com for Google Local as a Maps list source.',
    },
    {
      id: 'ghl',
      name: 'Go High Level',
      connectAnchor: 'ghl-integration',
      role: 'CRM — sync contacts, send SMS & email, inbound webhooks.',
      cost: 'Included with your GHL sub-account; API usage is part of your plan.',
      configured: ghl,
      live: null,
      tip: ghl
        ? 'Sync/pull from Workspace → Integrations, bulk actions on the pipeline, Focus mode, and sub-agents. Outbound email needs a verified sender; SMS can use your location default number.'
        : 'Set GHL private integration token + location ID under CRM. Enable contacts (read/write) and conversations/message.write scopes. See the setup guide for webhook URL.',
    },
    {
      id: 'lob',
      name: 'Lob (Direct Mail)',
      connectAnchor: 'lob-integration',
      role: 'Direct mail — postcards and letters from pipeline / Direct Mail.',
      cost: 'Per piece printed and mailed (test_ keys are free proofs; live_ keys bill postage).',
      configured: lob,
      live: null,
      tip: lob
        ? 'Upload front/back PDFs on the Lob card, then mail from Direct Mail or bulk pipeline actions. test_ keys queue proofs without postage.'
        : 'Set Lob API key + return address under CRM → Lob. Use test_… for proofs; switch to live_… when billing is enabled on Lob.',
    },
    {
      id: 'local_scrape',
      name: 'Local scrape (Cheerio + Puppeteer)',
      connectAnchor: 'integration-find-leads',
      role: 'Find Leads directory supplement + optional Enhance pre-step (no API credits).',
      cost: 'Free software; you pay server CPU/RAM (Puppeteer is heavier than fetch-only).',
      configured: true,
      live: null,
      tip: 'Find Leads: enable “Also mine directory listings” (Outscraper: Yelp, Angi, YP, Zillow agents, BBB + BuiltWith). Enhance: ENRICH_TRY_LOCAL_SCRAPE=1 pulls contacts/tech from HTML before Firecrawl. Set BROWSER_SCRAPER=playwright if you install playwright.',
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
      task: 'AI coach, outreach copy, GHL workflow prompts, flip scoring',
      startCheap:
        'openrouter/free or qwen/qwen3-coder:free — $0 when within OpenRouter free daily limits.',
      keepPaid:
        `DeepSeek V4 Flash (${OPENROUTER_PAID_FALLBACK_MODEL}) when free models fail or you pin it in Model. Use :floor for cheapest provider.`,
      inApp:
        'Workspace → Integrations → OpenRouter. Leave Model blank for free auto-router; set deepseek/deepseek-v4-flash to always use Flash.',
    },
    {
      task: 'Hunt contacts, reviews, and AI reputation on a lead',
      startCheap:
        'Maps providers you already use refresh rating/count for free-ish; Outscraper adds review quotes when you need verbatim highest/lowest.',
      keepPaid:
        'BetterContact when you need verified email/mobile without manual lookup.',
      inApp: 'Pipeline sidebar: Hunt contacts & reviews. Needs BetterContact + Outscraper keys below for full coverage.',
    },
    {
      task: 'Build a territory list from Google Maps',
      startCheap:
        'Compare SearchAPI.io vs SerpAPI vs Outscraper vs Apify unit price for the same query; keep keys you like and run small test batches.',
      keepPaid:
        'If you need the least ops friction, Apify (already integrated on Find Leads) stays the fastest path.',
      inApp: 'Find Leads: RapidAPI → SearchAPI.io → SerpAPI → Outscraper → Apify in Auto (workspace keys or env). Workspace → API integrations applies the same keys to all members.',
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
    {
      task: 'Extra leads from Yelp / Yellow Pages / BBB',
      startCheap:
        'Built-in directory supplement: fetch + Cheerio for static HTML, Puppeteer scroll for dynamic listings.',
      keepPaid:
        'Paid Maps APIs when you need Google-native ratings/reviews at scale.',
      inApp: 'Find Leads checkbox “Also mine directory listings” (on by default). Disable with SEARCH_DIRECTORY_SUPPLEMENT=0.',
    },
    {
      task: 'Sync pipeline leads with your CRM and send SMS/email',
      startCheap:
        'Manual CSV export/import if you only need occasional handoffs.',
      keepPaid:
        'Go High Level when you want two-way sync, verified outbound, and webhook-driven inbound contacts.',
      inApp:
        'Workspace → Integrations → Go High Level. Sync/pull on the card; send from lead panel, Focus, or bulk GHL actions.',
    },
    {
      task: 'Mail physical postcards to selected leads',
      startCheap:
        'Export addresses and print locally when volume is tiny.',
      keepPaid:
        'Lob when you want print-and-mail at scale with PDF creatives and delivery tracking.',
      inApp:
        'Workspace → Integrations → Lob (API key + return address + PDF uploads), then Direct Mail or pipeline bulk send.',
    },
  ];
}

function getDashboardPayload(live = {}, resolvedEnv) {
  return {
    sources: buildSourceCards(live, resolvedEnv),
    tasks: buildTaskRows(),
    principle:
      'Cheaper lanes stack on top of what you already have: Maps search can chain RapidAPI, SearchAPI.io, SerpAPI, Outscraper, then Apify; Enhance can try Crawl4AI HTML before Firecrawl; OpenRouter powers AI features (free openrouter/free by default, DeepSeek V4 Flash when paid); Go High Level handles CRM sync and outbound; Lob handles print-and-mail. Keep paid tools when they save time or unblock quality.',
  };
}

function rapidapiConfigured(resolvedEnv) {
  return rapidapiLocalBusiness.isConfigured(resolvedEnv);
}

module.exports = {
  getDashboardPayload,
  apifyConfigured,
  firecrawlConfigured,
  rapidapiConfigured,
};
