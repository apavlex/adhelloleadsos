/**
 * Outscraper-first Google Business Profile enrich: listing, domain, reviews.
 * Used as step 1 of contact hunt before BetterContact / Firecrawl.
 */

const outscraper = require('./outscraperClient');
const mapsEnrichFallback = require('./mapsEnrichFallback');
const { normalizeSocialUrl } = require('./socialUrlNormalize');
const { buildReviewFreshnessPatch } = require('./reviewFreshness');

function resolveReviewQuery(lead, place) {
  const pid = place && (place.placeId || place.place_id);
  if (pid && String(pid).trim()) return String(pid).trim();
  const mapsUrl = (place && place.url) || lead.url || lead.googlePlaces;
  if (mapsUrl && String(mapsUrl).trim()) return String(mapsUrl).trim();
  const parts = [lead.title, lead.city, lead.state].filter((p) => p && String(p).trim());
  return parts.join(', ');
}

function placeToExtract(place) {
  if (!place || typeof place !== 'object') return {};
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
  if (place.reviewsCount != null && Number(place.reviewsCount) >= 0) {
    out.reviews_count = Number(place.reviewsCount);
  }
  set('facebook', normalizeSocialUrl(place.facebook, 'facebook'));
  set('instagram', normalizeSocialUrl(place.instagram, 'instagram'));
  set('twitter', normalizeSocialUrl(place.twitter, 'twitter'));
  if (place.url) set('google_places', place.url);
  if (place.categoryName && place.categoryName !== 'N/A') out.category = place.categoryName;
  return out;
}

function buildPatchFromPlace(place, lead) {
  const patch = {};
  if (!place) return patch;
  if (place.totalScore != null && Number(place.totalScore) >= 0 && !lead.reviewsCountManual) {
    patch.totalScore = Number(place.totalScore);
  }
  if (place.reviewsCount != null && Number(place.reviewsCount) >= 0 && !lead.reviewsCountManual) {
    const n = parseInt(place.reviewsCount, 10);
    const cur = parseInt(lead.reviewsCount, 10) || 0;
    if (Number.isFinite(n) && (n > 0 || cur <= 0)) patch.reviewsCount = n;
  }
  if (place.url && String(place.url).trim()) patch.url = String(place.url).trim();
  if (
    place.website &&
    place.website !== 'N/A' &&
    (!lead.website || lead.website === 'N/A')
  ) {
    patch.website = String(place.website).trim();
  }
  if ((!lead.phone || lead.phone === 'N/A') && place.phone && place.phone !== 'N/A') {
    patch.phone = String(place.phone).trim();
  }
  if ((!lead.address || lead.address === 'N/A') && place.address && place.address !== 'N/A') {
    patch.address = String(place.address).trim();
  }
  if ((!lead.email || lead.email === 'N/A') && place.email && place.email !== 'N/A') {
    patch.email = String(place.email).trim();
  }
  if ((!lead.facebook || lead.facebook === 'N/A') && place.facebook && place.facebook !== 'N/A') {
    const fb = normalizeSocialUrl(place.facebook, 'facebook');
    if (fb) patch.facebook = fb;
  }
  if ((!lead.instagram || lead.instagram === 'N/A') && place.instagram && place.instagram !== 'N/A') {
    const ig = normalizeSocialUrl(place.instagram, 'instagram');
    if (ig) patch.instagram = ig;
  }
  if ((!lead.twitter || lead.twitter === 'N/A') && place.twitter && place.twitter !== 'N/A') {
    const tw = normalizeSocialUrl(place.twitter, 'twitter');
    if (tw) patch.twitter = tw;
  }
  if (place.placeId && !lead.placeId) patch.placeId = String(place.placeId).trim();
  return patch;
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 * @returns {Promise<{
 *   used: boolean,
 *   place: object|null,
 *   extract: object,
 *   patch: object,
 *   snippets: string[],
 *   reviewsFetched: boolean,
 *   reviewError: string|null,
 *   reviewQuery: string,
 * }|null>}
 */
async function enrichLeadFromOutscraperGmb(lead, integrationEnv) {
  if (!outscraper.isConfigured(integrationEnv)) return null;

  const title = String(lead.title || '').trim();
  if (!title) return null;

  const city = String(lead.city || '').trim();
  const state = String(lead.state || '').trim();

  let place = null;
  let reviewError = null;
  let reviewsFetched = false;
  let snippets = [];
  let reviewQuery = '';

  try {
    const places = await outscraper.searchGoogleMaps({
      keyword: title,
      city: city || 'United States',
      state: state || 'US',
      maxResults: 8,
      integrationEnv,
    });
    place = mapsEnrichFallback.pickBestMapsPlace(lead, places);
  } catch (e) {
    console.warn('[outscraperGmb] Maps search failed:', e.message);
    return {
      used: false,
      place: null,
      extract: {},
      patch: {},
      snippets: [],
      reviewsFetched: false,
      reviewError: e.message || 'Outscraper Maps search failed',
      reviewQuery: '',
    };
  }

  if (!place) {
    return {
      used: false,
      place: null,
      extract: {},
      patch: {},
      snippets: [],
      reviewsFetched: false,
      reviewError: 'No matching Google Business listing found.',
      reviewQuery: '',
    };
  }

  const patch = buildPatchFromPlace(place, lead);
  const extract = placeToExtract(place);

  reviewQuery = resolveReviewQuery(lead, place);
  if (reviewQuery) {
    try {
      const pack = await outscraper.fetchGoogleMapsReviews({
        query: reviewQuery,
        integrationEnv,
      });
      if (pack.placeRating != null && Number.isFinite(Number(pack.placeRating)) && !lead.reviewsCountManual) {
        patch.totalScore = Number(pack.placeRating);
      }
      if (pack.placeReviewsCount != null && Number.isFinite(Number(pack.placeReviewsCount)) && !lead.reviewsCountManual) {
        const n = parseInt(pack.placeReviewsCount, 10);
        const cur = parseInt(lead.reviewsCount, 10) || 0;
        if (Number.isFinite(n) && (n > 0 || cur <= 0)) patch.reviewsCount = n;
      }
      const { buildHighestLowestSnippets } = require('./reviewHunt');
      snippets = buildHighestLowestSnippets(pack.reviews);
      if (Array.isArray(pack.reviews) && pack.reviews.length > 0) {
        Object.assign(patch, buildReviewFreshnessPatch(pack.reviews));
        reviewsFetched = true;
      }
      if (snippets.length) {
        patch.reviewSnippets = snippets;
        reviewsFetched = true;
      } else if (Array.isArray(pack.reviews) && pack.reviews.length > 0) {
        reviewError = 'Reviews fetched but none had enough text for quotes.';
      }
    } catch (e) {
      reviewError = e.message || 'Outscraper reviews request failed';
      console.warn('[outscraperGmb] Reviews failed:', reviewError);
    }
  } else {
    reviewError = 'No Maps place id, URL, or name to query for reviews.';
  }

  const used =
    !!place ||
    Object.keys(patch).length > 0 ||
    snippets.length > 0 ||
    reviewsFetched;

  return {
    used,
    place,
    extract,
    patch,
    snippets,
    reviewsFetched,
    reviewError,
    reviewQuery,
  };
}

module.exports = {
  enrichLeadFromOutscraperGmb,
  buildPatchFromPlace,
  placeToExtract,
};
