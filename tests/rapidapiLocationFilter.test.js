const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

// rowMatchesTarget is internal; test via search behavior using exported helpers indirectly
const geo = require('../services/geocodeLocation');

describe('rapidapi location query for Vancouver', () => {
  test('does not append USA for BC searches', () => {
    const q = geo.buildMapsSearchQuery('Coffee Shop', 'Vancouver', 'BC');
    assert.ok(!q.includes('USA'));
    assert.ok(q.includes('Canada'));
  });
});
