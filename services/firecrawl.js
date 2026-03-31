const FirecrawlApp = require('@mendable/firecrawl-js').default;

const apiKey = process.env.FIRECRAWL_API_KEY;
// The SDK handles falling back to process.env.FIRECRAWL_API_KEY as well
const app = new FirecrawlApp({ apiKey: apiKey || '' });

// JSON schema for the data we want to extract
const enrichSchema = {
  type: "object",
  properties: {
    facebook: { type: "string", description: "URL to the organization's official Facebook page, if found." },
    instagram: { type: "string", description: "URL to the organization's official Instagram profile, if found." },
    twitter: { type: "string", description: "URL to the organization's official Twitter/X profile, if found." },
    linkedin: { type: "string", description: "URL to the organization's official LinkedIn company page, if found." },
    google_places: { type: "string", description: "URL to the organization's Google Maps or Google Places listing, if found." },
    yelp: { type: "string", description: "URL to the organization's official Yelp page, if found." },
    email: { type: "string", description: "The primary contact email address found on the website." }
  }
};

/**
 * Enriches a lead by scraping the given URL and extracting social profiles and directories.
 * @param {string} url - The website URL to scrape.
 * @returns {Promise<Object>} Enriched data matching the schema.
 */
async function enrichLead(url) {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error('Firecrawl API Key is missing. Please set FIRECRAWL_API_KEY in your environment variables.');
  }

  // Ensure url is absolute
  if (url && !url.startsWith('http')) {
    url = 'https://' + url;
  }

  try {
    const response = await app.scrapeUrl(url, {
      formats: ['extract'],
      extract: {
        schema: enrichSchema,
        prompt: "Extract the official social media, directory links, and support/contact email for this company from their website."
      }
    });

    if (!response.success) {
      throw new Error(`Firecrawl API error: ${response.error || 'Unknown error'}`);
    }

    return response.extract || {};
  } catch (error) {
    console.error(`Error enriching lead for ${url}:`, error.message);
    throw error;
  }
}

module.exports = {
  enrichLead
};
