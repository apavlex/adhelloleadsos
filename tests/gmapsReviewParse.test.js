const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPatchFromPlace } = require('../services/outscraperGmbEnrich');

describe('outscraperGmbEnrich review overrides', () => {
  it('does not overwrite manually corrected review counts', () => {
    const lead = { reviewsCount: 318, reviewsCountManual: true, totalScore: 4.8 };
    const place = { reviewsCount: 424, totalScore: 4.7 };
    const patch = buildPatchFromPlace(place, lead);
    assert.equal(patch.reviewsCount, undefined);
    assert.equal(patch.totalScore, undefined);
  });

  it('fills missing review counts from place data', () => {
    const lead = { reviewsCount: 0, totalScore: 0 };
    const place = { reviewsCount: 318, totalScore: 4.8 };
    const patch = buildPatchFromPlace(place, lead);
    assert.equal(patch.reviewsCount, 318);
    assert.equal(patch.totalScore, 4.8);
  });
});
