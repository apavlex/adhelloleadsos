const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LOW_REVIEWS_THRESHOLD,
  normalizeLowReviewsThreshold,
  getLowReviewsThresholdFromWorkspace,
  isLowReviews,
  computeProspectGapLabels,
} = require('../services/prospectGapLabels');

describe('prospectGapLabels', () => {
  it('defaults low review threshold to 30', () => {
    assert.equal(DEFAULT_LOW_REVIEWS_THRESHOLD, 30);
    assert.equal(normalizeLowReviewsThreshold(undefined), 30);
    assert.equal(normalizeLowReviewsThreshold(''), 30);
  });

  it('normalizes custom threshold', () => {
    assert.equal(normalizeLowReviewsThreshold(15), 15);
    assert.equal(normalizeLowReviewsThreshold('45'), 45);
    assert.equal(normalizeLowReviewsThreshold(-5), 30);
  });

  it('reads threshold from workspace prospecting settings', () => {
    assert.equal(
      getLowReviewsThresholdFromWorkspace({ prospecting: { lowReviewsThreshold: 12 } }),
      12,
    );
    assert.equal(getLowReviewsThresholdFromWorkspace({}), 30);
  });

  it('flags low reviews at or below threshold', () => {
    assert.equal(isLowReviews(12, 30), true);
    assert.equal(isLowReviews(30, 30), true);
    assert.equal(isLowReviews(31, 30), false);
    assert.equal(isLowReviews(0, 30), true);
  });

  it('computes LOW REVIEWS and other gap labels', () => {
    const labels = computeProspectGapLabels(
      {
        title: 'C-T Landscaping',
        reviewsCount: 12,
        website: 'https://example.com',
        facebook: 'N/A',
        instagram: 'N/A',
        isMobileFriendly: false,
      },
      { lowReviewsThreshold: 30 },
    );
    assert.ok(labels.includes('LOW REVIEWS'));
    assert.ok(labels.includes('BAD SITE'));
    assert.ok(labels.includes('WEAK SOCIAL'));
  });

  it('includes NO WEBSITE when missing site', () => {
    const labels = computeProspectGapLabels({ reviewsCount: 5, website: 'N/A' });
    assert.deepEqual(labels.slice(0, 2), ['NO WEBSITE', 'LOW REVIEWS']);
  });
});
