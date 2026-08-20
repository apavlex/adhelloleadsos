/**
 * Review freshness from Outscraper (and similar) review rows.
 * Used to pitch reputation management when the review stream is stale or quiet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse Outscraper / Maps review timestamps into a Date.
 * Supports review_timestamp (unix sec/ms), review_datetime_utc ("MM/DD/YYYY HH:MM:SS"), ISO strings.
 * @param {unknown} raw
 * @returns {Date|null}
 */
function parseReviewDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    return parseReviewDate(Number(s));
  }

  // Outscraper: "03/17/2021 17:08:18" (UTC)
  const mdy = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (mdy) {
    const month = parseInt(mdy[1], 10) - 1;
    const day = parseInt(mdy[2], 10);
    const year = parseInt(mdy[3], 10);
    const hour = mdy[4] != null ? parseInt(mdy[4], 10) : 0;
    const min = mdy[5] != null ? parseInt(mdy[5], 10) : 0;
    const sec = mdy[6] != null ? parseInt(mdy[6], 10) : 0;
    const d = new Date(Date.UTC(year, month, day, hour, min, sec));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract review date from a raw review object (Outscraper-style or normalized).
 * @param {object} row
 * @returns {Date|null}
 */
function reviewDateFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.reviewedAt) {
    const fromNorm = parseReviewDate(row.reviewedAt);
    if (fromNorm) return fromNorm;
  }
  const candidates = [
    row.review_timestamp,
    row.reviewTimestamp,
    row.review_datetime_utc,
    row.review_datetime,
    row.reviewDatetimeUtc,
    row.publishedAt,
    row.time,
    row.date,
  ];
  for (const c of candidates) {
    const d = parseReviewDate(c);
    if (d) return d;
  }
  return null;
}

/**
 * @param {number} days
 * @returns {string}
 */
function formatDaysAgo(days) {
  if (!Number.isFinite(days) || days < 0) return '';
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 60) return 'about a month ago';
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  if (years === 1) return 'about a year ago';
  return `${years}+ years ago`;
}

/**
 * @param {{ lastReviewAt?: string|null, reviewsLast30Days?: number|null, reviewsSampleSize?: number|null, reviewsCount?: number|null, totalScore?: number|null, now?: Date|number }} input
 * @returns {{
 *   status: 'none'|'unknown'|'active'|'recent'|'cooling'|'stale'|'dormant',
 *   label: string,
 *   shortLabel: string,
 *   pitch: string|null,
 *   daysSinceLast: number|null,
 *   lastReviewAt: string|null,
 *   reviewsLast30Days: number|null,
 * }}
 */
function labelReviewFreshness(input) {
  const nowMs =
    input && input.now != null
      ? (input.now instanceof Date ? input.now.getTime() : Number(input.now))
      : Date.now();
  const reviewsCount = parseInt(input && (input.reviewsCount != null ? input.reviewsCount : input.reviews), 10) || 0;
  const rating = Number(input && (input.totalScore != null ? input.totalScore : input.rating)) || 0;
  const lastRaw = input && input.lastReviewAt;
  const lastDate = lastRaw ? parseReviewDate(lastRaw) : null;
  const last30 =
    input && input.reviewsLast30Days != null && Number.isFinite(Number(input.reviewsLast30Days))
      ? Math.max(0, parseInt(input.reviewsLast30Days, 10) || 0)
      : null;

  if (reviewsCount <= 0 && !lastDate) {
    return {
      status: 'none',
      label: 'No Google reviews on file',
      shortLabel: 'No reviews',
      pitch: 'No review presence — pitch reputation & review generation.',
      daysSinceLast: null,
      lastReviewAt: null,
      reviewsLast30Days: last30,
    };
  }

  if (!lastDate) {
    return {
      status: 'unknown',
      label: 'Review dates unknown — run Enhance',
      shortLabel: 'Dates unknown',
      pitch: null,
      daysSinceLast: null,
      lastReviewAt: null,
      reviewsLast30Days: last30,
    };
  }

  const lastIso = lastDate.toISOString();
  const daysSince = Math.max(0, Math.floor((nowMs - lastDate.getTime()) / DAY_MS));
  const ago = formatDaysAgo(daysSince);

  let status = 'recent';
  if (daysSince <= 30) status = 'active';
  else if (daysSince <= 90) status = 'recent';
  else if (daysSince <= 180) status = 'cooling';
  else if (daysSince <= 365) status = 'stale';
  else status = 'dormant';

  let label = `Last review: ${ago}`;
  let shortLabel = ago === 'today' ? 'Today' : ago;
  if (status === 'active' && last30 != null && last30 > 0) {
    label = `Active — ${last30} in last 30 days`;
    shortLabel = `${last30} / 30d`;
  } else if (status === 'stale' || status === 'dormant') {
    label =
      daysSince >= 180
        ? `No reviews in ${daysSince >= 365 ? '12+' : '6+'} months`
        : `Last review: ${ago}`;
    shortLabel = daysSince >= 365 ? '12+ mo quiet' : daysSince >= 180 ? '6+ mo quiet' : ago;
  }

  let pitch = null;
  if (status === 'stale' || status === 'dormant' || status === 'cooling') {
    pitch = 'Quiet review stream — pitch reputation management to restart reviews.';
  } else if (status === 'active' && rating > 0 && rating < 4.0) {
    pitch = 'Reviews are coming in but stars are soft — pitch reputation repair.';
  } else if (status === 'active' && reviewsCount > 0 && reviewsCount < 30) {
    pitch = 'Active but thin review volume — pitch review generation.';
  } else if (status === 'none') {
    pitch = 'No review presence — pitch reputation & review generation.';
  }

  return {
    status,
    label,
    shortLabel,
    pitch,
    daysSinceLast: daysSince,
    lastReviewAt: lastIso,
    reviewsLast30Days: last30,
  };
}

/**
 * Compute freshness stats from a batch of review rows (newest-first preferred).
 * @param {object[]} reviews
 * @param {{ now?: Date|number, windowDays?: number }} [opts]
 * @returns {{
 *   lastReviewAt: string|null,
 *   reviewsLast30Days: number,
 *   reviewsSampleSize: number,
 *   reviewFreshnessCheckedAt: string,
 *   datedReviewCount: number,
 * }|null}
 */
function computeReviewFreshnessFromReviews(reviews, opts = {}) {
  const list = Array.isArray(reviews) ? reviews : [];
  const nowMs =
    opts.now != null
      ? (opts.now instanceof Date ? opts.now.getTime() : Number(opts.now))
      : Date.now();
  const windowDays = Math.max(1, parseInt(opts.windowDays, 10) || 30);
  const windowStart = nowMs - windowDays * DAY_MS;

  const dates = [];
  for (const row of list) {
    const d = reviewDateFromRow(row);
    if (d) dates.push(d);
  }
  if (!dates.length) {
    return {
      lastReviewAt: null,
      reviewsLast30Days: 0,
      reviewsSampleSize: list.length,
      reviewFreshnessCheckedAt: new Date(nowMs).toISOString(),
      datedReviewCount: 0,
    };
  }

  dates.sort((a, b) => b.getTime() - a.getTime());
  const last = dates[0];
  const inWindow = dates.filter((d) => d.getTime() >= windowStart).length;

  return {
    lastReviewAt: last.toISOString(),
    reviewsLast30Days: inWindow,
    reviewsSampleSize: list.length,
    reviewFreshnessCheckedAt: new Date(nowMs).toISOString(),
    datedReviewCount: dates.length,
  };
}

/**
 * Build lead patch fields from Outscraper review rows.
 * @param {object[]} reviews
 * @param {{ now?: Date|number }} [opts]
 * @returns {object}
 */
function buildReviewFreshnessPatch(reviews, opts = {}) {
  const stats = computeReviewFreshnessFromReviews(reviews, opts);
  if (!stats) return {};
  const patch = {
    reviewFreshnessCheckedAt: stats.reviewFreshnessCheckedAt,
    reviewsSampleSize: stats.reviewsSampleSize,
  };
  if (stats.lastReviewAt) {
    patch.lastReviewAt = stats.lastReviewAt;
    patch.reviewsLast30Days = stats.reviewsLast30Days;
  } else if (Array.isArray(reviews) && reviews.length > 0) {
    // Fetched reviews but no parseable dates — still mark that we checked.
    patch.reviewsLast30Days = 0;
  }
  return patch;
}

module.exports = {
  DAY_MS,
  parseReviewDate,
  reviewDateFromRow,
  formatDaysAgo,
  labelReviewFreshness,
  computeReviewFreshnessFromReviews,
  buildReviewFreshnessPatch,
};
