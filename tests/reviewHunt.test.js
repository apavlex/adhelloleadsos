const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeReviewRow,
  buildHighestLowestSnippets,
  resolveReviewQuery,
} = require('../services/reviewHunt');

describe('reviewHunt', () => {
  it('normalizeReviewRow maps Outscraper-style fields', () => {
    const row = normalizeReviewRow({
      review_rating: 5,
      review_text: 'Fast and professional service.',
      author_title: 'Jane D.',
    });
    assert.equal(row.rating, 5);
    assert.equal(row.text, 'Fast and professional service.');
    assert.equal(row.author, 'Jane D.');
  });

  it('buildHighestLowestSnippets picks polarized quotes', () => {
    const snippets = buildHighestLowestSnippets([
      { review_rating: 5, review_text: 'Excellent technician, fixed our fridge same day.', author_title: 'Happy' },
      { review_rating: 1, review_text: 'Never showed up for the appointment window.', author_title: 'Angry' },
      { review_rating: 3, review_text: 'Average experience overall.', author_title: 'Mid' },
    ]);
    assert.equal(snippets.length, 2);
    assert.match(snippets[0], /Highest rated/);
    assert.match(snippets[0], /5★/);
    assert.match(snippets[1], /Lowest rated/);
    assert.match(snippets[1], /1★/);
  });

  it('buildHighestLowestSnippets skips short empty reviews', () => {
    const snippets = buildHighestLowestSnippets([
      { review_rating: 5, review_text: 'ok' },
      { review_rating: 1, review_text: '   ' },
    ]);
    assert.equal(snippets.length, 0);
  });

  it('resolveReviewQuery prefers place_id then Maps URL', () => {
    assert.equal(
      resolveReviewQuery({ title: 'Acme', city: 'Portland' }, { placeId: 'ChIJabc123' }),
      'ChIJabc123'
    );
    assert.equal(
      resolveReviewQuery({ title: 'Acme', url: 'https://maps.google.com/?cid=123' }, null),
      'https://maps.google.com/?cid=123'
    );
    assert.equal(resolveReviewQuery({ title: 'Acme', city: 'Portland', state: 'OR' }, null), 'Acme, Portland, OR');
  });
});
