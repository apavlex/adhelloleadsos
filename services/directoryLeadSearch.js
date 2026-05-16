/**
 * Supplement Find Leads with public directory listings (Yelp, Yellow Pages, BBB).
 * Static HTML via fetch + Cheerio; dynamic directories via Puppeteer (or Playwright).
 */

const { scrapePage } = require('./pageScraper');
function truthyEnv(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function directorySupplementEnabled(integrationEnv) {
  const ws = integrationEnv && integrationEnv.SEARCH_DIRECTORY_SUPPLEMENT;
  if (ws != null && String(ws).trim() !== '') return truthyEnv(ws);
  return truthyEnv(process.env.SEARCH_DIRECTORY_SUPPLEMENT ?? '1');
}

function maxDirectoryPages() {
  const n = parseInt(process.env.DIRECTORY_MAX_PAGES || '3', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 3;
}

const DIRECTORY_SOURCES = [
  {
    id: 'yelp',
    label: 'Yelp',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(`${city}, ${state}`)}`,
  },
  {
    id: 'yellowpages',
    label: 'Yellow Pages',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(keyword)}&geo_location_terms=${encodeURIComponent(`${city}, ${state}`)}`,
  },
  {
    id: 'bbb',
    label: 'BBB',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      `https://www.bbb.org/search?find_text=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(`${city}, ${state}`)}&find_type=Category`,
  },
];

function listingToLead(row, ctx) {
  const profileUrl = row.url && !/^https?:/i.test(row.url) ? `https://www.yelp.com${row.url}` : row.url || '';
  return {
    title: row.title || 'N/A',
    phone: row.phone && row.phone !== 'N/A' ? row.phone : 'N/A',
    website: row.website && row.website !== 'N/A' ? row.website : 'N/A',
    email: 'N/A',
    categoryName: ctx.keyword || 'N/A',
    address: row.address && row.address !== 'N/A' ? row.address : 'N/A',
    city: ctx.city || '',
    state: ctx.state || '',
    postalCode: '',
    totalScore: 0,
    reviewsCount: 0,
    url: profileUrl || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    leadSource: `directory_${row.source || 'web'}`,
    directorySource: row.source || '',
  };
}

function dedupeLeads(leads) {
  const out = [];
  const seen = new Set();
  for (const lead of leads) {
    const key = `${String(lead.title || '').toLowerCase()}|${String(lead.phone || '').replace(/\D/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out;
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number }} params
 * @returns {Promise<Array>}
 */
async function searchDirectoryLeads(params) {
  const keyword = String(params.keyword || '').trim();
  const city = String(params.city || '').trim();
  const state = String(params.state || '').trim();
  const maxResults = Math.min(50, Math.max(1, parseInt(params.maxResults, 10) || 15));
  if (!keyword || !city || !state) return [];

  const ctx = { keyword, city, state };
  const collected = [];
  const sources = DIRECTORY_SOURCES.slice(0, maxDirectoryPages());

  for (const source of sources) {
    if (collected.length >= maxResults) break;
    const pageUrl = source.buildUrl(ctx);
    try {
      console.log(`[directoryLeadSearch] Scraping ${source.label}: ${pageUrl}`);
      const page = await scrapePage(pageUrl, {
        preferDynamic: source.preferDynamic,
        sourceId: source.id,
      });
      if (!page.ok || !page.listings || !page.listings.length) {
        console.warn(`[directoryLeadSearch] ${source.label}: no listings (${page.error || 'empty'})`);
        continue;
      }
      for (const row of page.listings) {
        collected.push(listingToLead({ ...row, source: source.id }, ctx));
        if (collected.length >= maxResults) break;
      }
    } catch (e) {
      console.warn(`[directoryLeadSearch] ${source.label} failed:`, e.message);
    }
  }

  return dedupeLeads(collected);
}

/**
 * Merge Maps leads with directory supplement; Maps rows win on duplicate titles.
 */
function mergeMapsAndDirectoryLeads(mapsLeads, directoryLeads, maxTotal) {
  const cap = Math.max(1, parseInt(maxTotal, 10) || 20);
  const maps = Array.isArray(mapsLeads) ? mapsLeads : [];
  const dirs = Array.isArray(directoryLeads) ? directoryLeads : [];
  const merged = [...maps];
  const seen = new Set(
    maps.map((l) => `${String(l.title || '').toLowerCase()}|${String(l.phone || '').replace(/\D/g, '')}`)
  );
  for (const d of dirs) {
    const key = `${String(d.title || '').toLowerCase()}|${String(d.phone || '').replace(/\D/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(d);
    if (merged.length >= cap) break;
  }
  return merged.slice(0, cap);
}

module.exports = {
  searchDirectoryLeads,
  mergeMapsAndDirectoryLeads,
  directorySupplementEnabled,
  DIRECTORY_SOURCES,
  listingToLead,
  dedupeLeads,
};
