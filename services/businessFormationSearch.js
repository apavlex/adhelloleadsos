/**
 * Search newly registered US businesses via Apify formation actor.
 */

const { runActor, isApifyConfigured } = require('./listingSearch/apifyClient');
const {
  DEFAULT_ACTOR_ID,
  parseFormationStatesFromBody,
  stateNamesForCodes,
  defaultRegisteredAfter,
  parseEntityTypesFromBody,
} = require('./businessFormationConstants');

function isConfigured(integrationEnv) {
  return isApifyConfigured(integrationEnv);
}

function resolveRegisteredAfter(params = {}) {
  const explicit = String(params.registeredAfter || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const daysBack = params.registeredAfterDays != null ? Number(params.registeredAfterDays) : 30;
  return defaultRegisteredAfter(Number.isFinite(daysBack) ? daysBack : 30);
}

function buildActorInput(params = {}) {
  const stateCodes = Array.isArray(params.stateCodes) ? params.stateCodes : [];
  const states = stateNamesForCodes(stateCodes);
  if (!states.length) {
    throw new Error('Select at least one supported state (NY, CO, PA, CT, OR).');
  }

  const maxResults = Math.min(1000, Math.max(1, parseInt(params.maxResults, 10) || 50));
  const entityTypes = Array.isArray(params.entityTypes) ? params.entityTypes : [];
  const keyword = String(params.keyword || '').trim();
  const monitorMode = params.monitorMode === true || String(params.monitorMode || '').toLowerCase() === 'true';

  const input = {
    states,
    registeredAfter: resolveRegisteredAfter(params),
    statusActiveOnly: params.statusActiveOnly !== false,
    maxResults,
    monitorMode,
  };
  if (entityTypes.length) input.entityTypes = entityTypes;
  if (keyword) input.keyword = keyword;
  return input;
}

/**
 * @param {object} params
 * @param {string[]} params.stateCodes
 * @param {Record<string,string>} [integrationEnv]
 */
async function searchBusinessFormations(params, integrationEnv) {
  if (!isConfigured(integrationEnv)) {
    throw new Error(
      'Business formation search requires Apify. Add APIFY_API_TOKEN under Workspace → API integrations.'
    );
  }

  const input = buildActorInput(params);
  const items = await runActor(integrationEnv, DEFAULT_ACTOR_ID, input, 'FORMATION');
  const results = items || [];

  return {
    results,
    input,
    stateCodes: params.stateCodes || [],
  };
}

function parseSearchParamsFromBody(body) {
  const stateCodes = parseFormationStatesFromBody(body);
  const entityTypes = parseEntityTypesFromBody(body);
  const keyword = String((body && body.keyword) || (body && body.formationKeyword) || '').trim();
  const registeredAfter = String((body && body.registeredAfter) || '').trim();
  const monitorMode =
    String((body && body.monitorMode) || '').toLowerCase() === 'on' ||
    String((body && body.monitorMode) || '').toLowerCase() === 'true' ||
    String((body && body.formationMonitor) || '').toLowerCase() === 'on';
  const maxResults = Math.min(100, Math.max(1, parseInt(body && body.maxResults, 10) || 50));

  return {
    stateCodes,
    entityTypes,
    keyword,
    registeredAfter: /^\d{4}-\d{2}-\d{2}$/.test(registeredAfter) ? registeredAfter : '',
    monitorMode,
    maxResults,
  };
}

function scheduleKeywordLabel(params = {}) {
  const states = (params.stateCodes || []).join(', ') || 'US';
  const entity = (params.entityTypes || []).join(', ');
  const parts = ['New formations'];
  if (entity) parts.push(entity);
  parts.push(states);
  if (params.keyword) parts.push(`"${params.keyword}"`);
  return parts.join(' · ');
}

module.exports = {
  DEFAULT_ACTOR_ID,
  isConfigured,
  buildActorInput,
  searchBusinessFormations,
  parseSearchParamsFromBody,
  resolveRegisteredAfter,
  scheduleKeywordLabel,
};
