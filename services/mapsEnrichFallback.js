/**
 * When Firecrawl scrape/search fails or returns no contact signals, enrich from Google Maps
 * via the same stack as Find Leads: Outscraper first when configured, else Apify.
 */

const mapsSearch = require('./mapsSearch');

function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|corp|co\.?|d\.?b\.?a\.?)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(leadTitle, placeTitle) {
  const A = new Set(normTitle(leadTitle).split(' ').filter((w) => w.length > 1));
  const B = new Set(normTitle(placeTitle).split(' ').filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

/** True if Firecrawl-style extract (or merged object) has something worth saving. */
function extractHasContactSignal(data) {
  if (!data || typeof data !== 'object') return false;
  const has = (v) => v != null && String(v).trim() && String(v).trim() !== 'N/A';
  if (has(data.email)) return true;
  if (has(data.phone)) return true;
  if (has(data.address)) return true;
  if (has(data.facebook) || has(data.instagram) || has(data.twitter) || has(data.linkedin)) return true;
  if (Number(data.total_score) > 0 || Number(data.totalScore) > 0) return true;
  if (Number(data.reviews_count) > 0 || Number(data.reviewsCount) > 0) return true;
  if (Array.isArray(data.review_snippets) && data.review_snippets.length > 0) return true;
  if (data.cms_platform && String(data.cms_platform).toLowerCase() !== 'unknown') return true;
  if (data.audit_summary && String(data.audit_summary).trim()) return true;
  return false;
}

function apifyPlaceToExtract(place) {
  const out = {};
  const set = (k, v) => {
    if (v == null) return;
    if (typeof v === 'number' && !Number.isNaN(v)) {
      out[k] = v;
      return;
    }
    const s = String(v).trim();
    if (s && s !== 'N/A') out[k] = v;
  };
  set('email', place.email);
  set('phone', place.phone);
  set('address', place.address);
  if (place.totalScore != null && Number(place.totalScore) > 0) out.total_score = Number(place.totalScore);
  if (place.reviewsCount != null && Number(place.reviewsCount) > 0) out.reviews_count = Number(place.reviewsCount);
  set('facebook', place.facebook);
  set('instagram', place.instagram);
  set('twitter', place.twitter);
  if (place.url) set('google_places', place.url);
  return out;
}

/** Prefer Firecrawl fields when present; fill gaps from Maps. */
function mergeExtractPreferFirecrawl(fc, maps) {
  const m = maps && typeof maps === 'object' ? { ...maps } : {};
  const f = fc && typeof fc === 'object' ? fc : {};
  const merged = { ...m };
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) merged[k] = v;
      continue;
    }
    if (typeof v === 'number' && !Number.isNaN(v)) {
      merged[k] = v;
      continue;
    }
    const s = String(v).trim();
    if (s && s !== 'N/A') merged[k] = v;
  }
  return merged;
}

/**
 * @param {{ title?: string, city?: string, state?: string }} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 * @returns {Promise<{ extract: object, websiteHint: string|null }|null>}
 */
async function enrichFromMapsForLead(lead, integrationEnv) {
  if (!mapsSearch.isMapsSearchConfigured(integrationEnv)) return null;

  const title = String(lead.title || '').trim();
  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();
  if (!title) return null;

  const cityQ = city || 'United States';
  const stateQ = state || '';

  try {
    const places = await mapsSearch.searchGoogleMaps({
      keyword: title,
      city: cityQ,
      state: stateQ || 'US',
      maxResults: 12,
      integrationEnv,
    });
    if (!places || places.length === 0) return null;

    let best = places[0];
    let bestScore = titleSimilarity(title, best.title);
    for (let i = 1; i < places.length; i += 1) {
      const p = places[i];
      const sc = titleSimilarity(title, p.title);
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }

    if (city && bestScore < 0.18) {
      const cityL = normTitle(city);
      const alt = places.find((p) => {
        const pc = normTitle(p.city || '');
        return pc && (pc.includes(cityL) || cityL.includes(pc));
      });
      if (alt) best = alt;
    }

    const extract = apifyPlaceToExtract(best);
    const websiteHint =
      best.website && String(best.website).trim() && String(best.website).trim() !== 'N/A'
        ? String(best.website).trim()
        : null;

    if (!extractHasContactSignal(extract) && !websiteHint) return null;

    return { extract, websiteHint };
  } catch (e) {
    console.warn('[mapsEnrichFallback] Maps enrich failed:', e.message);
    return null;
  }
}

module.exports = {
  extractHasContactSignal,
  mergeExtractPreferFirecrawl,
  enrichFromMapsForLead,
};
