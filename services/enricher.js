const webEnrichment = require('./webEnrichment');
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const rapidapiWebsiteEnrich = require('./rapidapiWebsiteEnrich');
const { ENRICH_BUDGET_MS, PER_LEAD_ENRICH_MS, withTimeout } = require('./leadRunProgress');

function leadNeedsRapidApiWebsiteEnrich(lead) {
  if (!rapidapiWebsiteEnrich.leadCanEnrichFromWebsite(lead)) return false;
  const missing = (v) => !v || v === 'N/A';
  return (
    missing(lead.phone) ||
    missing(lead.email) ||
    missing(lead.facebook) ||
    missing(lead.instagram) ||
    missing(lead.twitter) ||
    !lead.linkedin
  );
}

function applyExtractToLead(lead, extract) {
  if (!extract || typeof extract !== 'object') return;
  const fill = (field) => {
    const next = extract[field];
    if (!next || String(next).trim() === 'N/A') return;
    if (!lead[field] || lead[field] === 'N/A') lead[field] = next;
  };
  fill('phone');
  fill('website');
  fill('email');
  fill('facebook');
  fill('instagram');
  fill('twitter');
  fill('linkedin');
  if ((!lead.address || lead.address === 'N/A') && extract.address) {
    lead.address = extract.address;
  }
}

/**
 * High-quality multi-stage enrichment that combines Apify and Firecrawl.
 * Aim is to find social media links and, most importantly, business emails.
 */
module.exports = {
  /**
   * @param {object[]} leads
   * @param {{ workspaceId?: string, timeoutMs?: number }} [opts]
   */
  async enrichLeads(leads, opts = {}) {
    const workspaceId = opts.workspaceId || 'default';
    const budgetMs = Math.max(1000, parseInt(opts.timeoutMs, 10) || ENRICH_BUDGET_MS);
    const deadline = Date.now() + budgetMs;
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);

    console.log(`[ENRICHER] Starting deep enrichment for ${leads.length} leads (budget ${budgetMs}ms)...`);

    const enrichedLeads = [...leads]; 
    const concurrency = 5; // Enrich 5 leads at a time

    function remainingMs() {
      return Math.max(0, deadline - Date.now());
    }
    function budgetExhausted() {
      return remainingMs() <= 0;
    }

    // 1. Filter leads that actually need enrichment
    const leadsInNeed = enrichedLeads.filter(l => 
      l.website && l.website !== 'N/A' && 
      (l.email === 'N/A' || l.facebook === 'N/A' || l.instagram === 'N/A')
    );

    if (leadsInNeed.length === 0) {
      console.log('[ENRICHER] No leads require deep enrichment.');
      return enrichedLeads;
    }

    console.log(`[ENRICHER] Found ${leadsInNeed.length} potential leads for deep enrichment.`);

    // 2. First Pass: Cache Lookup (Deduplicated)
    // To avoid multiple DB calls for the same domain in one search
    const domainCache = new Map();

    for (let lead of leadsInNeed) {
      if (!domainCache.has(lead.website)) {
        const cached = await dbService.getSiteMetadata(lead.website);
        if (cached) {
          domainCache.set(lead.website, cached);
          console.log(`[ENRICHER] Found cached data for: ${lead.website}`);
        }
      }
      
      // Apply cache if found
      const cachedData = domainCache.get(lead.website);
      if (cachedData) {
        if (lead.email === 'N/A' && cachedData.email) lead.email = cachedData.email;
        if (lead.facebook === 'N/A' && cachedData.facebook) lead.facebook = cachedData.facebook;
        if (lead.instagram === 'N/A' && cachedData.instagram) lead.instagram = cachedData.instagram;
        if (lead.twitter === 'N/A' && cachedData.twitter) lead.twitter = cachedData.twitter;
        if (!lead.linkedin && cachedData.linkedin) lead.linkedin = cachedData.linkedin;
      }
    }

    // 3. RapidAPI website pass — contacts / socials when a website is already known
    if (!budgetExhausted() && rapidapiWebsiteEnrich.isConfigured(integrationEnv)) {
      const rapidNeed = enrichedLeads.filter(leadNeedsRapidApiWebsiteEnrich);
      if (rapidNeed.length) {
        console.log(`[ENRICHER] RapidAPI website enrichment for ${rapidNeed.length} leads...`);
        for (let i = 0; i < rapidNeed.length; i += concurrency) {
          if (budgetExhausted()) {
            console.warn('[ENRICHER] Enrich budget exhausted during RapidAPI pass; returning partial results.');
            break;
          }
          const batch = rapidNeed.slice(i, i + concurrency);
          // eslint-disable-next-line no-await-in-loop
          await Promise.all(
            batch.map(async (lead) => {
              const slice = Math.min(PER_LEAD_ENRICH_MS, remainingMs());
              if (slice <= 0) return;
              try {
                const pack = await withTimeout(
                  rapidapiWebsiteEnrich.enrichLeadFromWebsite(lead, integrationEnv),
                  slice,
                  'rapidapi_website_enrich'
                );
                if (pack && pack.extract && Object.keys(pack.extract).length) {
                  applyExtractToLead(lead, pack.extract);
                  if (lead.website && lead.website !== 'N/A') {
                    await dbService.saveSiteMetadata(lead.website, pack.extract);
                  }
                }
              } catch (err) {
                console.warn(`[ENRICHER] RapidAPI website failed for ${lead.title}:`, err.message);
              }
            }),
          );
        }
      }
    }

    // 4. Firecrawl for leads still missing data (website required)
    const stillInNeed = enrichedLeads.filter(l => 
      l.website && l.website !== 'N/A' && 
      (l.email === 'N/A' || l.facebook === 'N/A' || l.instagram === 'N/A')
    );

    if (stillInNeed.length === 0) {
      console.log('[ENRICHER] All leads resolved via cache.');
      return enrichedLeads;
    }

    console.log(`[ENRICHER] ${stillInNeed.length} leads still need web enrich (Firecrawl path, optional Crawl4AI first). Processing in batches of ${concurrency}...`);

    // Process in batches to avoid API rate limits while staying fast
    for (let i = 0; i < stillInNeed.length; i += concurrency) {
      if (budgetExhausted()) {
        console.warn('[ENRICHER] Enrich budget exhausted; returning Maps/directory results as-is.');
        break;
      }
      const batch = stillInNeed.slice(i, i + concurrency);
      
      await Promise.all(batch.map(async (lead) => {
        const slice = Math.min(PER_LEAD_ENRICH_MS, remainingMs());
        if (slice <= 0) return;
        try {
          console.log(`[ENRICHER] [BATCH] Hunting data for: ${lead.title} (${lead.website})`);
          const { merged: deepData } = await withTimeout(
            webEnrichment.enrichLeadSmartWithMapsFallback(
              lead.website,
              { title: lead.title, city: lead.city, state: lead.state },
              { integrationEnv }
            ),
            slice,
            'web_enrich'
          );

          if (deepData && Object.keys(deepData).length > 0) {
            if (lead.email === 'N/A' && deepData.email) lead.email = deepData.email;
            if (lead.facebook === 'N/A' && deepData.facebook) lead.facebook = deepData.facebook;
            if (lead.instagram === 'N/A' && deepData.instagram) lead.instagram = deepData.instagram;
            if (lead.twitter === 'N/A' && deepData.twitter) lead.twitter = deepData.twitter;
            if (!lead.linkedin && deepData.linkedin) lead.linkedin = deepData.linkedin;

            await dbService.saveSiteMetadata(lead.website, deepData);
          }
        } catch (err) {
          console.error(`[ENRICHER] [BATCH] Enrich failed for ${lead.title}:`, err.message);
        }
      }));
    }

    console.log('[ENRICHER] Deep enrichment pass complete.');
    return enrichedLeads;
  }
};
