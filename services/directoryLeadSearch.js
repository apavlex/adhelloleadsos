/**
 * Supplement Find Leads with public directory listings.
 * Prefers Outscraper (Yelp, Angi, Yellow Pages, Zillow agents) when configured;
 * falls back to pageScraper (Cheerio/Puppeteer) for BBB and when Outscraper fails.
 */

const { scrapePage } = require('./pageScraper');
const { sanitizeLeadCategoryName } = require('./leadCategory');
const outscraper = require('./outscraperClient');

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
  const n = parseInt(process.env.DIRECTORY_MAX_PAGES || '5', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 5;
}

const DIRECTORY_SOURCES = [
  {
    id: 'yelp',
    label: 'Yelp',
    outscraper: 'yelp',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      outscraper.buildYelpSearchUrl(keyword, city, state),
  },
  {
    id: 'angi',
    label: 'Angi',
    outscraper: 'angi',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      outscraper.buildAngiSearchUrl(keyword, city, state),
  },
  {
    id: 'yellowpages',
    label: 'Yellow Pages',
    outscraper: 'yellowpages',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(keyword)}&geo_location_terms=${encodeURIComponent(`${city}, ${state}`)}`,
  },
  {
    id: 'zillow_agents',
    label: 'Zillow Agents',
    outscraper: 'zillow_agents',
    preferDynamic: true,
    buildUrl: ({ city, state }) => outscraper.buildZillowAgentsSearchUrl(city, state),
  },
  {
    id: 'bbb',
    label: 'BBB',
    preferDynamic: true,
    buildUrl: ({ keyword, city, state }) =>
      `https://www.bbb.org/search?find_text=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(`${city}, ${state}`)}&find_type=Category`,
  },
];

function resolveProfileUrl(row, sourceId) {
  const raw = String(row.url || '').trim();
  if (raw && /^https?:/i.test(raw)) return raw;
  if (!raw) return '';
  const bases = {
    yelp: 'https://www.yelp.com',
    angi: 'https://www.angi.com',
  };
  const base = bases[sourceId];
  return base ? `${base}${raw.startsWith('/') ? '' : '/'}${raw}` : raw;
}

function listingToLead(row, ctx) {
  const profileUrl = resolveProfileUrl(row, row.source || ctx.sourceId || '');
  const title = row.title || 'N/A';
  const categoryHint = row.categoryName || ctx.keyword || 'N/A';
  return {
    title,
    phone: row.phone && row.phone !== 'N/A' ? row.phone : 'N/A',
    website: row.website && row.website !== 'N/A' ? row.website : 'N/A',
    email: 'N/A',
    categoryName: sanitizeLeadCategoryName(categoryHint, title, ctx.keyword || 'N/A'),
    address: row.address && row.address !== 'N/A' ? row.address : 'N/A',
    city: ctx.city || '',
    state: ctx.state || '',
    postalCode: '',
    totalScore: Number(row.totalScore) || 0,
    reviewsCount: parseInt(row.reviewsCount, 10) || 0,
    url: profileUrl || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
    leadSource: `directory_${row.source || 'web'}`,
    directorySource: row.source || '',
    cmsPlatform: row.cmsPlatform || undefined,
    techStackTags: row.techStackTags || undefined,
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

async function searchSourceViaOutscraper(source, ctx, integrationEnv, perSourceLimit) {
  const common = {
    keyword: ctx.keyword,
    city: ctx.city,
    state: ctx.state,
    maxResults: perSourceLimit,
    integrationEnv,
  };
  switch (source.outscraper) {
    case 'yelp':
      return outscraper.searchYelpDirectory(common);
    case 'angi':
      return outscraper.searchAngiDirectory(common);
    case 'yellowpages':
      return outscraper.searchYellowpagesDirectory(common);
    case 'zillow_agents':
      return outscraper.searchZillowAgentsDirectory(common);
    default:
      return [];
  }
}

async function searchSourceViaPageScraper(source, ctx) {
  const pageUrl = source.buildUrl(ctx);
  const page = await scrapePage(pageUrl, {
    preferDynamic: source.preferDynamic,
    sourceId: source.id,
  });
  if (!page.ok || !page.listings || !page.listings.length) {
    return { rows: [], error: page.error || 'empty' };
  }
  return { rows: page.listings, error: null };
}

function domainFromWebsite(website) {
  const raw = String(website || '').trim();
  if (!raw || raw === 'N/A') return '';
  try {
    const u = raw.startsWith('http') ? raw : `https://${raw}`;
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

async function enrichLeadsBuiltWith(leads, integrationEnv, cap) {
  if (!outscraper.isConfigured(integrationEnv)) return;
  const limit = Math.max(1, parseInt(cap, 10) || 8);
  let done = 0;
  for (const lead of leads) {
    if (done >= limit) break;
    const domain = domainFromWebsite(lead.website);
    if (!domain) continue;
    const stack = await outscraper.fetchBuiltWithTechStack({ domain, integrationEnv });
    if (!stack) continue;
    if (stack.cmsPlatform && !lead.cmsPlatform) lead.cmsPlatform = stack.cmsPlatform;
    if (stack.techStackTags && stack.techStackTags.length && !lead.techStackTags) {
      lead.techStackTags = stack.techStackTags;
    }
    done += 1;
  }
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: object, builtWithEnrich?: boolean }} params
 * @returns {Promise<Array>}
 */
async function searchDirectoryLeads(params) {
  const keyword = String(params.keyword || '').trim();
  const city = String(params.city || '').trim();
  const state = String(params.state || '').trim();
  const maxResults = Math.min(50, Math.max(1, parseInt(params.maxResults, 10) || 15));
  if (!keyword || !city || !state) return [];

  const integrationEnv = params.integrationEnv || null;
  const useOutscraper = outscraper.isConfigured(integrationEnv);
  const ctx = { keyword, city, state };
  const collected = [];
  const sources = DIRECTORY_SOURCES.slice(0, maxDirectoryPages());
  const perSourceLimit = Math.max(5, Math.ceil(maxResults / Math.max(1, sources.length)));

  for (const source of sources) {
    if (collected.length >= maxResults) break;
    let rows = [];

    if (useOutscraper && source.outscraper) {
      try {
        console.log(`[directoryLeadSearch] Outscraper ${source.label}…`);
        rows = await searchSourceViaOutscraper(source, ctx, integrationEnv, perSourceLimit);
      } catch (e) {
        console.warn(`[directoryLeadSearch] Outscraper ${source.label} failed:`, e.message);
      }
    }

    if (!rows.length && source.buildUrl) {
      try {
        const pageUrl = source.buildUrl(ctx);
        console.log(`[directoryLeadSearch] Scraping ${source.label}: ${pageUrl}`);
        const scraped = await searchSourceViaPageScraper(source, ctx);
        if (!scraped.rows.length) {
          console.warn(`[directoryLeadSearch] ${source.label}: no listings (${scraped.error || 'empty'})`);
        } else {
          rows = scraped.rows.map((r) => ({
            title: r.title,
            phone: r.phone,
            website: r.website,
            address: r.address,
            url: r.url,
            totalScore: 0,
            reviewsCount: 0,
          }));
        }
      } catch (e) {
        console.warn(`[directoryLeadSearch] ${source.label} failed:`, e.message);
      }
    }

    for (const row of rows) {
      collected.push(listingToLead({ ...row, source: source.id }, { ...ctx, sourceId: source.id }));
      if (collected.length >= maxResults) break;
    }
  }

  const deduped = dedupeLeads(collected);

  const wantBuiltWith =
    params.builtWithEnrich !== false && useOutscraper && truthyEnv(process.env.OUTSCRAPER_BUILTWITH_ENRICH ?? '1');
  if (wantBuiltWith && deduped.length) {
    try {
      await enrichLeadsBuiltWith(deduped, integrationEnv, Math.min(8, deduped.length));
    } catch (e) {
      console.warn('[directoryLeadSearch] BuiltWith enrich skipped:', e.message);
    }
  }

  return deduped;
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
  resolveProfileUrl,
  enrichLeadsBuiltWith,
};
