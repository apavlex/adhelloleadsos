const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseReviewDate,
  reviewDateFromRow,
  formatDaysAgo,
  labelReviewFreshness,
  computeReviewFreshnessFromReviews,
  buildReviewFreshnessPatch,
} = require('../services/reviewFreshness');

describe('reviewFreshness', () => {
  it('parseReviewDate handles Outscraper datetime and unix timestamp', () => {
    const fromStr = parseReviewDate('03/17/2021 17:08:18');
    assert.ok(fromStr);
    assert.equal(fromStr.toISOString(), '2021-03-17T17:08:18.000Z');

    const fromUnix = parseReviewDate(1616000898);
    assert.ok(fromUnix);
    assert.equal(fromUnix.getUTCFullYear(), 2021);
  });

  it('reviewDateFromRow prefers review_timestamp then datetime utc', () => {
    const d = reviewDateFromRow({
      review_datetime_utc: '01/20/2021 14:25:18',
      review_timestamp: 1611152718,
    });
    assert.ok(d);
    assert.equal(d.getTime(), 1611152718 * 1000);
  });

  it('formatDaysAgo uses friendly relative wording', () => {
    assert.equal(formatDaysAgo(0), 'today');
    assert.equal(formatDaysAgo(1), '1 day ago');
    assert.equal(formatDaysAgo(3), '3 days ago');
    assert.equal(formatDaysAgo(45), 'about a month ago');
    assert.equal(formatDaysAgo(200), '6 months ago');
  });

  it('labelReviewFreshness marks active stream with 30-day count', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const labeled = labelReviewFreshness({
      lastReviewAt: '2026-08-17T12:00:00.000Z',
      reviewsLast30Days: 4,
      reviewsCount: 120,
      totalScore: 4.6,
      now,
    });
    assert.equal(labeled.status, 'active');
    assert.equal(labeled.label, 'Active — 4 in last 30 days');
    assert.equal(labeled.shortLabel, '4 / 30d');
    assert.equal(labeled.daysSinceLast, 3);
  });

  it('labelReviewFreshness flags 6+ month quiet as stale opportunity', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const labeled = labelReviewFreshness({
      lastReviewAt: '2025-12-01T12:00:00.000Z',
      reviewsLast30Days: 0,
      reviewsCount: 88,
      totalScore: 4.2,
      now,
    });
    assert.equal(labeled.status, 'stale');
    assert.match(labeled.label, /No reviews in 6\+ months/);
    assert.match(labeled.pitch || '', /reputation management/i);
  });

  it('labelReviewFreshness asks for Enhance when dates unknown', () => {
    const labeled = labelReviewFreshness({
      reviewsCount: 40,
      totalScore: 4.1,
      lastReviewAt: null,
    });
    assert.equal(labeled.status, 'unknown');
    assert.match(labeled.label, /run Enhance/i);
  });

  it('computeReviewFreshnessFromReviews counts window and last review', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const stats = computeReviewFreshnessFromReviews(
      [
        { review_timestamp: Math.floor(now.getTime() / 1000) - 2 * 86400 },
        { review_datetime_utc: '07/01/2026 10:00:00' },
        { review_datetime_utc: '01/15/2025 10:00:00' },
        { review_text: 'no date' },
      ],
      { now }
    );
    assert.equal(stats.datedReviewCount, 3);
    assert.equal(stats.reviewsLast30Days, 1);
    assert.ok(stats.lastReviewAt);
    assert.equal(new Date(stats.lastReviewAt).toISOString().slice(0, 10), '2026-08-18');
  });

  it('buildReviewFreshnessPatch persists lead fields', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const patch = buildReviewFreshnessPatch(
      [{ review_timestamp: Math.floor(now.getTime() / 1000) - 86400, review_text: 'Great' }],
      { now }
    );
    assert.ok(patch.lastReviewAt);
    assert.equal(patch.reviewsLast30Days, 1);
    assert.equal(patch.reviewsSampleSize, 1);
    assert.ok(patch.reviewFreshnessCheckedAt);
  });
});
