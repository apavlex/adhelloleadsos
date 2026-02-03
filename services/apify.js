const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
  token: process.env.APIFY_API_TOKEN,
});

const ACTOR_ID = 'nwua9Gu5YrADL7ZDj';

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
  async searchGoogleMaps({ keyword, city, state, maxResults }) {
    const searchString = `${keyword} in ${city}, ${state}`;
    const locationQuery = `${city}, ${state}, USA`;

    const input = {
      searchStringsArray: [searchString],
      locationQuery,
      maxCrawledPlacesPerSearch: parseInt(maxResults, 10) || 20,
      language: 'en',
      searchMatching: 'all',
      placeMinimumStars: '',
      website: 'allPlaces',
      skipClosedPlaces: false,
      scrapePlaceDetailPage: false,
      scrapeTableReservationProvider: false,
      includeWebResults: false,
      scrapeDirectories: false,
      maxQuestions: 0,
      scrapeContacts: false,
      scrapeSocialMediaProfiles: {
        facebooks: false,
        instagrams: false,
        youtubes: false,
        tiktoks: false,
        twitters: false,
      },
      maximumLeadsEnrichmentRecords: 0,
      maxReviews: 0,
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
    }));
  },
};
