/**
 * Per-workspace API keys and URLs. Same resolved values apply to every member (owner, admin, SDR, viewer).
 * Resolution: non-empty workspace value wins; otherwise process.env (deployment default).
 */

const dbService = require('./database');
const { decryptIntegrations, encryptIntegrations, isEncryptionAvailable } = require('./workspaceIntegrationSecrets');

/** Keys stored in encrypted blob (plain object before encrypt). */
const INTEGRATION_FIELDS = [
  'rapidapiKey',
  'rapidapiHost',
  'rapidapiLocalBusinessEndpoint',
  'rapidapiSearchQueryParam',
  'rapidapiSearchLimitParam',
  'apifyApiToken',
  'outscraperApiKey',
  'outscraperApiBase',
  'searchapiApiKey',
  'mapsSearchPrimary',
  'firecrawlApiKey',
  'enrichPrimary',
  'crawl4aiBaseUrl',
  'crawl4aiApiToken',
];

/** Map stored field → process.env name used by provider clients */
const FIELD_TO_ENV = {
  rapidapiKey: 'RAPIDAPI_KEY',
  rapidapiHost: 'RAPIDAPI_HOST',
  rapidapiLocalBusinessEndpoint: 'RAPIDAPI_LOCAL_BUSINESS_ENDPOINT',
  rapidapiSearchQueryParam: 'RAPIDAPI_SEARCH_QUERY_PARAM',
  rapidapiSearchLimitParam: 'RAPIDAPI_SEARCH_LIMIT_PARAM',
  apifyApiToken: 'APIFY_API_TOKEN',
  outscraperApiKey: 'OUTSCRAPER_API_KEY',
  outscraperApiBase: 'OUTSCRAPER_API_BASE',
  searchapiApiKey: 'SEARCHAPI_API_KEY',
  mapsSearchPrimary: 'SEARCH_MAPS_PRIMARY',
  firecrawlApiKey: 'FIRECRAWL_API_KEY',
  enrichPrimary: 'ENRICH_PRIMARY',
  crawl4aiBaseUrl: 'CRAWL4AI_BASE_URL',
  crawl4aiApiToken: 'CRAWL4AI_API_TOKEN',
};

/**
 * Decrypt workspace.integrationsCipher into a field object, or {}.
 * @param {object|null} workspace
 */
function decryptedFromWorkspace(workspace) {
  if (!workspace || !workspace.integrationsCipher) return {};
  const dec = decryptIntegrations(workspace.integrationsCipher);
  if (!dec || typeof dec !== 'object') return {};
  return dec;
}

/**
 * Merge workspace secrets with process.env for use as a flat env-like object.
 * Workspace non-empty string wins for each mapped field.
 * @param {string} [workspaceId]
 * @returns {Promise<Record<string, string>>}
 */
async function getResolvedIntegrationEnv(workspaceId) {
  const wid = workspaceId || 'default';
  const ws = await dbService.getWorkspace(wid);
  const fromWs = decryptedFromWorkspace(ws);
  const out = {};
  for (const field of INTEGRATION_FIELDS) {
    const envName = FIELD_TO_ENV[field];
    const v = fromWs[field];
    if (typeof v === 'string' && v.trim()) {
      out[envName] = v.trim();
    } else {
      const ev = process.env[envName];
      out[envName] = typeof ev === 'string' ? ev : ev != null ? String(ev) : '';
    }
  }
  return out;
}

/**
 * Build next encrypted payload from POST body + existing secrets (empty field = keep previous).
 * @param {object} existingPlain
 * @param {object} body — trimmed strings from form
 */
function mergeIntegrationUpdates(existingPlain, body) {
  const next = { ...(existingPlain || {}) };
  for (const field of INTEGRATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s === '') continue;
    next[field] = s;
  }
  return next;
}

/**
 * Explicit clear: set field to empty in `next` when body has `field_clear=1` (checkbox).
 * @param {object} existingPlain
 * @param {object} body
 */
function applyClears(existingPlain, body) {
  const next = { ...(existingPlain || {}) };
  for (const field of INTEGRATION_FIELDS) {
    const clearKey = `${field}_clear`;
    if (body[clearKey] === '1' || body[clearKey] === 'on') {
      delete next[field];
    }
  }
  return next;
}

/**
 * Persist merged integrations on workspace (encrypt whole blob).
 * @param {string} workspaceId
 * @param {object} plain — full plain object to store
 */
async function saveWorkspaceIntegrations(workspaceId, plain) {
  const wid = workspaceId || 'default';
  const ws = (await dbService.getWorkspace(wid)) || { id: wid };
  const cipher = encryptIntegrations(plain);
  await dbService.saveWorkspace(wid, {
    ...ws,
    integrationsCipher: cipher,
    integrationsUpdatedAt: new Date().toISOString(),
  });
}

/**
 * Masks for UI: which keys are set (no lengths leaked beyond "set").
 */
function integrationMasks(workspace) {
  const p = decryptedFromWorkspace(workspace);
  const masks = {};
  /** Only mask values that are secrets; show plain text for hosts/URLs/param names. */
  const maskSecret = new Set([
    'rapidapiKey',
    'apifyApiToken',
    'outscraperApiKey',
    'searchapiApiKey',
    'firecrawlApiKey',
    'crawl4aiApiToken',
  ]);
  for (const field of INTEGRATION_FIELDS) {
    const raw = p[field];
    const trimmed = raw != null ? String(raw).trim() : '';
    if (!trimmed) {
      masks[field] = '';
      continue;
    }
    masks[field] = maskSecret.has(field) ? '••••••••' : trimmed;
  }
  return masks;
}

module.exports = {
  INTEGRATION_FIELDS,
  FIELD_TO_ENV,
  decryptedFromWorkspace,
  getResolvedIntegrationEnv,
  mergeIntegrationUpdates,
  applyClears,
  saveWorkspaceIntegrations,
  integrationMasks,
  isEncryptionAvailable,
  encryptIntegrations,
};
