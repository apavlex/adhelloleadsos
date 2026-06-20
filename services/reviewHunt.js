/**
 * Review hunt: Outscraper GMB + review quotes, then OpenRouter summary.
 */

const outscraper = require('./outscraperClient');
const { generateReviewSummaryForLead } = require('./reviewIntel');
const outscraperGmbEnrich = require('./outscraperGmbEnrich');

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
 * @param {{ mapsPlace?: object|null, gmbPack?: object|null, skipGmbFetch?: boolean }} [opts]
 * @returns {Promise<{ patch: object, used: boolean, mapsPlace: object|null, snippets: string[], reviewsFetched: boolean, reviewError: string|null, reviewQuery: string, outscraperConfigured: boolean }>}
 */
async function runReviewHuntForLead(lead, integrationEnv, opts = {}) {
  const patch = {};
  let mapsPlace = opts.mapsPlace || (opts.gmbPack && opts.gmbPack.place) || null;
  let snippets = (opts.gmbPack && opts.gmbPack.snippets) || [];
  let reviewsFetched = !!(opts.gmbPack && opts.gmbPack.reviewsFetched);
  let reviewError = (opts.gmbPack && opts.gmbPack.reviewError) || null;
  let reviewQuery = (opts.gmbPack && opts.gmbPack.reviewQuery) || '';

  if (!opts.skipGmbFetch && outscraper.isConfigured(integrationEnv) && !opts.gmbPack) {
    const gmb = await outscraperGmbEnrich.enrichLeadFromOutscraperGmb(lead, integrationEnv);
    if (gmb) {
      mapsPlace = gmb.place || mapsPlace;
      snippets = gmb.snippets.length ? gmb.snippets : snippets;
      reviewsFetched = reviewsFetched || gmb.reviewsFetched;
      reviewError = reviewError || gmb.reviewError;
      reviewQuery = reviewQuery || gmb.reviewQuery;
      if (gmb.patch) Object.assign(patch, gmb.patch);
    }
  } else if (opts.gmbPack && opts.gmbPack.patch) {
    Object.assign(patch, opts.gmbPack.patch);
  } else if (mapsPlace) {
    Object.assign(patch, outscraperGmbEnrich.buildPatchFromPlace(mapsPlace, lead));
  }

  if (!snippets.length && Array.isArray(lead.reviewSnippets) && lead.reviewSnippets.length) {
    snippets = lead.reviewSnippets;
  }

  const intelLead = { ...lead, ...patch, reviewSnippets: snippets };
  if (
    snippets.length ||
    patch.totalScore != null ||
    patch.reviewsCount != null ||
    intelLead.totalScore != null ||
    intelLead.reviewsCount != null
  ) {
    try {
      const aiPack = await generateReviewSummaryForLead(intelLead);
      if (aiPack && aiPack.intel) {
        patch.reviewIntel = aiPack.intel;
        patch.reviewIntelAt = new Date().toISOString();
      } else if (aiPack && aiPack.error) {
        reviewError = reviewError || aiPack.error;
      }
    } catch (e) {
      console.warn('[reviewHunt] Review summary AI failed:', e.message);
      reviewError = reviewError || e.message || 'Review summary AI failed';
    }
  }

  const used =
    reviewsFetched ||
    patch.totalScore != null ||
    patch.reviewsCount != null ||
    (Array.isArray(patch.reviewSnippets) && patch.reviewSnippets.length > 0) ||
    !!(patch.reviewIntel && patch.reviewIntel.summary);

  return {
    patch,
    used,
    mapsPlace,
    snippets,
    reviewsFetched,
    reviewError,
    reviewQuery,
    outscraperConfigured: outscraper.isConfigured(integrationEnv),
  };
}

module.exports = {
  normalizeReviewRow,
  buildHighestLowestSnippets,
  resolveReviewQuery,
  runReviewHuntForLead,
};
