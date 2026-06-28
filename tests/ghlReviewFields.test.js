const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  leadReviewValues,
  findFieldInList,
  formatReviewSummaryForNote,
  RATING_FIELD_NAME,
  REVIEWS_FIELD_NAME,
  RATING_FIELD_KEY,
  REVIEWS_FIELD_KEY,
} = require('../services/ghlReviewFields');
const { buildGhlSyncActivityNote } = require('../services/ghlSyncHelpers');

describe('ghlReviewFields', () => {
  it('leadReviewValues reads totalScore and reviewsCount', () => {
    const v = leadReviewValues({ totalScore: 4.7, reviewsCount: 1870 });
    assert.equal(v.rating, 4.7);
    assert.equal(v.reviews, 1870);
  });

  it('leadReviewValues accepts legacy rating/reviews keys', () => {
    const v = leadReviewValues({ rating: 3.9, reviews: 42 });
    assert.equal(v.rating, 3.9);
    assert.equal(v.reviews, 42);
  });

  it('findFieldInList matches by fieldKey or name', () => {
    const fields = [
      { id: 'cf1', name: 'Budget', fieldKey: 'contact.budget' },
      { id: 'cf2', name: RATING_FIELD_NAME, fieldKey: 'contact.other' },
    ];
    assert.equal(findFieldInList(fields, { name: RATING_FIELD_NAME, fieldKey: RATING_FIELD_KEY }).id, 'cf2');
    assert.equal(
      findFieldInList([{ id: 'cf3', name: 'Other', fieldKey: REVIEWS_FIELD_KEY }], {
        name: REVIEWS_FIELD_NAME,
        fieldKey: REVIEWS_FIELD_KEY,
      }).id,
      'cf3',
    );
  });

  it('formatReviewSummaryForNote formats rating and count', () => {
    assert.equal(
      formatReviewSummaryForNote({ totalScore: 4.8, reviewsCount: 503 }),
      'Google: 4.8★ (503 reviews)',
    );
    assert.equal(formatReviewSummaryForNote({ reviewsCount: 17 }), 'Google: 17 reviews');
    assert.equal(formatReviewSummaryForNote({}), '');
  });

  it('buildGhlSyncActivityNote includes Google review line when present', () => {
    const body = buildGhlSyncActivityNote(
      { totalScore: 4.7, reviewsCount: 145, lastDispositionNotes: 'Left VM.' },
      { actionLabel: 'Voicemail' },
    );
    assert.match(body, /Google: 4\.7★ \(145 reviews\)/);
    assert.match(body, /Left VM\./);
  });
});
