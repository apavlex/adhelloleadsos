/**
 * Lead enrichment via Monid (Apollo org enrich + PDL company enrich fallback).
 */

const monid = require('./monidClient');
const { extractDomain } = require('./betterContactClient');

const APOLLO_ORG_ENRICH = { provider: 'apollo', endpoint: '/organizations/enrich' };
const PDL_COMPANY_ENRICH = { provider: 'pdl', endpoint: '/v5/company/enrich' };

function normalizeSocialUrl(href) {
  const s = String(href || '').trim();
  if (!s || s === 'N/A') return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/\//, '')}`;
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

  const apolloQuery = buildApolloQuery(lead);
  if (apolloQuery) {
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
        provider = 'apollo';
      }
    } catch (err) {
      console.warn('[Monid] Apollo enrich failed:', err.message);
    }
  }

  if (!extractHasSignal(extract)) {
    const pdlBody = buildPdlBody(lead);
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
  buildPdlBody,
  enrichLeadFromMonid,
};
