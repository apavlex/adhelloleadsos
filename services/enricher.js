const firecrawl = require('./firecrawl');
const apify = require('./apify');

/**
 * High-quality multi-stage enrichment that combines Apify and Firecrawl.
 * Aim is to find social media links and, most importantly, business emails.
 */
module.exports = {
  async enrichLeads(leads) {
    console.log(`[ENRICHER] Starting deep enrichment for ${leads.length} leads...`);

    // 1. Firecrawl Deep Hunt (Exclusively using Firecrawl for high-quality extraction)
    const enrichedLeads = [...leads]; 

    // 2. Deep Email Hunt (Focused on leads still missing email or socials)
    // We only want to run firecrawl on leads that have a website but NO email or NO socials
    const leadsInNeed = enrichedLeads.filter(l => 
      l.website && l.website !== 'N/A' && 
      (l.email === 'N/A' || l.facebook === 'N/A' || l.instagram === 'N/A')
    );

    if (leadsInNeed.length === 0) {
      console.log('[ENRICHER] No leads require deep enrichment.');
      return enrichedLeads;
    }

    console.log(`[ENRICHER] Found ${leadsInNeed.length} leads requiring deep enrichment. Starting Firecrawl...`);

    // To prevent hitting Firecrawl rate limits too hard, we do them in small batches or one by one
    // for a better success rate.
    for (let lead of enrichedLeads) {
      if (lead.website && lead.website !== 'N/A' && (lead.email === 'N/A' || lead.facebook === 'N/A' || lead.instagram === 'N/A')) {
        try {
          console.log(`[ENRICHER] Hunting data for: ${lead.title} (${lead.website})`);
          const deepData = await firecrawl.enrichLead(lead.website);
          
          if (deepData) {
            if (lead.email === 'N/A' && deepData.email) lead.email = deepData.email;
            if (lead.facebook === 'N/A' && deepData.facebook) lead.facebook = deepData.facebook;
            if (lead.instagram === 'N/A' && deepData.instagram) lead.instagram = deepData.instagram;
            if (lead.twitter === 'N/A' && deepData.twitter) lead.twitter = deepData.twitter;
            if (!lead.linkedin && deepData.linkedin) lead.linkedin = deepData.linkedin;
          }
        } catch (err) {
          console.error(`[ENRICHER] Firecrawl enrichment failed for ${lead.title}:`, err.message);
        }
      }
    }

    console.log('[ENRICHER] Deep enrichment pass complete.');
    return enrichedLeads;
  }
};
