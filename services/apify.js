/** Google Maps actor (Apify). Find Leads step 1 goes through mapsSearch: Outscraper first when configured, then this client as fallback. */
const { ApifyClient } = require('apify-client');

// Google Maps scraper actor (must match input shape below). Override via APIFY_GOOGLE_MAPS_ACTOR_ID if needed.
const ACTOR_ID = process.env.APIFY_GOOGLE_MAPS_ACTOR_ID || 'nwua9Gu5YrADL7ZDj';

function apifyToken(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.APIFY_API_TOKEN;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return (process.env.APIFY_API_TOKEN || '').trim();
}

function clientFor(integrationEnv) {
  const token = apifyToken(integrationEnv);
  if (!token) throw new Error('APIFY_API_TOKEN is not set (workspace integrations or environment).');
  return new ApifyClient({ token });
}

module.exports = {
  /**
   * Run a Google Maps search via Apify.
   * @param {Object} params
   * @param {string} params.keyword - Business type to search
   * @param {string} params.city - City name
   * @param {string} params.state - State abbreviation or name
   * @param {number} params.maxResults - Max places to scrape
   * @returns {Promise<Array>} Array of place objects
   */
  async searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
    const client = clientFor(integrationEnv);
    const { buildMapsSearchQuery, buildLocationLabel } = require('./geocodeLocation');
    const searchString = buildMapsSearchQuery(keyword, city, state);
    const locationQuery = buildLocationLabel(city, state);

    const input = {
      searchStringsArray: [searchString],
      maxCrawledPlacesPerSearch: parseInt(maxResults, 10) || 20,
      language: 'en',
      searchMatching: 'all',
      placeMinimumStars: '',
      website: 'allPlaces',
      skipClosedPlaces: false,
      scrapePlaceDetailPage: true,
      scrapeTableReservationProvider: false,
      includeWebResults: false,
      scrapeDirectories: false,
      maxQuestions: 0,
      scrapeContacts: true,
      scrapeSocialMediaProfiles: {
        facebooks: true,
        instagrams: true,
        youtubes: false,
        tiktoks: false,
        twitters: true,
      },
      maximumLeadsEnrichmentRecords: 0,
      maxReviews: Math.min(
        50,
        Math.max(0, parseInt(process.env.APIFY_MAPS_MAX_REVIEWS || '0', 10) || 0)
      ),
      reviewsSort: 'newest',
      reviewsFilterString: '',
      reviewsOrigin: 'all',
      scrapeReviewsPersonalData: true,
      maxImages: 0,
      scrapeImageAuthors: false,
      allPlacesNoSearchAction: '',
    };

    console.log(`Starting Apify actor with search: "${searchString}"`);

    const run = await client.actor(ACTOR_ID).call(input);

    console.log(`Apify run finished. Dataset ID: ${run.defaultDatasetId}`);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`Retrieved ${items.length} results from Apify.`);

    return items.map((item) => ({
      title: item.title || 'N/A',
      phone: item.phone || 'N/A',
      website: item.website || 'N/A',
      email: item.email || item.contactEmail || 'N/A',
      categoryName: item.categoryName || 'N/A',
      address: item.address || 'N/A',
      city: item.city || '',
      state: item.state || '',
      postalCode: item.postalCode || '',
      totalScore: item.totalScore || 0,
      reviewsCount: item.reviewsCount || 0,
      url: item.url || '',
      placeId: item.placeId || item.place_id || '',
      facebook: item.facebook || (item.facebookUrl && item.facebookUrl.length > 0 ? item.facebookUrl[0] : 'N/A'),
      instagram: item.instagram || (item.instagramUrl && item.instagramUrl.length > 0 ? item.instagramUrl[0] : 'N/A'),
      twitter: item.twitter || (item.twitterUrl && item.twitterUrl.length > 0 ? item.twitterUrl[0] : 'N/A'),
    }));
  },
  /**
   * Enrich leads with missing social media links by crawling their websites.
   * @param {Array} leads - Array of lead objects from the initial search
   * @returns {Promise<Array>} Enriched array of lead objects
   */
  async enrichSocials(leads, integrationEnv) {
    const client = clientFor(integrationEnv);
    const leadsToEnrich = leads.filter(l => 
      l.website && l.website !== 'N/A' && 
      (l.facebook === 'N/A' || l.instagram === 'N/A' || l.twitter === 'N/A')
    );

    if (leadsToEnrich.length === 0) return leads;

    console.log(`Starting social enrichment for ${leadsToEnrich.length} leads...`);

    const startUrls = leadsToEnrich.map(l => ({ url: l.website }));
    
    // Using apify/social-media-url-finder
    const enrichmentInput = {
      startUrls,
      maxRequestsPerStartUrl: 5, // Shallow crawl for speed
      deepCheck: false,
    };

    try {
      const run = await client.actor('apify/social-media-url-finder').call(enrichmentInput);
      const { items } = await client.dataset(run.defaultDatasetId).listItems();

      console.log(`Enrichment finished. Found social data for ${items.length} websites.`);

      // Map enriched data back to original leads
      return leads.map(lead => {
        const enriched = items.find(item => {
          const itemUrl = item.url ? item.url.replace(/\/$/, '').toLowerCase() : '';
          const leadUrl = lead.website ? lead.website.replace(/\/$/, '').toLowerCase() : '';
          return itemUrl.includes(leadUrl) || leadUrl.includes(itemUrl);
        });

        if (enriched) {
          return {
            ...lead,
            facebook: lead.facebook !== 'N/A' ? lead.facebook : (enriched.facebook || 'N/A'),
            instagram: lead.instagram !== 'N/A' ? lead.instagram : (enriched.instagram || 'N/A'),
            twitter: lead.twitter !== 'N/A' ? lead.twitter : (enriched.twitter || 'N/A'),
          };
        }
        return lead;
      });
    } catch (error) {
      console.error('Social enrichment failed:', error.message);
      return leads; // Fallback to original results on error
    }
  },
};
