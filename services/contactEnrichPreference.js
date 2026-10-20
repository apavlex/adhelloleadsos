/**
 * Contact enrich preference for Enhance / Get More Contacts / ensureLeadEmail.
 * Default: MoltSets → Outscraper fallback. Not a Maps search provider.
 */

const outscraper = require('./outscraperClient');
const moltsetsClient = require('./moltsetsClient');

function apifyConfigured(integrationEnv) {
  const t = (integrationEnv && integrationEnv.APIFY_API_TOKEN) || process.env.APIFY_API_TOKEN;
  return Boolean(String(t || '').trim());
}

/**
 * @returns {'moltsets'|'outscraper'}
 */
function resolvePrimary(integrationEnv) {
  const fromWs = String((integrationEnv && integrationEnv.CONTACT_ENRICH_PRIMARY) || '')
    .toLowerCase()
    .trim();
  const fromEnv = String(process.env.CONTACT_ENRICH_PRIMARY || '')
    .toLowerCase()
    .trim();
  const v = fromWs || fromEnv;
  if (v === 'outscraper') return 'outscraper';
  // auto / moltsets / empty → MoltSets primary
  return 'moltsets';
}

function preferMoltsets(integrationEnv) {
  return resolvePrimary(integrationEnv) === 'moltsets';
}

function getContactEnrichProviderStatusList(integrationEnv) {
  const primary = resolvePrimary(integrationEnv);
  return [
    {
      id: 'moltsets',
      label: primary === 'moltsets' ? 'MoltSets (primary)' : 'MoltSets',
      configured: moltsetsClient.isConfigured(integrationEnv),
    },
    {
      id: 'outscraper',
      label: primary === 'moltsets' ? 'Outscraper (fallback)' : 'Outscraper (primary)',
      configured: outscraper.isConfigured(integrationEnv),
    },
    {
      id: 'apify',
      label: 'Apify',
      configured: apifyConfigured(integrationEnv),
    },
  ];
}

module.exports = {
  resolvePrimary,
  preferMoltsets,
  getContactEnrichProviderStatusList,
};
