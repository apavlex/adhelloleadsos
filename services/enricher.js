const webEnrichment = require('./webEnrichment');
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');
const monidLeadEnrich = require('./monidLeadEnrich');

function leadNeedsMonidEnrich(lead) {
  const missing = (v) => !v || v === 'N/A';
  return (
    missing(lead.phone) ||
    missing(lead.website) ||
    missing(lead.email) ||
    missing(lead.facebook) ||
    missing(lead.instagram) ||
    missing(lead.twitter) ||
    !lead.linkedin
  );
}

function applyMonidExtractToLead(lead, extract) {
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
   * @param {{ workspaceId?: string }} [opts]
   */
  async enrichLeads(leads, opts = {}) {
    const workspaceId = opts.workspaceId || 'default';
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(workspaceId);

    console.log(`[ENRICHER] Starting deep enrichment for ${leads.length} leads...`);

    const enrichedLeads = [...leads]; 
    const concurrency = 5; // Enrich 5 leads at a time

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

    // 3. Monid pass — Apollo / PDL for phone, website, socials (works without website too)
    if (monidLeadEnrich.isConfigured(integrationEnv)) {
      const monidNeed = enrichedLeads.filter(leadNeedsMonidEnrich);
      if (monidNeed.length) {
        console.log(`[ENRICHER] Monid enrichment for ${monidNeed.length} leads...`);
        for (let i = 0; i < monidNeed.length; i += concurrency) {
          const batch = monidNeed.slice(i, i + concurrency);
          // eslint-disable-next-line no-await-in-loop
          await Promise.all(
            batch.map(async (lead) => {
              try {
                const pack = await monidLeadEnrich.enrichLeadFromMonid(lead, integrationEnv);
                if (pack && pack.enriched && pack.extract) {
                  applyMonidExtractToLead(lead, pack.extract);
                  if (lead.website && lead.website !== 'N/A') {
                    await dbService.saveSiteMetadata(lead.website, pack.extract);
                  }
                }
              } catch (err) {
                console.warn(`[ENRICHER] Monid failed for ${lead.title}:`, err.message);
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
      const batch = stillInNeed.slice(i, i + concurrency);
      
      await Promise.all(batch.map(async (lead) => {
        try {
          console.log(`[ENRICHER] [BATCH] Hunting data for: ${lead.title} (${lead.website})`);
          const { merged: deepData } = await webEnrichment.enrichLeadSmartWithMapsFallback(
            lead.website,
            { title: lead.title, city: lead.city, state: lead.state },
            { integrationEnv }
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
