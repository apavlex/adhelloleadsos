/**
 * US business formation search — Apify actor + supported states.
 * Actor: scrapesage/us-business-formation-scraper
 */

const DEFAULT_ACTOR_ID =
  String(process.env.APIFY_BUSINESS_FORMATION_ACTOR_ID || '').trim() ||
  'scrapesage/us-business-formation-scraper';

/** States with open-data registries supported by the Apify actor. */
const FORMATION_STATES = [
  { code: 'NY', name: 'New York' },
  { code: 'CO', name: 'Colorado' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'OR', name: 'Oregon' },
];

const FORMATION_STATE_BY_CODE = Object.fromEntries(FORMATION_STATES.map((s) => [s.code, s]));
const FORMATION_STATE_BY_NAME = Object.fromEntries(
  FORMATION_STATES.map((s) => [s.name.toLowerCase(), s])
);

const ENTITY_TYPES = [
  { value: 'LLC', label: 'LLC' },
  { value: 'Corporation', label: 'Corporation' },
  { value: 'Nonprofit', label: 'Nonprofit' },
  { value: 'Partnership', label: 'Partnership' },
  { value: 'Sole Proprietorship', label: 'Sole proprietorship' },
  { value: 'Trade Name', label: 'Trade name / DBA' },
];

function normalizeStateCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  if (FORMATION_STATE_BY_CODE[upper]) return upper;
  const byName = FORMATION_STATE_BY_NAME[s.toLowerCase()];
  if (byName) return byName.code;
  return '';
}

function parseFormationStatesFromBody(body) {
  const raw = body && body.formationStates;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    list = raw.split(/[,|]+/).map((x) => x.trim());
  } else if (body && body.state) {
    list = [body.state];
  }
  const codes = [];
  for (const item of list) {
    const code = normalizeStateCode(item);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

function stateNamesForCodes(codes) {
  return (codes || [])
    .map((c) => FORMATION_STATE_BY_CODE[c]?.name || c)
    .filter(Boolean);
}

function defaultRegisteredAfter(daysBack = 30) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(1, daysBack));
  return d.toISOString().slice(0, 10);
}

function parseEntityTypesFromBody(body) {
  const raw = body && body.entityTypes;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    list = raw.split(/[,|]+/).map((x) => x.trim());
  } else if (body && body.entityType) {
    list = [body.entityType];
  }
  const allowed = new Set(ENTITY_TYPES.map((e) => e.value));
  return list.map((x) => String(x || '').trim()).filter((x) => allowed.has(x));
}

module.exports = {
  DEFAULT_ACTOR_ID,
  FORMATION_STATES,
  FORMATION_STATE_BY_CODE,
  ENTITY_TYPES,
  normalizeStateCode,
  parseFormationStatesFromBody,
  stateNamesForCodes,
  defaultRegisteredAfter,
  parseEntityTypesFromBody,
};
