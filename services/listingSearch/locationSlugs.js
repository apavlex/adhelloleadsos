/** Map city/state to Craigslist + Facebook Marketplace URL slugs. Override via env JSON. */

const CRAIGSLIST_OVERRIDES = parseOverrideMap('LISTING_CRAIGSLIST_CITY_MAP');
const FACEBOOK_OVERRIDES = parseOverrideMap('LISTING_FACEBOOK_CITY_MAP');

function parseOverrideMap(envKey) {
  try {
    const raw = process.env[envKey];
    if (!raw || !String(raw).trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeKey(city, state) {
  return `${String(city || '').trim().toLowerCase()}|${String(state || '').trim().toLowerCase()}`;
}

function baseSlug(city) {
  return String(city || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

/** Craigslist subdomain slug, e.g. phoenix, sfbay, losangeles */
function craigslistCitySlug(city, state) {
  const key = normalizeKey(city, state);
  if (CRAIGSLIST_OVERRIDES[key]) return CRAIGSLIST_OVERRIDES[key];
  const c = String(city || '').trim().toLowerCase();
  const s = String(state || '').trim().toLowerCase();
  const known = {
    'san francisco|ca': 'sfbay',
    'sf|ca': 'sfbay',
    'new york|ny': 'newyork',
    'nyc|ny': 'newyork',
    'los angeles|ca': 'losangeles',
    'la|ca': 'losangeles',
    'washington|dc': 'washingtondc',
    'dc|dc': 'washingtondc',
  };
  if (known[key]) return known[key];
  if (s === 'ca' && c.includes('san francisco')) return 'sfbay';
  return baseSlug(city) || 'newyork';
}

/** Facebook Marketplace city slug, e.g. phoenix, losangeles, nyc */
function facebookCitySlug(city, state) {
  const key = normalizeKey(city, state);
  if (FACEBOOK_OVERRIDES[key]) return FACEBOOK_OVERRIDES[key];
  const c = String(city || '').trim().toLowerCase();
  const known = {
    'new york|ny': 'nyc',
    'nyc|ny': 'nyc',
    'los angeles|ca': 'losangeles',
    'la|ca': 'losangeles',
    'san francisco|ca': 'sanfrancisco',
    'sf|ca': 'sanfrancisco',
    'washington|dc': 'dc',
  };
  if (known[key]) return known[key];
  return baseSlug(city) || 'nyc';
}

module.exports = {
  craigslistCitySlug,
  facebookCitySlug,
};
