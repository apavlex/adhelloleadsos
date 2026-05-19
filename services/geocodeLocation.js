/**
 * Server-side geocode for Find Leads (uses GOOGLE_MAPS_API_KEY when set).
 */

const { getGoogleMapsApiKey } = require('./googleMapsKey');

const CA_PROVINCES = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
]);

function countryForState(state) {
  const s = String(state || '')
    .trim()
    .toUpperCase();
  if (CA_PROVINCES.has(s)) return 'Canada';
  return 'USA';
}

function buildLocationLabel(city, state) {
  const c = String(city || '').trim();
  const s = String(state || '')
    .trim()
    .toUpperCase();
  if (!c) return '';
  const country = countryForState(s);
  if (!s) return `${c}, ${country}`;
  return `${c}, ${s}, ${country}`;
}

function buildMapsSearchQuery(keyword, city, state) {
  const kw = String(keyword || '').trim();
  const loc = buildLocationLabel(city, state);
  if (!kw) return loc;
  if (!loc) return kw;
  return `${kw} in ${loc}`;
}

/**
 * @param {string} city
 * @param {string} state
 * @returns {Promise<{ lat: number, lng: number, formattedAddress?: string, countryCode?: string } | null>}
 */
async function geocodeCityState(city, state) {
  const key = getGoogleMapsApiKey();
  const address = buildLocationLabel(city, state);
  if (!key || !address) return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'OK' || !Array.isArray(data.results) || !data.results[0]) {
      return null;
    }
    const first = data.results[0];
    const loc = first.geometry && first.geometry.location;
    if (!loc || loc.lat == null || loc.lng == null) return null;
    let countryCode = '';
    for (const comp of first.address_components || []) {
      if ((comp.types || []).includes('country')) {
        countryCode = String(comp.short_name || '').toUpperCase();
        break;
      }
    }
    return {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      formattedAddress: String(first.formatted_address || ''),
      countryCode,
    };
  } catch (e) {
    console.warn('[geocodeLocation]', e.message);
    return null;
  }
}

module.exports = {
  CA_PROVINCES,
  countryForState,
  buildLocationLabel,
  buildMapsSearchQuery,
  geocodeCityState,
};
