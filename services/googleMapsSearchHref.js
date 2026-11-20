/**
 * Google Maps / Business Profile link for lead socials.
 * Search is "Name + ZIP" (or city/state) so street-address matches don't
 * swallow the business name across the USA/world.
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

/** US ZIP / ZIP+4, or loose international postal tokens at end of a line. */
function extractZip(raw) {
  const s = cleanPart(raw);
  if (!s) return '';
  const us = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (us) return us[1];
  return '';
}

function resolveZip(parts) {
  const direct =
    cleanPart(parts && parts.zip) ||
    cleanPart(parts && parts.postalCode) ||
    cleanPart(parts && parts.postal);
  if (direct) {
    const fromDirect = extractZip(direct) || direct;
    if (fromDirect) return fromDirect;
  }
  return (
    extractZip(parts && parts.address) ||
    extractZip([parts && parts.city, parts && parts.state].filter(Boolean).join(' '))
  );
}

/**
 * Build "Name ZIP" (preferred) or "Name City State" when zip is unknown.
 * Avoid leading with street address — Maps treats that as the place and drops the name.
 * @param {{ title?: string, address?: string, city?: string, state?: string, zip?: string, postalCode?: string, postal?: string }} parts
 * @returns {string}
 */
function buildGoogleMapsSearchQuery(parts) {
  const title = cleanPart(parts && parts.title);
  const zip = resolveZip(parts);
  const city = cleanPart(parts && parts.city);
  const state = cleanPart(parts && parts.state);

  const out = [];
  if (title) out.push(title);

  if (zip) {
    out.push(zip);
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  // No zip — city + state only (still name-first; never street).
  const soFar = () => out.join(' ').toLowerCase();
  if (city && !soFar().includes(city.toLowerCase())) out.push(city);
  if (state && !soFar().includes(state.toLowerCase())) out.push(state);

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ url?: string, title?: string, address?: string, city?: string, state?: string, zip?: string, postalCode?: string, postal?: string }|null|undefined} leadOrParts
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
    zip: L.zip || L.postalCode || L.postal,
    postalCode: L.postalCode,
    postal: L.postal,
  });
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

module.exports = {
  buildGoogleMapsSearchQuery,
  resolveGoogleMapsSearchHref,
  isGoogleMapsListingUrl,
  extractZip,
  resolveZip,
};
