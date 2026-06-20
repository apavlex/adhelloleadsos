/**
 * Review hunt: refresh Google rating/count, scrape highest/lowest review quotes, AI summary.
 */

const outscraper = require('./outscraperClient');
const mapsEnrichFallback = require('./mapsEnrichFallback');
const { generateReviewIntelForLead } = require('./reviewIntel');

const REVIEWS_FETCH_LIMIT = Math.min(
  50,
  Math.max(10, parseInt(process.env.REVIEW_HUNT_REVIEWS_LIMIT || '25', 10) || 25)
);

/**
 * @param {object} raw
 * @returns {{ rating: number|null, text: string, author: string }}
 */
function normalizeReviewRow(raw) {
  if (!raw || typeof raw !== 'object') {
    return { rating: null, text: '', author: '' };
  }
  const ratingRaw =
    raw.review_rating != null ? raw.review_rating
    : raw.rating != null ? raw.rating
    : raw.stars != null ? raw.stars
    : null;
  const rating = ratingRaw != null ? Number(ratingRaw) : null;
  const text = String(
    raw.review_text || raw.text || raw.reviewText || raw.snippet || raw.description || ''
  ).trim();
  const author = String(raw.author_title || raw.author_name || raw.author || raw.user_name || '').trim();
  return {
    rating: Number.isFinite(rating) ? rating : null,
    text,
    author,
  };
}

/**
 * Pick highest- and lowest-rated review quotes for sales intel.
 * @param {object[]} reviews
 * @returns {string[]}
 */
function buildHighestLowestSnippets(reviews) {
  const normalized = (Array.isArray(reviews) ? reviews : [])
    .map(normalizeReviewRow)
    .filter((r) => r.text.length >= 12);
  if (!normalized.length) return [];

  let highest = normalized[0];
  let lowest = normalized[0];
  for (const r of normalized) {
    const hr = highest.rating != null ? highest.rating : -1;
    const lr = lowest.rating != null ? lowest.rating : 6;
    const rr = r.rating != null ? r.rating : null;
    if (rr != null && (hr < 0 || rr > hr || (rr === hr && r.text.length > highest.text.length))) {
      highest = r;
    }
    if (rr != null && (lr > 5 || rr < lr || (rr === lr && r.text.length > lowest.text.length))) {
      lowest = r;
    }
  }

  const fmt = (r, label) => {
    const stars = r.rating != null ? `${r.rating}★ — ` : '';
    const who = r.author ? `${r.author}: ` : '';
    const body = r.text.length > 420 ? `${r.text.slice(0, 417)}…` : r.text;
    return `[${label}] ${stars}${who}"${body}"`;
  };

  const out = [];
  if (highest.text) out.push(fmt(highest, 'Highest rated'));
  const sameQuote =
    highest.text === lowest.text &&
    (highest.rating == null || lowest.rating == null || highest.rating === lowest.rating);
  if (lowest.text && !sameQuote) out.push(fmt(lowest, 'Lowest rated'));
  return out.slice(0, 4);
}

/**
 * @param {object} lead
 * @param {object|null|undefined} place
 * @returns {string}
 */
function resolveReviewQuery(lead, place) {
  const pid = place && (place.placeId || place.place_id);
  if (pid && String(pid).trim()) return String(pid).trim();
  const mapsUrl = (place && place.url) || lead.url || lead.googlePlaces;
  if (mapsUrl && String(mapsUrl).trim()) return String(mapsUrl).trim();
  const parts = [lead.title, lead.city, lead.state].filter((p) => p && String(p).trim());
  return parts.join(', ');
}

/**
 * @param {object} lead
 * @param {Record<string, string>|null|undefined} integrationEnv
 * @param {{ mapsPlace?: object|null, forceMapsSearch?: boolean }} [opts]
 * @returns {Promise<{ patch: object, used: boolean, mapsPlace: object|null, snippets: string[] }>}
 */
async function runReviewHuntForLead(lead, integrationEnv, opts = {}) {
  const patch = {};
  let mapsPlace = opts.mapsPlace || null;
  let snippets = [];
  let reviewsFetched = false;

  if (!mapsPlace || opts.forceMapsSearch) {
    mapsPlace = await mapsEnrichFallback.findMapsPlaceForLead(lead, integrationEnv);
  }

  if (mapsPlace) {
    if (mapsPlace.totalScore != null && Number(mapsPlace.totalScore) >= 0) {
      patch.totalScore = Number(mapsPlace.totalScore);
    }
    if (mapsPlace.reviewsCount != null && Number(mapsPlace.reviewsCount) >= 0) {
      patch.reviewsCount = parseInt(mapsPlace.reviewsCount, 10);
    }
    if (mapsPlace.url && String(mapsPlace.url).trim()) {
      patch.url = String(mapsPlace.url).trim();
    }
    if (mapsPlace.website && mapsPlace.website !== 'N/A' && (!lead.website || lead.website === 'N/A')) {
      patch.website = String(mapsPlace.website).trim();
    }
  }

  if (outscraper.isConfigured(integrationEnv)) {
    const query = resolveReviewQuery(lead, mapsPlace);
    if (query) {
      try {
        const pack = await outscraper.fetchGoogleMapsReviews({
          query,
          reviewsLimit: REVIEWS_FETCH_LIMIT,
          integrationEnv,
        });
        if (pack.placeRating != null && Number.isFinite(Number(pack.placeRating))) {
          patch.totalScore = Number(pack.placeRating);
        }
        if (pack.placeReviewsCount != null && Number.isFinite(Number(pack.placeReviewsCount))) {
          patch.reviewsCount = parseInt(pack.placeReviewsCount, 10);
        }
        snippets = buildHighestLowestSnippets(pack.reviews);
        if (snippets.length) {
          patch.reviewSnippets = snippets;
          reviewsFetched = true;
        }
      } catch (e) {
        console.warn('[reviewHunt] Outscraper reviews failed:', e.message);
      }
    }
  }

  if (!snippets.length && Array.isArray(lead.reviewSnippets) && lead.reviewSnippets.length) {
    snippets = lead.reviewSnippets;
  }

  const intelLead = { ...lead, ...patch, reviewSnippets: snippets };
  if (snippets.length || patch.totalScore != null || patch.reviewsCount != null) {
    try {
      const aiPack = await generateReviewIntelForLead(intelLead);
      if (aiPack && aiPack.intel) {
        patch.reviewIntel = aiPack.intel;
        patch.reviewIntelAt = new Date().toISOString();
      }
    } catch (e) {
      console.warn('[reviewHunt] Review intel AI failed:', e.message);
    }
  }

  const used =
    reviewsFetched ||
    patch.totalScore != null ||
    patch.reviewsCount != null ||
    (Array.isArray(patch.reviewSnippets) && patch.reviewSnippets.length > 0) ||
    !!patch.reviewIntel;

  return { patch, used, mapsPlace, snippets };
}

module.exports = {
  normalizeReviewRow,
  buildHighestLowestSnippets,
  resolveReviewQuery,
  runReviewHuntForLead,
};
