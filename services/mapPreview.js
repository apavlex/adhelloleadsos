/**
 * Server-side map preview for the lead panel sidebar.
 * Fetches static map tiles on the server (avoids iframe/JS issues in slide-in panels)
 * and falls back to Geoapify, then OpenStreetMap when Google Static Maps is unavailable.
 */

const { getGoogleMapsApiKey } = require('./googleMapsKey');
const { getGeoapifyApiKey } = require('./geoapifyKey');
const sharp = require('sharp');

const NOMINATIM_UA = 'AdHelloLeadsOS/1.0 (map preview; contact@adhello.ai)';
const OSM_TILE_UA = 'AdHelloLeadsOS/1.0 (map preview; +https://adhello.ai)';

function normalizeAddressSeparators(raw) {
  return String(raw || '')
    .replace(/\s*[·•|]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMapQueryFromLead(lead) {
  const l = lead || {};
  const street = normalizeAddressSeparators(String(l.address || '').trim());
  const city = String(l.city || '').trim();
  const state = String(l.state || '').trim();
  const zip = String(l.zip || l.postalCode || '').trim();
  if (street && street !== 'N/A') {
    const locParts = [];
    if (city && city !== 'N/A') locParts.push(city);
    if (state && state !== 'N/A') locParts.push(state);
    let loc = locParts.join(', ');
    if (zip && zip !== 'N/A') loc = loc ? `${loc} ${zip}` : zip;
    return loc ? `${street}, ${loc}` : street;
  }
  const cs = [city, state].filter((x) => x && x !== 'N/A').join(', ');
  const title = String(l.title || '').trim();
  if (title && cs) return `${title}, ${cs}`;
  return title || cs || '';
}

function parseGeoapifyGeocodeResult(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.results) && data.results[0]) {
    const lat = Number(data.results[0].lat);
    const lng = Number(data.results[0].lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (Array.isArray(data.features) && data.features[0]) {
    const coords = data.features[0].geometry && data.features[0].geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

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

function buildGeoapifyStaticMapUrl(lat, lng, key, width, height) {
  const k = String(key || '').trim();
  if (!k || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const w = Math.min(4096, Math.max(100, parseInt(width, 10) || 640));
  const h = Math.min(4096, Math.max(100, parseInt(height, 10) || 300));
  const lonlat = `${lng},${lat}`;
  const marker = `lonlat:${lonlat};color:%23EAB308;size:48`;
  return (
    'https://maps.geoapify.com/v1/staticmap?' +
    'style=osm-bright' +
    `&width=${w}&height=${h}` +
    `&center=lonlat:${lonlat}` +
    '&zoom=15&scaleFactor=2&format=png' +
    `&marker=${encodeURIComponent(marker)}` +
    `&apiKey=${encodeURIComponent(k)}`
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

function isGoogleStaticMapErrorImage(buffer) {
  if (!buffer || !buffer.length) return true;
  const hay = buffer.toString('latin1');
  if (/Google Maps Platform/i.test(hay)) return true;
  if (/This API (?:key|project) is not/i.test(hay)) return true;
  if (/Static Maps API has not been used/i.test(hay)) return true;
  if (/The Google Maps Platform server rejected your request/i.test(hay)) return true;
  return false;
}

async function tryFetchImage(url, opts) {
  const u = String(url || '').trim();
  if (!u) return null;
  opts = opts || {};
  try {
    const res = await fetch(u, { headers: { Accept: 'image/*,*/*' } });
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length < 256) return null;
    if (opts.rejectGoogleErrorImages && isGoogleStaticMapErrorImage(buffer)) return null;
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

async function geocodeCenterQuery(centerQuery) {
  const q = String(centerQuery || '').trim();
  if (!q) return null;

  const pair = parseLatLngPair(q);
  if (pair) return pair;

  const variants = buildGeocodeQueryVariants(q);
  const seen = new Set();
  for (const variant of variants) {
    const key = variant.toLowerCase();
    if (!variant || seen.has(key)) continue;
    seen.add(key);

    const direct = parseLatLngPair(variant);
    if (direct) return direct;

    const google = await geocodeViaGoogle(variant);
    if (google) return google;

    const geoapify = await geocodeViaGeoapify(variant);
    if (geoapify) return geoapify;

    const osm = await geocodeViaNominatim(variant);
    if (osm) return osm;
  }
  return null;
}

function buildGeocodeQueryVariants(raw) {
  const q = normalizeAddressSeparators(raw);
  if (!q) return [];
  const out = [q];
  const parts = q.split(',').map((s) => s.trim()).filter(Boolean);
  const streetSuffix =
    /\b(st|street|ste|suite|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|pkwy|parkway|cir|circle)\b/i;

  const stripSuiteFragment = (s) =>
    String(s || '')
      .replace(/\s+(?:#\s*[\w-]+|(?:ste|suite|unit|apt|bldg|fl|floor|rm|room)\.?\s*#?\s*[\w-]+)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const withoutSuite = stripSuiteFragment(q);
  if (withoutSuite && withoutSuite !== q) out.push(withoutSuite);

  const withoutCountry = q.replace(/,?\s*(USA|United States|U\.S\.A\.?)\s*$/i, '').trim();
  if (withoutCountry && withoutCountry !== q) out.push(withoutCountry);

  const withoutSuiteCountry = stripSuiteFragment(withoutCountry);
  if (withoutSuiteCountry && withoutSuiteCountry !== q && !out.includes(withoutSuiteCountry)) {
    out.push(withoutSuiteCountry);
  }

  if (parts.length >= 2 && !/\d/.test(parts[0])) {
    out.push(parts.slice(1).join(', '));
  }

  const first = parts[0] || '';
  if (parts.length >= 2 && /\d/.test(first) && !streetSuffix.test(first)) {
    const landmark = first.replace(/^\d+\s+/, '').trim();
    if (landmark && landmark !== first) {
      out.push([landmark, ...parts.slice(1)].join(', '));
    }
    out.push(parts.slice(1).join(', '));
  }

  const zip = q.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) {
    let statePart = parts.find((p) => /^[A-Z]{2}$/i.test(p)) || '';
    if (!statePart) {
      const combo = parts.find((p) => /\b[A-Z]{2}\s+\d{5}\b/i.test(p));
      if (combo) {
        const m = combo.match(/\b([A-Z]{2})\b/i);
        if (m) statePart = m[1].toUpperCase();
      }
    }
    const cityPart = parts.find(
      (p, i) =>
        i > 0 &&
        p !== 'USA' &&
        p !== 'US' &&
        p !== 'United States' &&
        !/^[A-Z]{2}$/i.test(p) &&
        !/^[A-Z]{2}\s+\d{5}/i.test(p) &&
        !/^\d{5}/.test(p),
    );
    if (cityPart && statePart) out.push(`${cityPart}, ${statePart} ${zip[1]}`);
    else if (cityPart) out.push(`${cityPart}, ${statePart ? statePart + ' ' : ''}${zip[1]}`.replace(/,\s+,/, ', '));
  }

  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

async function geocodeViaGeoapify(query) {
  const key = getGeoapifyApiKey();
  const q = normalizeAddressSeparators(query);
  if (!key || !q) return null;
  const url =
    'https://api.geoapify.com/v1/geocode/search?text=' +
    `${encodeURIComponent(q)}&limit=1` +
    `&apiKey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return parseGeoapifyGeocodeResult(data);
  } catch (e) {
    console.warn('[mapPreview] Geoapify geocode failed:', e.message);
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

function latLngToTileFraction(lat, lng, zoom) {
  const z = Math.max(0, Math.min(19, parseInt(zoom, 10) || 15));
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y, zoom: z, tileSize: 256 };
}

async function fetchOsmTile(z, x, y) {
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/png,*/*', 'User-Agent': OSM_TILE_UA },
    });
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length < 128) return null;
    return { buffer, contentType: contentType.startsWith('image/') ? contentType : 'image/png' };
  } catch (e) {
    console.warn('[mapPreview] OSM tile fetch failed:', e.message);
    return null;
  }
}

async function buildOsmTileMapImage(lat, lng, width, height) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const w = Math.min(640, Math.max(100, parseInt(width, 10) || 640));
  const h = Math.min(640, Math.max(100, parseInt(height, 10) || 300));
  const zoom = w >= 520 ? 15 : 14;
  const { x, y, tileSize } = latLngToTileFraction(lat, lng, zoom);
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const grid = 2;
  const overlays = [];

  for (let dy = 0; dy < grid; dy++) {
    for (let dx = 0; dx < grid; dx++) {
      const tile = await fetchOsmTile(zoom, tileX + dx, tileY + dy);
      if (!tile) return null;
      overlays.push({ input: tile.buffer, left: dx * tileSize, top: dy * tileSize });
    }
  }

  const canvasSize = grid * tileSize;
  const pixelX = (x - tileX) * tileSize;
  const pixelY = (y - tileY) * tileSize;
  let left = Math.round(pixelX - w / 2);
  let top = Math.round(pixelY - h / 2);
  left = Math.max(0, Math.min(canvasSize - w, left));
  top = Math.max(0, Math.min(canvasSize - h, top));

  const markerSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<circle cx="${w / 2}" cy="${Math.max(18, h / 2 - 10)}" r="11" fill="#EAB308" stroke="#111827" stroke-width="2"/>` +
      `<circle cx="${w / 2}" cy="${Math.max(18, h / 2 - 10)}" r="3.5" fill="#111827"/>` +
      `</svg>`,
    'utf8',
  );

  try {
    const base = await sharp({
      create: {
        width: canvasSize,
        height: canvasSize,
        channels: 4,
        background: { r: 226, g: 232, b: 240, alpha: 1 },
      },
    })
      .composite(overlays)
      .png()
      .toBuffer();

    const buffer = await sharp(base)
      .extract({ left, top, width: Math.min(w, canvasSize - left), height: Math.min(h, canvasSize - top) })
      .resize(w, h, { fit: 'cover' })
      .composite([{ input: markerSvg, gravity: 'center' }])
      .png()
      .toBuffer();

    if (!buffer || buffer.length < 256) return null;
    return { buffer, contentType: 'image/png' };
  } catch (e) {
    console.warn('[mapPreview] OSM tile composite failed:', e.message);
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
  const centerQuery = normalizeAddressSeparators(String(opts.center || '').trim());

  let coords = null;
  if (Number.isFinite(opts.lat) && Number.isFinite(opts.lng)) {
    coords = { lat: Number(opts.lat), lng: Number(opts.lng) };
  }
  if (!coords && centerQuery) {
    coords = parseLatLngPair(centerQuery);
  }
  if (!coords && centerQuery) {
    coords = await geocodeCenterQuery(centerQuery);
  }
  if (!coords) return null;

  const { lat, lng } = coords;
  const mapKey = getGoogleMapsApiKey();
  const googleUrl = buildGoogleStaticMapUrl(lat, lng, mapKey, width, height);
  if (googleUrl) {
    const googleImg = await tryFetchImage(googleUrl, { rejectGoogleErrorImages: true });
    if (googleImg) {
      return { ...googleImg, lat, lng, source: 'google-static' };
    }
  }

  const geoKey = getGeoapifyApiKey();
  const geoapifyUrl = buildGeoapifyStaticMapUrl(lat, lng, geoKey, width, height);
  if (geoapifyUrl) {
    const geoapifyImg = await tryFetchImage(geoapifyUrl);
    if (geoapifyImg) {
      return { ...geoapifyImg, lat, lng, source: 'geoapify-static' };
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

  const tileImg = await buildOsmTileMapImage(lat, lng, width, height);
  if (tileImg) {
    return { ...tileImg, lat, lng, source: 'osm-tiles' };
  }

  return null;
}

module.exports = {
  parseLatLngPair,
  normalizeAddressSeparators,
  buildMapQueryFromLead,
  parseGeoapifyGeocodeResult,
  buildGoogleStaticMapUrl,
  buildGeoapifyStaticMapUrl,
  buildOsmStaticMapUrl,
  buildGeocodeQueryVariants,
  latLngToTileFraction,
  getMapPreviewImage,
  isGoogleStaticMapErrorImage,
};
