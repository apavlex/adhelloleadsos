/**
 * BuiltWith tech stack enrichment via Outscraper (sidebar, Focus, contact hunt).
 */

const outscraper = require('./outscraperClient');
const outscraperLeadEnrich = require('./outscraperLeadEnrich');

function truthyEnv(v) {
  const s = String(v ?? '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function builtWithEnrichEnabled() {
  return truthyEnv(process.env.OUTSCRAPER_BUILTWITH_ENRICH ?? '1');
}

function hasValue(v) {
  const s = String(v == null ? '' : v).trim();
  return s && s !== 'N/A' && s !== '—';
}

function parseTechStackTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean);
  } catch {
    /* plain string */
  }
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function leadNeedsBuiltWith(lead) {
  if (!builtWithEnrichEnabled()) return false;
  if (!lead) return false;
  const domain = outscraperLeadEnrich.resolveLeadDomain(lead);
  if (!domain) return false;
  const missingCms = !hasValue(lead.cmsPlatform);
  const tags = parseTechStackTags(lead.techStackTags);
  const missingTags = tags.length === 0;
  return missingCms || missingTags;
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 * @returns {Promise<{ used: boolean, patch: object, stack: object|null }>}
 */
async function enrichLeadFromBuiltWith(lead, integrationEnv) {
  if (!outscraper.isConfigured(integrationEnv) || !builtWithEnrichEnabled()) {
    return { used: false, patch: {}, stack: null };
  }
  const domain = outscraperLeadEnrich.resolveLeadDomain(lead);
  if (!domain) return { used: false, patch: {}, stack: null, error: 'no_domain' };

  const stack = await outscraper.fetchBuiltWithTechStack({ domain, integrationEnv });
  if (!stack) return { used: false, patch: {}, stack: null };

  const patch = {};
  if (!hasValue(lead.cmsPlatform) && stack.cmsPlatform) patch.cmsPlatform = stack.cmsPlatform;
  const existingTags = parseTechStackTags(lead.techStackTags);
  if (existingTags.length === 0 && stack.techStackTags && stack.techStackTags.length) {
    patch.techStackTags = stack.techStackTags.slice(0, 24);
  }
  patch.builtWithDomain = domain;
  patch.builtWithUrl = outscraper.buildBuiltWithUrl(domain);

  const used = Object.keys(patch).length > 0;
  return { used, patch, stack };
}

module.exports = {
  builtWithEnrichEnabled,
  leadNeedsBuiltWith,
  enrichLeadFromBuiltWith,
  parseTechStackTags,
};
