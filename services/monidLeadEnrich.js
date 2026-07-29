/**
 * Lead enrichment via Monid (Apollo org enrich + PDL company enrich fallback).
 */

const monid = require('./monidClient');
const { extractDomain } = require('./betterContactClient');
const { normalizeSocialUrl } = require('./socialUrlNormalize');

const APOLLO_ORG_ENRICH = { provider: 'apollo', endpoint: '/organizations/enrich' };
const APOLLO_COMPANY_SEARCH = { provider: 'apollo', endpoint: '/mixed_companies/search' };
const PDL_COMPANY_ENRICH = { provider: 'pdl', endpoint: '/v5/company/enrich' };

const APOLLO_SEARCH_MIN_SCORE = 0.42;
const APOLLO_SEARCH_AMBIGUOUS_MIN_SCORE = 0.72;

const GENERIC_BUSINESS_WORDS = new Set([
  'construction',
  'contractor',
  'contractors',
  'remodel',
  'remodeling',
  'roofing',
  'plumbing',
  'plumber',
  'electric',
  'electrical',
  'hvac',
  'services',
  'service',
  'company',
  'home',
  'homes',
  'building',
  'general',
  'nw',
  'ne',
  'se',
  'sw',
  'north',
  'south',
  'east',
  'west',
  'and',
  'the',
  'group',
  'solutions',
  'llc',
  'inc',
  'ltd',
]);

function distinctiveTokens(title) {
  return normTitle(title)
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC_BUSINESS_WORDS.has(w));
}

function scoreApolloSearchCandidate(leadTitle, candidateTitle) {
  const base = titleSimilarity(leadTitle, candidateTitle);
  const leadTokens = normTitle(leadTitle).split(' ').filter((w) => w.length > 1);
  const leadDistinct = leadTokens.filter((w) => !GENERIC_BUSINESS_WORDS.has(w));
  const candDistinct = distinctiveTokens(candidateTitle);

  if (leadDistinct.length) {
    const candSet = new Set(candDistinct);
    const distinctMatch = leadDistinct.filter((t) => candSet.has(t)).length;
    if (!distinctMatch) return base * 0.2;
    return base * 0.45 + (distinctMatch / leadDistinct.length) * 0.55;
  }

  if (leadTokens.length && leadTokens.every((t) => GENERIC_BUSINESS_WORDS.has(t))) {
    return base * 0.55;
  }

  return base;
}

function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|corp|co\.?|d\.?b\.?a\.?)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(leadTitle, candidateTitle) {
  const A = new Set(normTitle(leadTitle).split(' ').filter((w) => w.length > 1));
  const B = new Set(normTitle(candidateTitle).split(' ').filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

function deriveApolloSearchName(leadTitle) {
  const norm = normTitle(leadTitle);
  const words = norm.split(' ').filter(Boolean);
  if (!words.length) return '';
  const significant = words.filter((w) => w.length > 2 || /^(nw|ne|se|sw)$/i.test(w));
  if (significant.length >= 2) return significant.slice(-4).join(' ');
  return words.slice(-3).join(' ');
}

function buildApolloSearchQuery(lead) {
  const name = deriveApolloSearchName(lead.title || lead.company || '');
  if (!name) return null;

  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  const query = {
    q_organization_name: name,
    page: 1,
    per_page: 5,
  };
  if (city || state) {
    query['organization_locations[]'] = [city && state ? `${city}, ${state}` : city || state];
  }
  return query;
}

function listApolloSearchOrganizations(output) {
  if (!output || typeof output !== 'object') return [];
  const orgs = Array.isArray(output.organizations) ? output.organizations : [];
  const accounts = Array.isArray(output.accounts) ? output.accounts : [];
  const fromAccounts = accounts
    .map((a) => (a && a.organization ? a.organization : a))
    .filter(Boolean);
  return [...orgs, ...fromAccounts];
}

function pickBestApolloSearchOrg(lead, organizations) {
  const list = Array.isArray(organizations) ? organizations : [];
  const leadTitle = lead.title || lead.company || '';
  const leadTokens = normTitle(leadTitle).split(' ').filter((w) => w.length > 1);
  const ambiguousName =
    leadTokens.length > 0 && leadTokens.every((t) => GENERIC_BUSINESS_WORDS.has(t));
  const minScore = ambiguousName ? APOLLO_SEARCH_AMBIGUOUS_MIN_SCORE : APOLLO_SEARCH_MIN_SCORE;

  let best = null;
  let bestScore = 0;
  for (const org of list) {
    if (!org || typeof org !== 'object') continue;
    const domain = org.primary_domain || extractDomain(org.website_url);
    if (!domain && !org.website_url) continue;
    const score = scoreApolloSearchCandidate(leadTitle, org.name || '');
    if (score > bestScore) {
      bestScore = score;
      best = org;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { org: best, score: bestScore };
}

async function discoverCompanyViaApolloSearch(lead, integrationEnv) {
  const query = buildApolloSearchQuery(lead);
  if (!query) return null;

  const attempts = [query];
  const city = String(lead.city || '').trim();
  if (query['organization_locations[]'] && city) {
    attempts.push({ ...query, 'organization_locations[]': undefined, q_organization_name: query.q_organization_name });
  }

  for (const q of attempts) {
    const cleanQuery = { ...q };
    if (!cleanQuery['organization_locations[]']) delete cleanQuery['organization_locations[]'];
    try {
      const run = await monid.runEndpoint({
        ...APOLLO_COMPANY_SEARCH,
        query: cleanQuery,
        integrationEnv,
        maxWaitMs: 45_000,
      });
      const picked = pickBestApolloSearchOrg(lead, listApolloSearchOrganizations(run.output || {}));
      if (!picked) continue;

      const { org, score } = picked;
      const domain = org.primary_domain || extractDomain(org.website_url);
      const website = org.website_url ? normalizeWebsiteUrl(org.website_url) : domain ? normalizeWebsiteUrl(domain) : '';
      const extract = apolloOrgToExtract({ organization: org });
      console.log(
        `[Monid] Apollo search matched "${org.name}" (score ${score.toFixed(2)})${domain ? ` → ${domain}` : ''}`,
      );
      return { org, domain, website, extract, score };
    } catch (err) {
      console.warn('[Monid] Apollo company search failed:', err.message);
    }
  }

  return null;
}

function normalizeWebsiteUrl(href) {
  const s = String(href || '').trim();
  if (!s || s === 'N/A') return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^www\./i, '')}`;
}

function setIfPresent(out, key, value) {
  const s = value == null ? '' : String(value).trim();
  if (s && s !== 'N/A') out[key] = s;
}

/**
 * @param {object} output — Monid Apollo output
 * @returns {object} Firecrawl-shaped extract
 */
function apolloOrgToExtract(output) {
  const org = output && (output.organization || output);
  if (!org || typeof org !== 'object') return {};
  if (!org.name && !org.primary_domain && !org.website_url) return {};

  const out = {};
  const phone =
    (org.primary_phone && org.primary_phone.sanitized_number) ||
    org.sanitized_phone ||
    org.phone;
  setIfPresent(out, 'phone', phone);

  const web = org.website_url || org.primary_domain;
  if (web) out.website = normalizeWebsiteUrl(web);

  setIfPresent(out, 'linkedin', normalizeSocialUrl(org.linkedin_url));
  setIfPresent(out, 'facebook', normalizeSocialUrl(org.facebook_url));
  setIfPresent(out, 'twitter', normalizeSocialUrl(org.twitter_url));
  setIfPresent(out, 'instagram', normalizeSocialUrl(org.instagram_url));

  return out;
}

/**
 * @param {object} output — Monid PDL output
 * @returns {object} Firecrawl-shaped extract
 */
function pdlCompanyToExtract(output) {
  if (!output || typeof output !== 'object') return {};
  if (output.status === 404 || output.error) return {};

  const out = {};
  setIfPresent(out, 'phone', output.phone);
  if (output.website) out.website = normalizeWebsiteUrl(output.website);
  setIfPresent(out, 'linkedin', normalizeSocialUrl(output.linkedin_url));
  setIfPresent(out, 'facebook', normalizeSocialUrl(output.facebook_url));
  setIfPresent(out, 'twitter', normalizeSocialUrl(output.twitter_url));

  const loc = output.location;
  if (loc && typeof loc === 'object') {
    setIfPresent(out, 'address', loc.street_address);
    if (!out.address && loc.name) setIfPresent(out, 'address', loc.name);
  }

  return out;
}

function extractHasSignal(extract) {
  if (!extract || typeof extract !== 'object') return false;
  const has = (v) => v != null && String(v).trim() && String(v).trim() !== 'N/A';
  return Boolean(
    has(extract.email) ||
      has(extract.phone) ||
      has(extract.website) ||
      has(extract.linkedin) ||
      has(extract.facebook) ||
      has(extract.instagram) ||
      has(extract.twitter) ||
      has(extract.address),
  );
}

function buildApolloQuery(lead) {
  const name = String(lead.title || lead.company || '').trim();
  const domain = extractDomain(lead.website);
  const website =
    lead.website && lead.website !== 'N/A' ? String(lead.website).trim() : '';
  const linkedin =
    lead.linkedin && lead.linkedin !== 'N/A' ? String(lead.linkedin).trim() : '';

  const q = {};
  if (domain) q.domain = domain;
  if (website) q.website = normalizeWebsiteUrl(website);
  if (name) q.name = name;
  if (linkedin) q.linkedin_url = linkedin;
  return Object.keys(q).length ? q : null;
}

function buildPdlBody(lead) {
  const name = String(lead.title || lead.company || '').trim();
  let website = extractDomain(lead.website);
  if (!website && lead.website && lead.website !== 'N/A') {
    website = String(lead.website)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];
  }
  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  if (!name && !website) return null;

  const body = {};
  if (name) body.name = name;
  if (website) body.website = website;
  if (city) body.locality = city;
  if (state) body.region = state;
  return body;
}

/**
 * Enrich one lead via Monid (Apollo first, PDL fallback).
 * @param {object} lead
 * @param {Record<string, string>|null} [integrationEnv]
 */
async function enrichLeadFromMonid(lead, integrationEnv) {
  if (!monid.isConfigured(integrationEnv)) return null;

  let extract = {};
  let provider = null;
  let workingLead = lead;
  const hasDomain = Boolean(extractDomain(lead.website));

  if (!hasDomain) {
    const discovered = await discoverCompanyViaApolloSearch(lead, integrationEnv);
    if (discovered) {
      if (discovered.extract && Object.keys(discovered.extract).length) {
        extract = { ...extract, ...discovered.extract };
        provider = 'apollo-search';
      }
      if (discovered.website || discovered.domain) {
        workingLead = {
          ...lead,
          website: discovered.website || normalizeWebsiteUrl(discovered.domain),
        };
      }
    }
  }

  const apolloQuery = buildApolloQuery(workingLead);
  const needsApolloEnrich =
    apolloQuery &&
    (!extractHasSignal(extract) ||
      (!extract.phone && (apolloQuery.domain || apolloQuery.website || apolloQuery.name)));

  if (needsApolloEnrich) {
    try {
      const run = await monid.runEndpoint({
        ...APOLLO_ORG_ENRICH,
        query: apolloQuery,
        integrationEnv,
        maxWaitMs: 45_000,
      });
      const partial = apolloOrgToExtract(run.output || {});
      if (Object.keys(partial).length) {
        extract = { ...extract, ...partial };
        provider = provider ? `${provider}+apollo` : 'apollo';
      }
    } catch (err) {
      console.warn('[Monid] Apollo enrich failed:', err.message);
    }
  }

  if (!extractHasSignal(extract)) {
    const pdlBody = buildPdlBody(workingLead);
    if (pdlBody) {
      try {
        const run = await monid.runEndpoint({
          ...PDL_COMPANY_ENRICH,
          input: pdlBody,
          integrationEnv,
          maxWaitMs: 45_000,
        });
        if (!run.noMatch) {
          const partial = pdlCompanyToExtract(run.output || {});
          if (Object.keys(partial).length) {
            extract = { ...extract, ...partial };
            provider = provider ? `${provider}+pdl` : 'pdl';
          }
        }
      } catch (err) {
        console.warn('[Monid] PDL enrich failed:', err.message);
      }
    }
  }

  if (!extractHasSignal(extract)) {
    return { extract: {}, enriched: false, provider: null };
  }

  return { extract, enriched: true, provider };
}

module.exports = {
  isConfigured: monid.isConfigured,
  apolloOrgToExtract,
  pdlCompanyToExtract,
  extractHasSignal,
  buildApolloQuery,
  buildApolloSearchQuery,
  buildPdlBody,
  deriveApolloSearchName,
  pickBestApolloSearchOrg,
  enrichLeadFromMonid,
};
