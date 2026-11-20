/**
 * Google Maps / Business Profile link for lead socials.
 * Prefer a stored Maps listing URL; otherwise build a search from name + location
 * so similarly named businesses across the USA/world don't collide.
 */

function cleanPart(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === 'N/A' || s === '—' || s === '-') return '';
  return s;
}

function isGoogleMapsListingUrl(absUrl) {
  try {
    const u = new URL(absUrl);
    const h = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (h === 'maps.app.goo.gl') return true;
    if (h === 'goo.gl' && u.pathname.includes('maps')) return true;
    if (h.endsWith('google.com') || h.endsWith('google.co.uk')) {
      if (u.pathname.includes('/maps/')) return true;
      if (u.search.includes('cid=') || u.search.includes('q=place_id:')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Build "Name Address City State" without duplicating city/state already in address.
 * @param {{ title?: string, address?: string, city?: string, state?: string }} parts
 * @returns {string}
 */
function buildGoogleMapsSearchQuery(parts) {
  const title = cleanPart(parts && parts.title);
  const address = cleanPart(parts && parts.address);
  const city = cleanPart(parts && parts.city);
  const state = cleanPart(parts && parts.state);

  const out = [];
  if (title) out.push(title);
  if (address) out.push(address);

  const soFar = () => out.join(' ').toLowerCase();
  if (city && !soFar().includes(city.toLowerCase())) out.push(city);
  if (state && !soFar().includes(state.toLowerCase())) out.push(state);

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ url?: string, title?: string, address?: string, city?: string, state?: string }|null|undefined} leadOrParts
 * @returns {string} absolute Maps listing or search URL, or ''
 */
function resolveGoogleMapsSearchHref(leadOrParts) {
  const L = leadOrParts && typeof leadOrParts === 'object' ? leadOrParts : {};
  const raw = cleanPart(L.url);
  if (raw && /^https?:\/\//i.test(raw) && isGoogleMapsListingUrl(raw)) return raw;

  const query = buildGoogleMapsSearchQuery({
    title: L.title,
    address: L.address,
    city: L.city,
    state: L.state,
  });
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

module.exports = {
  buildGoogleMapsSearchQuery,
  resolveGoogleMapsSearchHref,
  isGoogleMapsListingUrl,
};
