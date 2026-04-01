const FirecrawlApp = require('@mendable/firecrawl-js').default;

let appInstance = null;
function getFirecrawlApp() {
  if (!appInstance) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error('Firecrawl API Key is missing. Please set FIRECRAWL_API_KEY in your environment variables.');
    }
    appInstance = new FirecrawlApp({ apiKey });
  }
  return appInstance;
}

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
    email: { type: "string", description: "The primary contact email address found on the website." },
    has_schema_markup: { type: "boolean", description: "True if JSON-LD or Microdata schema markup is present." },
    has_chatbot: { type: "boolean", description: "True if a chatbot (Intercom, Drift, etc.) is detected." },
    has_click_to_call: { type: "boolean", description: "True if phone numbers are properly 'tel:' linked." },
    is_mobile_friendly: { type: "boolean", description: "True if the site appears responsive and mobile-optimized." },
    is_outdated: { type: "boolean", description: "True if the design looks like it was built more than 5-10 years ago." },
    visual_modernity_score: { type: "number", description: "A score from 1-10 on how modern and professional the UI looks." },
    aeo_score: { type: "number", description: "A score from 1-5 on how well-structured the content is for Answer Engines (AEO)." },
    geo_gaps: { type: "string", description: "Brief notes on missing local SEO signals or NAP inconsistencies for GEO." },
    competitor_name: { type: "string", description: "A high-performing local competitor in the same city/niche, if found." },
    competitor_gap: { type: "string", description: "One specific technical or conversion feature the competitor has that this business lacks (e.g., 'Modern Chatbot' or 'Schema Markup')." },
    audit_summary: { type: "string", description: "A 1-sentence summary of the biggest opportunity for improvement." }
  }
};

/**
 * Enriches a lead by scraping the given URL and extracting social profiles and directories.
 * @param {string} url - The website URL to scrape.
 * @returns {Promise<Object>} Enriched data matching the schema.
 */
async function enrichLead(url) {
  // Ensure url is absolute
  if (url && !url.startsWith('http')) {
    url = 'https://' + url;
  }

  try {
    const firecrawl = getFirecrawlApp();
    
    const response = await firecrawl.scrape(url, {
      formats: ['extract'],
      extract: {
        schema: enrichSchema,
        prompt: "Extract social media, contact info, and perform a brief GEO/AEO/Modernity audit. Focus on missing Schema, outdated design, mobile-friendliness, and lead-capture features (chatbot/click-to-call)."
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

/**
 * Searches for a business using Firecrawl Search.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} List of search results.
 */
async function searchBusiness(query) {
  try {
    const firecrawl = getFirecrawlApp();
    const response = await firecrawl.search(query, {
      limit: 3,
      scrapeOptions: {
        formats: ['extract'],
        extract: {
          schema: enrichSchema,
          prompt: "Extract official website and social media links for this business."
        }
      }
    });

    if (!response.success) {
      throw new Error(`Firecrawl Search API error: ${response.error || 'Unknown error'}`);
    }

    return response.data || [];
  } catch (error) {
    console.error(`Error searching business for ${query}:`, error.message);
    throw error;
  }
}

module.exports = {
  enrichLead,
  searchBusiness
};
