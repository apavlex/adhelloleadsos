/**
 * SerpAPI — Google Local engine (local pack).
 * https://serpapi.com/google-local-api
 */

const SERPAPI_SEARCH_JSON = 'https://serpapi.com/search.json';

function apiKey(integrationEnv) {
  const fromWs = integrationEnv && integrationEnv.SERPAPI_API_KEY;
  if (typeof fromWs === 'string' && fromWs.trim()) return fromWs.trim();
  return String(process.env.SERPAPI_API_KEY || '').trim();
}

function isConfigured(integrationEnv) {
  return Boolean(apiKey(integrationEnv));
}

function pickPhone(r) {
  if (!r) return '';
  const direct = r.phone;
  if (typeof direct === 'string' && direct.trim()) return direct.trim().replace(/^tel:/i, '').trim();
  const links = r.links && typeof r.links === 'object' ? r.links : null;
  if (links && typeof links.phone === 'string') {
    return links.phone.replace(/^tel:/i, '').trim();
  }
  return '';
}

function pickWebsite(r) {
  if (!r) return '';
  const links = r.links && typeof r.links === 'object' ? r.links : null;
  const w = links && (links.website || links.site);
  if (typeof w === 'string' && /^https?:\/\//i.test(w)) return w.trim();
  const direct = r.website;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct.trim();
  return '';
}

function mapsListingUrlFromResult(r, ctx) {
  const web = pickWebsite(r);
  if (web) return web.split('#')[0];

  const gps = r && r.gps_coordinates;
  if (gps && gps.latitude != null && gps.longitude != null) {
    const lat = Number(gps.latitude);
    const lng = Number(gps.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    }
  }

  const pid = r && r.place_id;
  if (pid != null && String(pid).trim()) {
    const cid = String(pid).trim();
    return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`;
  }

  const title = String((r && r.title) || '').trim();
  const city = String((ctx && ctx.city) || '').trim();
  const state = String((ctx && ctx.state) || '').trim();
  const addr = String((r && r.address) || '').trim();
  if (title && city) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${addr} ${city} ${state}`.trim())}`;
  }
  return '';
}

function normalizeLocalResult(r, ctx) {
  const city = String((ctx && ctx.city) || '').trim();
  const state = String((ctx && ctx.state) || '').trim();
  const addr = String((r && r.address) || '').trim();
  const reviewsRaw = r && r.reviews != null ? r.reviews : 0;
  const reviewsCount =
    typeof reviewsRaw === 'number'
      ? Math.round(reviewsRaw)
      : parseInt(String(reviewsRaw).replace(/,/g, ''), 10) || 0;

  const rating = r && r.rating != null ? Number(r.rating) : 0;
  const website = pickWebsite(r);
  const listingUrl = mapsListingUrlFromResult(r, ctx);
  const phone = pickPhone(r);

  return {
    title: String((r && r.title) || 'N/A').trim() || 'N/A',
    phone: phone || 'N/A',
    website: website || 'N/A',
    email: 'N/A',
    categoryName: String((r && r.type) || 'N/A').trim() || 'N/A',
    address: addr || 'N/A',
    city,
    state,
    postalCode: '',
    totalScore: Number.isFinite(rating) ? rating : 0,
    reviewsCount,
    url: listingUrl || website || '',
    facebook: 'N/A',
    instagram: 'N/A',
    twitter: 'N/A',
  };
}

/**
 * @param {{ keyword: string, city: string, state: string, maxResults?: number, integrationEnv?: Record<string, string> }} params
 * @returns {Promise<object[]>}
 */
async function searchGoogleMaps({ keyword, city, state, maxResults, integrationEnv }) {
  const key = apiKey(integrationEnv);
  if (!key) throw new Error('SERPAPI_API_KEY is not set (workspace integrations or environment).');

  const kw = String(keyword || '').trim();
  const c = String(city || '').trim();
  const st = String(state || '').trim();
  if (!kw || !c || !st) throw new Error('keyword, city, and state are required');

  const max = Math.min(500, Math.max(1, parseInt(maxResults, 10) || 20));
  const q = `${kw} in ${c}, ${st}`;
  const location = `${c}, ${st}, United States`;

  const out = [];
  let start = 0;
  let pages = 0;

  while (out.length < max && pages < 40) {
    pages += 1;
    const params = new URLSearchParams({
      engine: 'google_local',
      q,
      location,
      api_key: key,
      hl: 'en',
      gl: 'us',
      device: 'desktop',
      start: String(start),
    });

    const url = `${SERPAPI_SEARCH_JSON}?${params.toString()}`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`SerpAPI returned non-JSON (${res.status})`);
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || text.slice(0, 280);
      throw new Error(`SerpAPI ${res.status}: ${msg}`);
    }

    const meta = data.search_metadata;
    if (meta && String(meta.status || '').toLowerCase() === 'error') {
      throw new Error(data.error || `SerpAPI status: ${meta.status}`);
    }

    const local = Array.isArray(data.local_results) ? data.local_results : [];
    for (const item of local) {
      out.push(normalizeLocalResult(item, { city: c, state: st }));
      if (out.length >= max) break;
    }

    if (local.length === 0) break;

    const pag = data.serpapi_pagination;
    if (!pag || !pag.next) break;

    let nextStart = start + 20;
    try {
      const nu = new URL(pag.next);
      const ns = nu.searchParams.get('start');
      if (ns != null && ns !== '') {
        const parsed = parseInt(ns, 10);
        if (Number.isFinite(parsed)) nextStart = parsed;
      }
    } catch {
      nextStart = start + local.length;
    }
    start = nextStart;
  }

  console.log(`[serpapiGoogleLocal] Retrieved ${out.length} results (requested max ${max}).`);
  return out.slice(0, max);
}

module.exports = {
  isConfigured,
  searchGoogleMaps,
};
