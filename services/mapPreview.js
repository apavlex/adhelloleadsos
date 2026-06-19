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

    const osm = await geocodeViaNominatim(variant);
    if (osm) return osm;
  }
  return null;
}

function buildGeocodeQueryVariants(raw) {
  const q = String(raw || '').trim();
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
    coords = await geocodeCenterQuery(centerQuery);
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
  buildGeocodeQueryVariants,
  getMapPreviewImage,
};
