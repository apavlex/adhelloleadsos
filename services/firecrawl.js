const FirecrawlApp = require('@mendable/firecrawl-js').default;
const {
  fetchHomepageHtml,
  detectTechSignalsFromHtml,
  mergeHtmlTechIntoExtract,
} = require('./techSignals');

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
    email: { type: "string", description: "Primary public contact email (mailto:, footer, contact page). Do not invent." },
    phone: { type: "string", description: "Main business phone as shown on the site (header, footer, tel: links, schema). Digits plus formatting; one number only." },
    address: { type: "string", description: "Full street address if visible (footer, contact, JSON-LD LocalBusiness). City/state/ZIP if no street." },
    total_score: { type: "number", description: "Average star rating 0-5 if explicitly shown (testimonials widget, Google Reviews embed, Yelp stars). Omit if unknown." },
    reviews_count: { type: "number", description: "Integer: number of reviews if explicitly shown next to stars or in a widget. Omit if unknown." },
    has_schema_markup: { type: "boolean", description: "True if JSON-LD or Microdata schema markup is present." },
    has_chatbot: { type: "boolean", description: "True if a chatbot (Intercom, Drift, etc.) is detected." },
    has_click_to_call: { type: "boolean", description: "True if phone numbers are properly 'tel:' linked." },
    is_mobile_friendly: { type: "boolean", description: "True if the site is responsive. Look for a viewport meta tag and flexible layouts that adapt to smaller screens." },
    is_outdated: { type: "boolean", description: "True if the design looks like it was built more than 5-10 years ago." },
    visual_modernity_score: { type: "number", description: "A score from 1-10 on how modern and professional the UI looks." },
    aeo_score: { type: "number", description: "A score from 1-5 on how well-structured the content is for Answer Engines (AEO)." },
    geo_gaps: { type: "string", description: "Brief notes on missing local SEO signals or NAP inconsistencies for GEO." },
    competitor_name: { type: "string", description: "A high-performing local competitor in the same city or vertical, if found." },
    competitor_gap: { type: "string", description: "One specific technical or conversion feature the competitor has that this business lacks (e.g., 'Modern Chatbot' or 'Schema Markup')." },
    audit_summary: { type: "string", description: "A 1-sentence summary of the biggest opportunity for improvement." },
    cms_platform: { type: "string", description: "Site builder or CMS if evident: wix, shopify, squarespace, webflow, wordpress, framer, ghost, other, or unknown." },
    tech_stack_tags: { type: "array", items: { type: "string" }, description: "Short tags for notable martech/analytics (e.g. meta_pixel, hubspot, gtm, calendly)." }
  }
};

const ENRICH_SCRAPE_PROMPT =
  'You are a professional business auditor. Extract only what is visibly present on the page or in embedded widgets/schema—especially email, phone, address, star rating, review count, social URLs, and technical signals. Never guess contact info or reviews.';

const ENRICH_SEARCH_PROMPT =
  'Find the official business website. Extract any visible email, phone, address, ratings/review counts, and social/directory URLs from snippets or landing pages. Do not invent data.';

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

    // Firecrawl v2: LLM extraction uses formats: [{ type: 'json', schema, prompt }], not legacy 'extract'.
    const doc = await firecrawl.scrape(url, {
      formats: [
        {
          type: 'json',
          schema: enrichSchema,
          prompt: ENRICH_SCRAPE_PROMPT,
        },
      ],
    });

    let merged = (doc && doc.json != null ? doc.json : doc.extract) || {};

    try {
      const html = await fetchHomepageHtml(url);
      if (html) {
        const htmlSignals = detectTechSignalsFromHtml(html, url);
        merged = mergeHtmlTechIntoExtract(merged, htmlSignals);
      }
    } catch (e) {
      console.warn(`[Firecrawl] HTML tech merge skipped for ${url}:`, e.message);
    }

    return merged;
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
        formats: [
          {
            type: 'json',
            schema: enrichSchema,
            prompt: ENRICH_SEARCH_PROMPT,
          },
        ],
      },
    });

    const web = response.web || [];
    return web.map((item) => ({
      ...item,
      extract: item.json != null ? item.json : item.extract,
    }));
  } catch (error) {
    console.error(`Error searching business for ${query}:`, error.message);
    throw error;
  }
}

module.exports = {
  enrichLead,
  searchBusiness
};
