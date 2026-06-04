/**
 * Server-side map preview for the lead panel sidebar.
 * Fetches static map tiles on the server (avoids iframe/JS issues in slide-in panels)
 * and falls back to OpenStreetMap when Google Static Maps is unavailable.
 */

const { getGoogleMapsApiKey } = require('./googleMapsKey');

const NOMINATIM_UA = 'AdHelloLeadsOS/1.0 (map preview; contact@adhello.ai)';

function parseLatLngPair(raw) {
  const m = String(raw || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function buildGoogleStaticMapUrl(lat, lng, key, width, height) {
  const k = String(key || '').trim();
  if (!k || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const w = Math.min(640, Math.max(100, parseInt(width, 10) || 640));
  const h = Math.min(640, Math.max(100, parseInt(height, 10) || 300));
  const center = `${lat},${lng}`;
  return (
    'https://maps.googleapis.com/maps/api/staticmap?' +
    `center=${encodeURIComponent(center)}` +
    `&zoom=15&size=${w}x${h}&scale=2&maptype=roadmap` +
    `&markers=${encodeURIComponent(`color:0xEAB308|${center}`)}` +
    `&key=${encodeURIComponent(k)}`
  );
}

function buildOsmStaticMapUrl(lat, lng, width, height) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const w = Math.min(640, Math.max(100, parseInt(width, 10) || 640));
  const h = Math.min(640, Math.max(100, parseInt(height, 10) || 300));
  const point = `${lat},${lng}`;
  return (
    'https://staticmap.openstreetmap.de/staticmap.php?' +
    `center=${encodeURIComponent(point)}` +
    `&zoom=15&size=${w}x${h}` +
    `&markers=${encodeURIComponent(point + ',red-pushpin')}`
  );
}

function buildOsmFrStaticMapUrl(lat, lng, width, height) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const w = Math.min(640, Math.max(100, parseInt(width, 10) || 640));
  const h = Math.min(640, Math.max(100, parseInt(height, 10) || 300));
  const point = `${lat},${lng}`;
  return (
    'https://static-maps.openstreetmap.fr/?' +
    `center=${encodeURIComponent(point)}` +
    `&zoom=15&size=${w}x${h}` +
    `&markers=${encodeURIComponent(point + ',red')}`
  );
}

async function tryFetchImage(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  try {
    const res = await fetch(u, { headers: { Accept: 'image/*,*/*' } });
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length < 256) return null;
    return { buffer, contentType };
  } catch (e) {
    console.warn('[mapPreview] fetch failed:', e.message);
    return null;
  }
}

async function geocodeViaGoogle(query) {
  const key = getGoogleMapsApiKey();
  const q = String(query || '').trim();
  if (!key || !q) return null;
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    `${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'OK' || !Array.isArray(data.results) || !data.results[0]) {
      return null;
    }
    const loc = data.results[0].geometry && data.results[0].geometry.location;
    if (!loc || loc.lat == null || loc.lng == null) return null;
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  } catch (e) {
    console.warn('[mapPreview] Google geocode failed:', e.message);
    return null;
  }
}

async function geocodeViaNominatim(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_UA,
      },
    });
    const data = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(data) || !data[0]) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    console.warn('[mapPreview] Nominatim geocode failed:', e.message);
    return null;
  }
}

/**
 * @param {{ center?: string, lat?: number, lng?: number, width?: number, height?: number }} opts
 * @returns {Promise<{ buffer: Buffer, contentType: string, lat: number, lng: number, source: string } | null>}
 */
async function getMapPreviewImage(opts) {
  opts = opts || {};
  const width = opts.width || 640;
  const height = opts.height || 300;
  const centerQuery = String(opts.center || '').trim();

  let coords = null;
  if (Number.isFinite(opts.lat) && Number.isFinite(opts.lng)) {
    coords = { lat: Number(opts.lat), lng: Number(opts.lng) };
  }
  if (!coords && centerQuery) {
    coords = parseLatLngPair(centerQuery);
  }
  if (!coords && centerQuery) {
    coords = await geocodeViaGoogle(centerQuery);
  }
  if (!coords && centerQuery) {
    coords = await geocodeViaNominatim(centerQuery);
  }
  if (!coords) return null;

  const { lat, lng } = coords;
  const mapKey = getGoogleMapsApiKey();
  const googleUrl = buildGoogleStaticMapUrl(lat, lng, mapKey, width, height);
  if (googleUrl) {
    const googleImg = await tryFetchImage(googleUrl);
    if (googleImg) {
      return { ...googleImg, lat, lng, source: 'google-static' };
    }
  }

  const osmUrls = [
    buildOsmStaticMapUrl(lat, lng, width, height),
    buildOsmFrStaticMapUrl(lat, lng, width, height),
  ].filter(Boolean);
  for (const osmUrl of osmUrls) {
    const osmImg = await tryFetchImage(osmUrl);
    if (osmImg) {
      return { ...osmImg, lat, lng, source: 'osm-static' };
    }
  }

  return null;
}

module.exports = {
  parseLatLngPair,
  buildGoogleStaticMapUrl,
  buildOsmStaticMapUrl,
  getMapPreviewImage,
};
